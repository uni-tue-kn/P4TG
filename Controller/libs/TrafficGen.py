"""
Copyright 2022-present University of Tuebingen, Chair of Communication Networks

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

Steffen Lindner (steffen.lindner@uni-tuebingen.de)
"""

import logging

import os

from conn_mgr_pd_rpc.ttypes import *
from ptf.thriftutils import *
from res_pd_rpc.ttypes import *
from pal_rpc.ttypes import *

from ortools.linear_solver import pywraplp
from libs.MulticastConfiguration import MulticastConfiguration

from collections import defaultdict

from libs.packet_formats.Ethernet import Ethernet
from libs.packet_formats.IPv4 import IPv4
from libs.packet_formats.P4TG import P4TG
from libs.packet_formats.UDP import UDP as MyUDP
from libs.packet_formats.Monitor import Monitor

from enum import Enum


def ip2int(addr):
    return struct.unpack("!I", socket.inet_aton(addr))[0]


def mac2int(mac_str):
    return int(mac_str.replace(":", ""), 16)

class Mode(str, Enum):
    CBR = "CBR",
    MPPS = "Mpps",
    RANDOM = "Poisson",
    ANALYZE = "Monitor"

class RateOptimizer:
    def __init__(self, size=64, rate=31, max_burst=3):
        self.solver = pywraplp.Solver.CreateSolver('SCIP')

        self.size = size
        self.rate = rate

        self.pipes = [68, 196]

        self.accuracy = 0.001

        self.real_iat = (size + 20) * 8 / rate
        self.d = (self.real_iat - int(self.real_iat)) / self.real_iat

        max_packets = max_burst if max_burst == 1 else int(self.d / self.accuracy) + 1

        infinity = self.solver.infinity

        self.timeout = self.solver.IntVar(lb=1, ub=2 ** 32 - 1, name='timeout')
        self.packets = self.solver.IntVar(name="number of packets", lb=1, ub=max_packets)
        self.calc = self.solver.NumVar(name="calculation", lb=0, ub=100)
        self.objective = self.solver.NumVar(name="objective", lb=0, ub=100)

        self.solver.Add(self.calc == rate * self.timeout - (self.packets * self.size * 8))
        self.solver.Add(self.calc >= 0)

        self.solver.Minimize(self.calc + self.packets)

    def solve(self):
        self.solver.Solve()

        return self.packets.solution_value(), self.timeout.solution_value()


iat_digest_value = 1


