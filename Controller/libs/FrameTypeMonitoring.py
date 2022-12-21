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

import bfrt_grpc.client as gc
import socket
import struct

from collections import defaultdict


def ip2int(addr):
    return struct.unpack("!I", socket.inet_aton(addr))[0]


class FrameTypeMonitoring:
    def __init__(self, switch=None, port_mapping=None):
        self.switch = switch
        self.port_mapping = port_mapping

        self.frame_ranges = [(0, 63), (64, 0), (65, 62), (128, 127), (256, 255), (512, 511), (1024, 494), (1519, 20000)]

        self.entries_exists = False

        self.prefix = "ingress.p4tg.frame_type"

    def add_frame_monitoring(self):
        frame_type_table = self.switch.bfrt_info.table_get("{}.frame_type_monitor".format(self.prefix))

        if self.entries_exists:
            return

        for p in self.port_mapping:
            # multicast entry tx
            frame_type_table.entry_add(
                self.switch.target,
                [frame_type_table.make_key([gc.KeyTuple('ig_intr_md.ingress_port', self.port_mapping.get(p).get("tx_recirc")),
                                            gc.KeyTuple('hdr.ipv4.dst_addr', ip2int("224.0.0.0"),
                                                        prefix_len=8)])],
                [frame_type_table.make_data([], '{}.multicast'.format(self.prefix))])

            # multicast entry rx
            frame_type_table.entry_add(
                self.switch.target,
                [frame_type_table.make_key(
                    [gc.KeyTuple('ig_intr_md.ingress_port', self.port_mapping.get(p).get("rx_recirc")),
                     gc.KeyTuple('hdr.ipv4.dst_addr', ip2int("224.0.0.0"),
                                 prefix_len=8)])],
                [frame_type_table.make_data([], '{}.multicast'.format(self.prefix))])

            # unicast default entry tx
            frame_type_table.entry_add(
                self.switch.target,
                [frame_type_table.make_key([gc.KeyTuple('ig_intr_md.ingress_port', self.port_mapping.get(p).get("tx_recirc")),
                                            gc.KeyTuple('hdr.ipv4.dst_addr', ip2int("192.168.178.0"),
                                                        prefix_len=0)])],
                [frame_type_table.make_data([], '{}.unicast'.format(self.prefix))])

            # unicast default entry rx
            frame_type_table.entry_add(
                self.switch.target,
                [frame_type_table.make_key(
                    [gc.KeyTuple('ig_intr_md.ingress_port', self.port_mapping.get(p).get("rx_recirc")),
                     gc.KeyTuple('hdr.ipv4.dst_addr', ip2int("192.168.178.0"),
                                 prefix_len=0)])],
                [frame_type_table.make_data([], '{}.unicast'.format(self.prefix))])

        self.entries_exists = True

    def del_frame_monitoring(self):
        frame_type_table = self.switch.bfrt_info.table_get("ingress.p4tg.frame_type.frame_type_monitor")

        if not self.entries_exists:
            return

        for p in self.port_mapping:
            # multicast entry tx
            frame_type_table.entry_del(
                self.switch.target,
                [frame_type_table.make_key([gc.KeyTuple('ig_intr_md.ingress_port', self.port_mapping.get(p).get("tx_recirc")),
                                            gc.KeyTuple('hdr.ipv4.dst_addr', ip2int("224.0.0.0"),
                                                        prefix_len=8)])])

            frame_type_table.entry_del(
                self.switch.target,
                [frame_type_table.make_key(
                    [gc.KeyTuple('ig_intr_md.ingress_port', self.port_mapping.get(p).get("rx_recirc")),
                     gc.KeyTuple('hdr.ipv4.dst_addr', ip2int("224.0.0.0"),
                                 prefix_len=8)])])

            # unicast entry tx
            frame_type_table.entry_del(
                self.switch.target,
                [frame_type_table.make_key([gc.KeyTuple('ig_intr_md.ingress_port', self.port_mapping.get(p).get("tx_recirc")),
                                            gc.KeyTuple('hdr.ipv4.dst_addr', ip2int("192.168.178.0"),
                                                        prefix_len=0)])])

            # unicast entry rx
            frame_type_table.entry_del(
                self.switch.target,
                [frame_type_table.make_key(
                    [gc.KeyTuple('ig_intr_md.ingress_port', self.port_mapping.get(p).get("rx_recirc")),
                     gc.KeyTuple('hdr.ipv4.dst_addr', ip2int("192.168.178.0"),
                                 prefix_len=0)])])

        self.entries_exists = False

    def get_statistics(self):
        stats = self.switch.bfrt_info.table_get("{}.frame_type_monitor".format(self.prefix))

        # Synchronize the counters
        stats.operations_execute(gc.Target(0), 'SyncCounters')

        # Get the counters
        stats = [(k, d) for (d, k) in stats.entry_get(gc.Target(0), [], {'from_hw': False})]

        ret = defaultdict(lambda: {"tx": {"multicast": 0, "broadcast": 0, "unicast": 0, "total": 0, "non-unicast": 0}, "rx": {"multicast": 0, "broadcast": 0, "unicast": 0, "total": 0, "non-unicast": 0}})

        for s in stats:
            key = s[0].to_dict()
            data = s[1].to_dict()

            send_type = "none"

            for p in self.port_mapping:
                if key["ig_intr_md.ingress_port"]["value"] == self.port_mapping.get(p).get("tx_recirc"):
                    send_type = "tx"
                elif key["ig_intr_md.ingress_port"]["value"] == self.port_mapping.get(p).get("rx_recirc"):
                    send_type = "rx"

                if send_type != "none":
                    mode = "none"
                    if data["action_name"] == "{}.multicast".format(self.prefix):
                        mode = "multicast"
                    elif data["action_name"] == "{}.broadcast".format(self.prefix):
                        mode = "broadcast"
                    elif data["action_name"] == "{}.unicast".format(self.prefix):
                        mode = "unicast"

                    if mode != "none":
                        ret[p][send_type][mode] = data["$COUNTER_SPEC_PKTS"]

        for p in ret:
            for key in ret.get(p):
                ret[p][key]["total"] = ret[p][key]["multicast"] + ret[p][key]["broadcast"] + ret[p][key]["unicast"]
                ret[p][key]["non-unicast"] = ret[p][key]["multicast"] + ret[p][key]["broadcast"]

        return ret
