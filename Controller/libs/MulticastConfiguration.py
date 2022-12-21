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

"""
This module manages the native IPMC multicast groups on the P4 switch
"""
from collections import defaultdict
from ptf.thriftutils import *


class MulticastConfiguration:

    def __init__(self, switch=None):
        self.switch = switch

        # mapping of multicast identifier to various other values
        self.mcgrp_to_port = defaultdict(list)
        self.mcgrp_to_gid = defaultdict(int)
        self.mcgrp_to_nid = defaultdict(int)
        self.mcgrp_to_id = defaultdict(int)

    def add_mc_grp(self, name="DefaultMC", ports=None):
        """
        Add a multicast group for ports
        :param ports: List of ports
        :param name: Name of the mc grp
        :return: MC Grp ID
        """
        dev_ports = ports

        identifier = name

        if identifier in self.mcgrp_to_id:
            g_id = self.mcgrp_to_id[identifier]
        else:
            g_id = max(self.mcgrp_to_id.values()) + 1 if len(self.mcgrp_to_id.values()) > 0 else 2
            self.mcgrp_to_id[identifier] = g_id

        ################################################################################
        # destory old mc grp
        ################################################################################
        if identifier in self.mcgrp_to_gid:
            self.switch.mc.mc_mgrp_destroy(self.switch.mc_sess_hdl, 0, self.mcgrp_to_gid[identifier])

        ################################################################################
        # create new mc grp
        ################################################################################
        gid = self.switch.mc.mc_mgrp_create(self.switch.mc_sess_hdl, 0, g_id)
        self.mcgrp_to_gid[identifier] = gid

        ################################################################################
        # destroy node associated with ports
        ################################################################################
        if identifier in self.mcgrp_to_nid:
            self.switch.mc.mc_node_destroy(self.switch.mc_sess_hdl, 0, self.mcgrp_to_nid[identifier])

        ################################################################################
        # create node associated with ports
        ################################################################################
        nid = self.switch.mc.mc_node_create(self.switch.mc_sess_hdl, 0, g_id, set_port_map(dev_ports), set_lag_map([]))
        self.mcgrp_to_nid[identifier] = nid

        ################################################################################
        # associate node and grp
        ################################################################################
        self.switch.mc.mc_associate_node(self.switch.mc_sess_hdl, 0, gid, nid, 0, 0)

        print("mc id: {} to ports {}".format(g_id, dev_ports))

        return g_id

    def delete_mc_group(self, name="DefaultMC"):
        ################################################################################
        # destory old mc grp
        ################################################################################
        if name in self.mcgrp_to_gid:
            self.switch.mc.mc_mgrp_destroy(self.switch.mc_sess_hdl, 0, self.mcgrp_to_gid[name])

        ################################################################################
        # destroy node associated with ports
        ################################################################################
        if name in self.mcgrp_to_nid:
            self.switch.mc.mc_node_destroy(self.switch.mc_sess_hdl, 0, self.mcgrp_to_nid[name])

        del self.mcgrp_to_gid[name]
        del self.mcgrp_to_id[name]
        del self.mcgrp_to_nid[name]




def set_port_map(indices):
    bit_map = [0] * int(((288 + 7) / 8))
    for i in indices:
        index = portToBitIdx(i)
        id_x = int(index / 8)
        bit_map[id_x] = (bit_map[id_x] | (1 << (index % 8))) & 0xFF

    return bytes_to_string(bit_map)


def portToBitIdx(port):
    pipe = port >> 7
    index = port & 0x7F

    return 72 * pipe + index


def set_lag_map(indices):
    bit_map = [0] * int(((256 * 7) / 8))

    for i in indices:
        id_x = int(i / 8)
        bit_map[id_x] = (bit_map[id_x] | (1 << (i % 8))) & 0xFF

    return bytes_to_string(bit_map)