class TrafficGen:
    def __init__(self, switch=None, port_mapping=None, frame_monitor=None):
        self.switch = switch
        self.port_mapping = port_mapping
        self.mc_manager = MulticastConfiguration(switch=switch)
        self.frame_monitor = frame_monitor

        self.reset_handler = []
        self.stop_handler = []
        self.start_handler = []

        self.indices = defaultdict(int)

        self.target = self.switch.target
        self.tc = switch.thrift

        for pipe in range(0, self.switch.pal.pal_num_pipes_get(0)):
            port = (pipe << 7 | 68)
            self.switch.thrift.conn_mgr.pktgen_enable(self.switch.thrift.hdl, 0, (pipe << 7 | 68))
            logging.debug("Active pktgen on port {}".format(port))

        self.configureStaticRules()
        self.addMonitorPackets()

        self.running = False

        # we limit the iat digests to 500 packets per second
        self.max_iat_pps = 500

        self.config = {}


    def on_reset(self, handler):
        self.reset_handler.append(handler)

    def on_stop(self, handler):
        self.stop_handler.append(handler)

    def on_start(self, handler):
        self.start_handler.append(handler)

    def addMonitorPackets(self):
        # Create flood multicat group, send monitoring packets to all tx recirc ports
        ports = []

        for p in self.port_mapping:
            ports.append(self.port_mapping[p]["tx_recirc"])

        mc_id = self.mc_manager.add_mc_grp(name="MonitoringFlood", ports=ports)

        def configurePktGen():
            size = 64  # 64 byte packet
            dt = DevTarget_t(0, hex_to_i16(0xFFFF))
            # pkt = Ether(src='98:03:9b:84:aa:ce', dst='98:03:9b:84:aa:cf', type=0xBB02) / MonitorHeader()
            pkt = Ethernet(src='98:03:9b:84:aa:ce', dst='98:03:9b:84:aa:cf', type=0xBB02) / Monitor()
            pkt = pkt / os.urandom(size - len(pkt))
            self.min_offset = len(pkt)

            # every 0.5 s
            timeout = int(0.5 * 10 ** 9)

            logging.debug("Configure monitoring packets.")

            self.tc.conn_mgr.pktgen_write_pkt_buffer(self.tc.hdl, dt, 0, len(pkt), pkt.build())

            config = PktGenAppCfg_t(trigger_type=PktGenTriggerType_t.TIMER_PERIODIC,
                                    timer=timeout,
                                    src_port=68,
                                    buffer_offset=0,
                                    length=len(pkt) - 6)  # - pktgen header
            self.tc.conn_mgr.pktgen_cfg_app(self.tc.hdl, dt, 0, config)
            self.tc.conn_mgr.pktgen_app_enable(self.tc.hdl, dt, 0)

        configurePktGen()

        for ip in [68]:
            self.switch.TableEntry(table="ingress.p4tg.monitor_forward",
                                   match_fields={
                                       "ig_intr_md.ingress_port": ip,
                                       "hdr.monitor.index": 0
                                   },
                                   action_name="ingress.p4tg.mc_forward",
                                   action_params={
                                       "mcid": mc_id
                                   })

        """
        Configure monitoring path
        TX_Recirc -> RX_Recirc -> TX_Recirc -> RX_Recirc -> ...
        Path is:
            All Data -> Stream 1 Data -> Stream 2 Data -> ...
        Stream IDs are from 1-7
        """

        for p in self.port_mapping:
            tx_port = self.port_mapping[p]["tx_recirc"]
            rx_port = self.port_mapping[p]["rx_recirc"]

            for app_id in range(1, 9):
                values = list(self.indices.values())

                if len(values) > 0:
                    self.indices[(tx_port, app_id)] = max(values) + 1
                    self.indices[(rx_port, app_id)] = max(values) + 2
                else:
                    self.indices[(tx_port, app_id)] = 1
                    self.indices[(rx_port, app_id)] = 2

        logging.info("Indices len: {}".format(len(self.indices)))

        for p in self.port_mapping:
            tx_port = self.port_mapping[p]["tx_recirc"]
            rx_port = self.port_mapping[p]["rx_recirc"]

            # Start with first tx stream after multicast replication
            self.switch.TableEntry(table="egress.monitor_init",
                                   match_fields={
                                       "eg_intr_md.egress_port": tx_port,
                                       "hdr.monitor.index": 0
                                   },
                                   action_name="egress.init_monitor_header",
                                   action_params={
                                       "index": self.indices.get((tx_port, 1))
                                   })

            # Write index rewrite rules
            for app_id in range(1, 8):
                self.switch.TableEntry(table="ingress.p4tg.monitor_forward",
                                       match_fields={
                                           "ig_intr_md.ingress_port": tx_port,
                                           "hdr.monitor.index": self.indices.get((tx_port, app_id))
                                       },
                                       action_name="ingress.p4tg.make_digest_and_forward",
                                       action_params={
                                           "e_port": rx_port,
                                           "index": self.indices.get((rx_port, app_id))
                                       })

                self.switch.TableEntry(table="ingress.p4tg.monitor_forward",
                                       match_fields={
                                           "ig_intr_md.ingress_port": rx_port,
                                           "hdr.monitor.index": self.indices.get((rx_port, app_id))
                                       },
                                       action_name="ingress.p4tg.make_digest_and_forward",
                                       action_params={
                                           "e_port": tx_port,
                                           "index": self.indices.get((tx_port, app_id + 1))
                                       })

                # write to monitor_stream table for rate monitoring of streams
                self.switch.TableEntry(table="egress.monitor_stream",
                                       match_fields={
                                           "eg_intr_md.egress_port": tx_port,
                                           "hdr.path.app_id": app_id,
                                           "hdr.path.dst_port": 50083
                                       },
                                       action_name="egress.monitor_stream_rate",
                                       action_params={
                                           "idx": self.indices.get((tx_port, app_id))
                                       })

                self.switch.TableEntry(table="egress.monitor_stream",
                                       match_fields={
                                           "eg_intr_md.egress_port": rx_port,
                                           "hdr.path.app_id": app_id,
                                           "hdr.path.dst_port": 50083
                                       },
                                       action_name="egress.monitor_stream_rate",
                                       action_params={
                                           "idx": self.indices.get((rx_port, app_id))
                                       })

    def configureStaticRules(self):
        for p in self.port_mapping:
            # add entries to set tx timestamp when on egress of physical out port
            self.switch.TableEntry(table="egress.is_egress",
                                   match_fields={
                                       "eg_intr_md.egress_port": p,
                                   },
                                   action_name="egress.set_tx",
                                   action_params={})

            # add entries to detect tx_recirc for - 6 byte pkt size due to pkt gen header
            self.switch.TableEntry(table="egress.is_tx_recirc",
                                   match_fields={
                                       "eg_intr_md.egress_port": self.port_mapping.get(p).get("tx_recirc"),
                                   },
                                   action_name="egress.no_action",
                                   action_params={})

    def configureMonitorForwarding(self, mapping=None):
        for p in mapping:
            if mapping.get(p) == "":
                continue

            rx_port = int(mapping.get(p))
            tx_port = int(p)

            self.switch.TableEntry(table="ingress.p4tg.forward",
                                    match_fields={
                                        "ig_intr_md.ingress_port": self.port_mapping.get(rx_port).get("rx_recirc"),
                                    },
                                    action_name="ingress.p4tg.port_forward",
                                    action_params={
                                        "e_port": self.port_mapping.get(tx_port).get("tx_recirc")
                                    })


    def configureFowrading(self):
        for p in self.port_mapping:
            # Received packets are forwarded to rx recirc port
            self.switch.TableEntry(table="ingress.p4tg.forward",
                                   match_fields={
                                       "ig_intr_md.ingress_port": p,
                                   },
                                   action_name="ingress.p4tg.port_forward",
                                   action_params={
                                       "e_port": self.port_mapping.get(p).get("rx_recirc")
                                   })

            # Packets received on tx_recirc should be forwarded out of p
            self.switch.TableEntry(table="ingress.p4tg.forward",
                                   match_fields={
                                       "ig_intr_md.ingress_port": self.port_mapping.get(p).get("tx_recirc"),
                                   },
                                   action_name="ingress.p4tg.port_forward",
                                   action_params={
                                       "e_port": p
                                   })

    def resetRegisters(self):
        # Reset registers
        self.switch.ResetRegister(register_name="egress.tx_seq")
        self.switch.ResetRegister(register_name="ingress.p4tg.rx_seq")
        self.switch.ResetRegister(register_name="ingress.p4tg.lost_packets.reg_lo")
        self.switch.ResetRegister(register_name="ingress.p4tg.lost_packets.reg_lo_carry")
        self.switch.ResetRegister(register_name="ingress.p4tg.lost_packets.reg_hi")

        self.switch.ResetRegister(register_name="ingress.p4tg.out_of_order.reg_lo")
        self.switch.ResetRegister(register_name="ingress.p4tg.out_of_order.reg_lo_carry")
        self.switch.ResetRegister(register_name="ingress.p4tg.out_of_order.reg_hi")

        self.switch.ResetRegister(register_name="egress.rate_l1.reg_lo")
        self.switch.ResetRegister(register_name="egress.rate_l1.reg_lo_carry")
        self.switch.ResetRegister(register_name="egress.rate_l1.reg_hi")

        self.switch.ResetRegister(register_name="egress.rate_l2.reg_lo")
        self.switch.ResetRegister(register_name="egress.rate_l2.reg_lo_carry")
        self.switch.ResetRegister(register_name="egress.rate_l2.reg_hi")

        self.switch.ResetRegister(register_name="egress.app.reg_lo")
        self.switch.ResetRegister(register_name="egress.app.reg_lo_carry")
        self.switch.ResetRegister(register_name="egress.app.reg_hi")

    def configureTrafficGen(self, streams=None, stream_settings=None, port_mapping=None, mode="CBR"):
        if self.running:
            raise Exception("TrafficGen currently running.")

        if mode != Mode.CBR and len(streams) > 1:
            raise Exception("Only CBR mode supports multiple streams. Mode: {}".format(mode))

        logging.info("Start reset")
        self.reset()

        logging.info("Start configure forwarding")
        self.configureFowrading()

        if mode == Mode.ANALYZE:
            self.configureMonitorForwarding(mapping=port_mapping)

        dt = DevTarget_t(0, hex_to_i16(0xFFFF))
        self.overall_rate = 0

        packets = 0
        timeout = 0

        # determine stream -> [ports] mapping
        stream_to_ports = defaultdict(list)

        for s in streams:
            for element in stream_settings:
                if element["stream_id"] == s["stream_id"] and element["active"]:
                    stream_to_ports[s["app_id"]].append(self.port_mapping.get(element["port"]).get("tx_recirc"))

                    # add header rewrite rules
                    self.switch.TableEntry(table="egress.header_replace.header_replace",
                                           match_fields={
                                               "eg_intr_md.egress_port": self.port_mapping.get(element["port"]).get(
                                                   "tx_recirc"),
                                               "hdr.path.app_id": s["app_id"]},
                                           action_name="egress.header_replace.rewrite",
                                           action_params={
                                               "src_mac": mac2int(element["eth_src"]),
                                               "dst_mac": mac2int(element["eth_dst"]),
                                               "s_mask": ip2int(element["ip_src_mask"]),
                                               "d_mask": ip2int(element["ip_dst_mask"]),
                                               "s_ip": ip2int(element["ip_src"]),
                                               "d_ip": ip2int(element["ip_dst"]),
                                               "tos": element["ip_tos"]
                                           })

                    continue

        stream_to_mc = {}

        # configure multicast groups
        for s in stream_to_ports:
            id = self.mc_manager.add_mc_grp(name="Stream {}".format(s), ports=stream_to_ports.get(s))
            stream_to_mc[s] = id

        # default on both pipes
        factor = 2
        self.pipes = [68, 196]

        for s in streams:
            if s["app_id"] in stream_to_mc:  # stream is active
                self.overall_rate += s["traffic_rate"]

        if self.overall_rate < 75:
            self.pipes = [68]
            factor = 1

        def configureGenerator(factor=1):
            offset = 0

            for s in streams:
                if not s["app_id"] in stream_to_mc:
                    s["active"] = False
                    continue

                s["active"] = True

                # 14 byte + 20 byte + 8 byte + 13 byte = 55
                # we will rewrite the IP header in the egress
                pkt = Ethernet(type=0x0800) / IPv4(proto=17, src="10.0.5.3") / MyUDP(sport=50081, dport=50083) / P4TG(
                    app_id=s["app_id"])

                remaining = s["frame_size"] - len(pkt) - 4  # CRC not in scapy

                pkt = pkt / os.urandom(remaining)
                pktlen = len(pkt)

                # pkt[UDP].chksum = None

                # preamble + start delimiter + IFG
                addition = 8 + 12

                if "pipes" in s:
                    if s["pipes"] == 1:
                        self.pipes = [68]
                        factor = 1
                    elif s["pipes"] == 2:
                        self.pipes = [68, 196]
                        factor = 2

                # generated on both pipes, so timeout * 2
                packets, timeout = RateOptimizer(rate=s["traffic_rate"], size=(s["frame_size"] + addition),
                                                 max_burst=s["burst"]).solve()

                mpps = s["traffic_rate"]

                if mode == Mode.MPPS:
                    s["traffic_rate"] = (s["frame_size"] + 20) * 8 * mpps / 10 ** 3
                    packets, timeout = RateOptimizer(rate=s["traffic_rate"], size=(s["frame_size"] + addition),
                                                     max_burst=s["burst"]).solve()
                    s["traffic_rate"] = mpps
                    self.config["mpps"] = mpps

                if mode == Mode.RANDOM:
                    self.pipes = [68, 196]
                    factor = 2

                    max_rate = 100
                    # maximal throughput
                    packets, timeout = RateOptimizer(rate=100, size=(s["frame_size"] + addition), max_burst=25).solve()
                    # packets = 1
                    # timeout = 1

                    const_iat = (s["frame_size"] + 20) / max_rate
                    target_iat = (s["frame_size"] + 20) / s["traffic_rate"]

                    p = const_iat / target_iat
                    # for poisson traffic
                    s["rand_value"] = (0, int(p * (2 ** 16 - 1)))
                    s["p"] = p
                else:
                    # for normal traffic
                    s["rand_value"] = (0, 2 ** 16 - 1)

                # packets = 1
                # timeout = 1
                s["packets"] = packets
                s["timeout"] = timeout
                s["factor"] = factor
                s["pipes"] = self.pipes

                logging.debug(
                    "Configure packets with size {} bytes, {} packets and rate {} Gbps each {} ns for stream {}".format(
                        pktlen, packets,
                        s["traffic_rate"],
                        timeout,
                        s))

                self.tc.conn_mgr.pktgen_write_pkt_buffer(self.tc.hdl, dt, self.min_offset + offset, pktlen, pkt.build())

                config = PktGenAppCfg_t(trigger_type=PktGenTriggerType_t.TIMER_PERIODIC,
                                        timer=int(timeout) * factor,
                                        src_port=68,
                                        pkt_count=int(packets) - 1,
                                        buffer_offset=self.min_offset + offset,
                                        length=pktlen)  # - pktgen header

                offset += pktlen - 2

                # offset align 16B
                if offset % 16 != 0:
                    offset += 16 - (offset % 16)

                self.tc.conn_mgr.pktgen_cfg_app(self.tc.hdl, dt, s["app_id"], config)

                for ip in self.pipes:
                    self.switch.TableEntry(table="ingress.p4tg.tg_forward",
                                           match_fields={
                                               "ig_intr_md.ingress_port": ip,
                                               "hdr.pkt_gen.app_id": s["app_id"],
                                               "ig_md.rand_value": s["rand_value"]
                                           },
                                           action_name="ingress.p4tg.mc_forward",
                                           action_params={
                                               "mcid": stream_to_mc[s["app_id"]]
                                           })

        configureGenerator(factor=factor)

        self.config = {"mode": mode, "stream_settings": stream_settings, "port_mapping": port_mapping,
                       "streams": streams, "stream_to_mc": stream_to_mc, "stream_to_ports": stream_to_ports,
                       "port_to_recirc": self.port_mapping,
                       "internal_config": self.config
                       }

        for s in streams:
            if s["active"]:
                self.tc.conn_mgr.pktgen_app_enable(self.tc.hdl, dt, s["app_id"])

        self.running = True

        for handler in self.start_handler:
            handler()

        return packets, timeout * 2

    def stopTrafficGen(self):
        if not self.running:
            raise Exception("TrafficGen not running")

        if "mode" in self.config and self.config.get("mode") == Mode.ANALYZE:
            self.reset()

        # self.monitor.stop_rtt_measure()
        # self.monitor.stop_iat_measure()

        dt = DevTarget_t(0, hex_to_i16(0xFFFF))

        for id in range(1, 8):
            self.tc.conn_mgr.pktgen_app_disable(self.tc.hdl, dt, id)

        self.switch.ClearTable(table="ingress.p4tg.tg_forward")

        if "streams" in self.config:
            for s in self.config["streams"]:
                if not s["active"]:
                    continue

                self.mc_manager.delete_mc_group(name="Stream {}".format(s["app_id"]))

        self.running = False

        for handler in self.stop_handler:
            handler()

        logging.debug("Stop traffic generation.")

    def reset(self):
        self.removeEntries()

        for handler in self.reset_handler:
            handler()

        self.resetRegisters()
        # self.monitor.reset()

        self.config = {}

    def removeEntries(self):
        self.switch.ClearTable(table="egress.header_replace.header_replace")
        self.switch.ClearTable(table="ingress.p4tg.forward")

        logging.debug("Removed previous state.")
