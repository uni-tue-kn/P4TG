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
from pal_rpc.ttypes import *


class PortManager:
    def __init__(self, switch=None):
        self.switch = switch

    def get_ports(self):
        ports = []
        port_table = self.switch.bfrt_info.table_get('$PORT')
        all_ports = list(port_table.entry_get(self.switch.target))

        for p in all_ports:
            data = p[0].to_dict()
            key = p[1].to_dict()
            speed = data["$SPEED"]
            fec = data["$FEC"]
            loopback = data["$LOOPBACK_MODE"]
            an = data["$AUTO_NEGOTIATION"]
            oper = data["$PORT_UP"]
            enabled = data["$PORT_ENABLE"]
            port = int(data["$PORT_NAME"].split("/")[0])
            channel = int(data["$PORT_NAME"].split("/")[1])

            ports.append(
                {"pid": key["$DEV_PORT"]["value"], "enabled": enabled, "status": oper, "fec": fec, "auto_neg": an,
                 "loopback": loopback, "port": port,
                 "channel": channel,
                 "speed": speed})

        return ports

    def add_port(self, port=0, channel=0, speed=0, fec=False, auto_neg=0, loopback=False):
        logging.debug(
            "Add port {}/{} speed {} autoneg {} fec {} loopback {}".format(port, channel, speed, auto_neg, fec,
                                                                           loopback))
        p_id = self.switch.pal.pal_port_front_panel_port_to_dev_port_get(0, port, channel)
        self.switch.pal.pal_port_del(0, p_id)

        self.switch.pal.pal_port_add(0, p_id, speed, fec)
        self.switch.pal.pal_port_an_set(0, p_id, auto_neg)
        self.switch.pal.pal_port_enable(0, p_id)

        if loopback:
            self.switch.pal.pal_port_loopback_mode_set(0, p_id, 1)

    def update_port(self, p_id=0, speed="BF_SPEED_100G", fec="BF_FEC_TYP_NONE", auto_neg="BF_AN_DEFAULT"):
        auto_neg = auto_neg.replace("PM", "BF")
        self.switch.pal.pal_port_del(0, p_id)

        self.switch.pal.pal_port_add(0, p_id, pal_port_speed_t._NAMES_TO_VALUES[speed], pal_fec_type_t._NAMES_TO_VALUES[fec])
        self.switch.pal.pal_port_an_set(0, p_id, pal_autoneg_policy_t._NAMES_TO_VALUES[auto_neg])
        self.switch.pal.pal_port_enable(0, p_id)

    def get_port_id(self, port=0, channel=0):
        p_id = self.switch.pal.pal_port_front_panel_port_to_dev_port_get(0, port, channel)

        return p_id
