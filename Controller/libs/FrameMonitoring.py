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

from collections import defaultdict

class FrameMonitoring:
    def __init__(self, switch=None, port_mapping=None):
        self.switch = switch
        self.port_mapping = port_mapping

        self.frame_ranges = [(0, 63), (64, 0), (65, 62), (128, 127), (256, 255), (512, 511), (1024, 494), (1519, 20000)]
        #self.frame_ranges = [(x, 0) for x in range(60, 70)]

        self.entries_exists = False

    def add_ranges(self):
        frame_size_table = self.switch.bfrt_info.table_get("egress.frame_size_monitor")

        if self.entries_exists:
            return

        for p in self.port_mapping:
            for i in self.frame_ranges:
                # tx count
                frame_size_table.entry_add(
                    self.switch.target,
                    [frame_size_table.make_key([gc.KeyTuple('$MATCH_PRIORITY', 1),
                                                gc.KeyTuple('eg_intr_md.egress_port',
                                                            p),
                                                gc.KeyTuple('pkt_len',
                                                            low=i[0],
                                                            high=i[0] + i[1])])],
                    [frame_size_table.make_data([], 'egress.nop')])

                # rx count
                frame_size_table.entry_add(
                    self.switch.target,
                    [frame_size_table.make_key([gc.KeyTuple('$MATCH_PRIORITY', 1),
                                                gc.KeyTuple('eg_intr_md.egress_port',
                                                            self.port_mapping.get(p).get("rx_recirc")),
                                                gc.KeyTuple('pkt_len',
                                                            low=i[0],
                                                            high=i[0] + i[1])])],
                    [frame_size_table.make_data([], 'egress.nop')])

        self.entries_exists = True

    def del_ranges(self):
        frame_size_table = self.switch.bfrt_info.table_get("egress.frame_size_monitor")

        if not self.entries_exists:
            return

        for p in self.port_mapping:
            for i in self.frame_ranges:
                # tx count
                frame_size_table.entry_del(
                    self.switch.target,
                    [frame_size_table.make_key([gc.KeyTuple('$MATCH_PRIORITY', 1),
                                                gc.KeyTuple('eg_intr_md.egress_port',
                                                            p),
                                                gc.KeyTuple('pkt_len',
                                                            low=i[0],
                                                            high=i[0] + i[1])])])
                # rx count
                frame_size_table.entry_del(
                    self.switch.target,
                    [frame_size_table.make_key([gc.KeyTuple('$MATCH_PRIORITY', 1),
                                                gc.KeyTuple('eg_intr_md.egress_port',
                                                            self.port_mapping.get(p).get("rx_recirc")),
                                                gc.KeyTuple('pkt_len',
                                                            low=i[0],
                                                            high=i[0] + i[1])])])

        self.entries_exists = False

    def get_statistics(self):
        stats = self.switch.bfrt_info.table_get("egress.frame_size_monitor")

        # Synchronize the counters
        stats.operations_execute(gc.Target(0), 'SyncCounters')

        # Get the counters
        stats = [(k, d) for (d, k) in stats.entry_get(gc.Target(0), [], {'from_hw': False})]

        ret = defaultdict(lambda: defaultdict(list))

        for s in stats:
            key = s[0].to_dict()
            data = s[1].to_dict()

            port = key["eg_intr_md.egress_port"]["value"]

            for p in self.port_mapping:
                type = "unknown"

                if p == port:
                    type = "tx"
                elif self.port_mapping.get(p).get("rx_recirc") == port:
                    type = "rx"

                if type != "unknown":
                    ret[p][type].append({"low": key["pkt_len"]["low"],
                                "high": key["pkt_len"]["high"],
                                "packets": data["$COUNTER_SPEC_PKTS"]})



        return ret
