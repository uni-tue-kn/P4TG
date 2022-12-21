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

import threading
import logging

import bfrt_grpc.client as gc

from collections import deque, defaultdict


class MiniDigest:
    def __init__(self, data=None):
        self.data = data


class RateMonitor:
    def __init__(self, switch=None, port_mapping=None, monitor_indices=None):
        self.switch = switch
        self.running = True
        self.port_mapping = port_mapping

        self.monitor_indices = monitor_indices

        self.last_tx = {}
        self.tx_rate_l1 = defaultdict(int)
        self.tx_rate_l2 = defaultdict(int)

        self.last_rx = {}
        self.rx_rate_l1 = defaultdict(int)
        self.rx_rate_l2 = defaultdict(int)

        self.last_app_tx = {}
        self.tx_app_rate_l2 = defaultdict(lambda: defaultdict(int))

        self.last_app_rx = {}
        self.rx_app_rate_l2 = defaultdict(lambda: defaultdict(int))

        self.packet_loss = defaultdict(int)
        self.out_of_order = defaultdict(int)

        self.iats_tx = defaultdict(lambda: deque(maxlen=50000))
        self.iats_rx = defaultdict(lambda: deque(maxlen=50000))

        self.rtt = defaultdict(lambda: deque(maxlen=10000))

        self.digest_ids = {"2387752937": "digest", "2388474472": "digest_2", "2394318618": "digest_3"}

        self.init_iat_meter()
        self.init_rtt_meter()
        self.init_monitoring_rules()

        self.iat_measure = False
        self.rtt_measure = False

        threading.Thread(target=self.monitor).start()

    def init_monitoring_rules(self):
        for p in self.port_mapping:
            self.switch.TableEntry(table="ingress.p4tg.is_ingress",
                                   match_fields={
                                       "ig_intr_md.ingress_port": self.port_mapping.get(p).get("rx_recirc")
                                   },
                                   action_name="ingress.p4tg.nop",
                                   action_params={})

    def init_iat_meter(self):
        meter_table = self.switch.bfrt_info.table_get("ingress.p4tg.iat.digest_rate")
        target = self.switch.target

        target_pps = 500
        packet_size_bytes = 64 + 20

        cir_kbps = int(target_pps * packet_size_bytes * 10 ** -3)
        pir_kbps = cir_kbps
        cbs = cir_kbps
        pbs = 2 * cbs

        for x in range(256):
            meter_table.entry_add(
                target,
                [meter_table.make_key(
                    [gc.KeyTuple('$METER_INDEX', x)])],
                [meter_table.make_data(
                    [gc.DataTuple('$METER_SPEC_CIR_KBPS', cir_kbps),
                     gc.DataTuple('$METER_SPEC_PIR_KBPS', pir_kbps),
                     gc.DataTuple('$METER_SPEC_CBS_KBITS', cbs),
                     gc.DataTuple('$METER_SPEC_PBS_KBITS', pbs)])])

        logging.info("Configured IAT meter")

    def init_rtt_meter(self):
        meter_table = self.switch.bfrt_info.table_get("ingress.p4tg.rtt.digest_rate")
        target = self.switch.target

        target_pps = 500
        packet_size_bytes = 64 + 20

        cir_kbps = int(target_pps * packet_size_bytes * 10 ** -3)
        pir_kbps = cir_kbps
        cbs = cir_kbps
        pbs = 2 * cbs

        for x in range(256):
            meter_table.entry_add(
                target,
                [meter_table.make_key(
                    [gc.KeyTuple('$METER_INDEX', x)])],
                [meter_table.make_data(
                    [gc.DataTuple('$METER_SPEC_CIR_KBPS', cir_kbps),
                     gc.DataTuple('$METER_SPEC_PIR_KBPS', pir_kbps),
                     gc.DataTuple('$METER_SPEC_CBS_KBITS', cbs),
                     gc.DataTuple('$METER_SPEC_PBS_KBITS', pbs)])])

        logging.info("Configured RTT meter")

    def start_iat_measure(self):
        self.iat_measure = True

    def stop_iat_measure(self):
        self.iat_measure = False

    def start_rtt_measure(self):
        self.rtt_measure = True

    def stop_rtt_measure(self):
        self.rtt_measure = False

    def reset(self):
        self.last_tx = {}
        self.tx_rate_l1 = defaultdict(int)
        self.tx_rate_l2 = defaultdict(int)

        self.last_rx = {}
        self.rx_rate_l1 = defaultdict(int)
        self.rx_rate_l2 = defaultdict(int)

        self.last_app_tx = {}
        self.tx_app_rate_l2 = defaultdict(lambda: defaultdict(int))

        self.last_app_rx = {}
        self.rx_app_rate_l2 = defaultdict(lambda: defaultdict(int))

        self.packet_loss = defaultdict(int)

        self.rtt = defaultdict(lambda: deque(maxlen=10000))

        self.iats_tx = defaultdict(lambda: deque(maxlen=50000))
        self.iats_rx = defaultdict(lambda: deque(maxlen=50000))

        # reset IAT registers
        self.switch.ResetRegister(register_name="ingress.p4tg.iat.lower_last_rx")
        self.switch.ResetRegister(register_name="ingress.p4tg.iat.higher_last_rx")

        # self.app_indices = defaultdict(int)

    def update(self, digest_data=None, last=None):
        if digest_data["tstmp"] > last["tstmp"] + 2 * 10 ** 9:
            t_diff = digest_data["tstmp"] - last["tstmp"]
            b_diff_l1 = digest_data["byte_counter_l1"] - last["byte_counter_l1"]
            b_diff_l2 = digest_data["byte_counter_l2"] - last["byte_counter_l2"]

            rate_l1 = 8 * (b_diff_l1 / t_diff) * 10 ** 9
            rate_l2 = 8 * (b_diff_l2 / t_diff) * 10 ** 9

            if digest_data["byte_counter_l1"] < digest_data["byte_counter_l2"]:
                print("l1 count: {}, l2 count: {}".format(digest_data["byte_counter_l1"], digest_data["byte_counter_l2"]))

            if rate_l1 < rate_l2:
                print("l1: {} l2: {} b_diff_l1: {} b_diff_l2: {} t_diff: {}".format(rate_l1, rate_l2, b_diff_l1, b_diff_l2, t_diff))

            return digest_data, rate_l1, rate_l2
        elif digest_data["tstmp"] < last["tstmp"]:  # overflow
            return digest_data, 0, 0
        else:
            return last, 0, 0

    def update_app(self, digest_data=None, last=None):
        if digest_data["tstmp"] > last["tstmp"] + 2 * 10 ** 9:
            t_diff = digest_data["tstmp"] - last["tstmp"]
            b_diff = digest_data["app_counter"] - last["app_counter"]

            rate = 8 * (b_diff / t_diff) * 10 ** 9

            return digest_data, rate
        elif digest_data["tstmp"] < last["tstmp"]:  # overflow
            return digest_data, 0
        else:
            return last, 0

    def monitor(self):
        while self.running:
            try:
                raw_entries = self.switch.c.digest_get(timeout=2)
                try:
                    digest_name = self.digest_ids[str(raw_entries.digest_id)]
                except KeyError:
                    raise ValueError("Digest ID is not known to SwitchController!")

                learn_filter = self.switch.bfrt_info.learn_get(digest_name)
                data_list = learn_filter.make_data_list(raw_entries)

                for e in data_list:
                    data = e.to_dict()

                    if "index" in data:
                        port = data["port"]

                        app_id = 0

                        for key in self.monitor_indices:
                            if self.monitor_indices.get(key) == data["index"]:
                                app_id = key[1]

                                break

                        for p in self.port_mapping:
                            # it's a tx message
                            if self.port_mapping[p]["tx_recirc"] == port:
                                if p not in self.last_tx:
                                    self.last_tx[p] = data

                                last, rate_l1, rate_l2 = self.update(data, self.last_tx[p])

                                if last != self.last_tx[p]:
                                    self.last_tx[p] = last
                                    self.tx_rate_l1[p] = rate_l1
                                    self.tx_rate_l2[p] = rate_l2

                                if (p, app_id) not in self.last_app_tx:
                                    self.last_app_tx[(p, app_id)] = data

                                last, rate = self.update_app(data, self.last_app_tx[(p, app_id)])

                                if last != self.last_app_tx[(p, app_id)]:
                                    self.last_app_tx[(p, app_id)] = last
                                    self.tx_app_rate_l2[p][app_id] = rate

                                break

                            # it's a rx message
                            if self.port_mapping[p]["rx_recirc"] == port:
                                app_id -= 1

                                if p not in self.last_rx:
                                    self.last_rx[p] = data

                                self.packet_loss[p] = max(0, data["packet_loss"] - data["out_of_order"])
                                self.out_of_order[p] = data["out_of_order"]

                                last, rate_l1, rate_l2 = self.update(data, self.last_rx[p])

                                if last != self.last_rx[p]:
                                    self.last_rx[p] = last
                                    self.rx_rate_l1[p] = rate_l1
                                    self.rx_rate_l2[p] = rate_l2

                                if (p, app_id) not in self.last_app_rx:
                                    self.last_app_rx[(p, app_id)] = data

                                last, rate = self.update_app(data, self.last_app_rx[(p, app_id)])

                                if last != self.last_app_rx[(p, app_id)]:
                                    self.last_app_rx[(p, app_id)] = last
                                    self.rx_app_rate_l2[p][app_id] = rate

                                break

                        continue

                    if "iat" in data and self.iat_measure and data["iat"] > 0:
                        port = data["port"]

                        for p in self.port_mapping:
                            # it's a tx message
                            if self.port_mapping[p]["tx_recirc"] == port:
                                self.iats_tx[p].append(data["iat"])

                                break

                            if self.port_mapping[p]["rx_recirc"] == port:
                                self.iats_rx[p].append(data["iat"])

                                break

                    if "rtt" in data and self.rtt_measure and data["rtt"] > 0:
                        port = data["port"]

                        for p in self.port_mapping:
                            if self.port_mapping[p]["rx_recirc"] == port:
                                # Add rtt measurement
                                self.rtt[p].append(data["rtt"])

                                break

            except Exception as e:

                logging.error("Error: {}".format(e))
