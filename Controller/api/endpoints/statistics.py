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
import numpy as np
import falcon

from collections import defaultdict
from copy import copy

class Statistics:

    def __init__(self, rate=None, frame_monitor=None, frame_type=None):
        self.rate = rate
        self.frame_monitor = frame_monitor
        self.frame_type = frame_type

    def on_get(self, req, resp):

        rtts = defaultdict(lambda: {})
        iats = defaultdict(lambda: defaultdict(lambda: {}))

        for p in copy(self.rate.rtt):
            rtts[p]["mean"] = 0 if len(self.rate.rtt.get(p)) == 0 else int(np.mean(self.rate.rtt.get(p)))
            rtts[p]["min"] = 0 if len(self.rate.rtt.get(p)) == 0 else int(np.min(self.rate.rtt.get(p)))
            rtts[p]["max"] = 0 if len(self.rate.rtt.get(p)) == 0 else int(np.max(self.rate.rtt.get(p)))
            rtts[p]["current"] = 0 if len(self.rate.rtt.get(p)) == 0 else int(self.rate.rtt.get(p)[-1])
            rtts[p]["jitter"] = 0 if len(self.rate.rtt.get(p)) == 0 else int(np.std(self.rate.rtt.get(p)))
            rtts[p]["n"] = len(self.rate.rtt.get(p))

        for p in copy(self.rate.iats_tx):
            iats[p]["tx"]["mean"] = 0 if len(self.rate.iats_tx.get(p)) == 0 else np.mean(self.rate.iats_tx.get(p))
            iats[p]["tx"]["std"] = 0 if len(self.rate.iats_tx.get(p)) == 0 else np.std(self.rate.iats_tx.get(p))
            iats[p]["tx"]["n"] = len(self.rate.iats_tx.get(p))

        for p in copy(self.rate.iats_rx):
            iats[p]["rx"]["mean"] = 0 if len(self.rate.iats_rx.get(p)) == 0 else np.mean(self.rate.iats_rx.get(p))
            iats[p]["rx"]["std"] = 0 if len(self.rate.iats_rx.get(p)) == 0 else np.std(self.rate.iats_rx.get(p))
            iats[p]["rx"]["n"] = len(self.rate.iats_rx.get(p))

        resp.media = {
            "tx_rate_l1": self.rate.tx_rate_l1,
            "tx_rate_l2": self.rate.tx_rate_l2,
            "rx_rate_l1": self.rate.rx_rate_l1,
            "rx_rate_l2": self.rate.rx_rate_l2,
            "app_tx_l2": self.rate.tx_app_rate_l2,
            "app_rx_l2": self.rate.rx_app_rate_l2,
            "frame_size": self.frame_monitor.get_statistics(),
            "frame_type_data": self.frame_type.get_statistics(),
            "rtts": rtts,
            "iats": iats,
            "packet_loss": self.rate.packet_loss,
            "out_of_order": self.rate.out_of_order
        }