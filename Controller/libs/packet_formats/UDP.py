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

import struct
import socket
from libs.packet_formats.Packet import Packet


def ip2int(addr):
    return struct.unpack("!I", socket.inet_aton(addr))[0]


class UDP(Packet):

    def __init__(self, sport=5900, dport=5900):
        self.sport = sport
        self.dport = dport
        self.len = 8
        self.data = None

        # needed for pseudoheader
        self.__ip_src = None
        self.__ip_dst = None

    def set_ip_src(self, ip_src):
        self.__ip_src = ip_src

    def set_ip_dst(self, ip_dst):
        self.__ip_dst = ip_dst

    def get_ip_src(self):
        return self.__ip_src

    def build(self):
        orig_data = []

        if self.data:
            orig_data = bytes(self.data)

        udp = struct.pack('!HHHH',
                          self.sport,
                          self.dport,
                          8 + len(orig_data),
                          self.get_checksum())

        if self.data:
            d = bytearray(udp)
            udp = bytes(d + bytearray(bytes(self.data)))

        return udp

    def get_checksum(self):
        return self.__calculate_checksum()

    def __calculate_checksum(self):
        data_bytes = []
        orig_data = []

        if self.data:
            data_bytes = bytes(reversed(bytes(self.data)))
            orig_data = bytes(self.data)

            # align to two bytes
            if len(data_bytes) % 2 != 0:
                data_bytes = bytes(bytearray(1) + bytearray(data_bytes))

        pseudo_header_bytes = list(reversed(struct.pack('!LLBBH',
                                                        ip2int(self.__ip_src),
                                                        ip2int(self.__ip_dst),
                                                        0,
                                                        17,
                                                        8 + len(orig_data)
                                                        )))

        udp_header_bytes = list(reversed(struct.pack('!HHH',
                                                     self.sport,
                                                     self.dport,
                                                     8 + len(orig_data))))

        all_data = bytes(bytearray(pseudo_header_bytes) + bytearray(udp_header_bytes) + bytearray(data_bytes))

        sum = 0

        for i in range(0, len(all_data), 2):
            tmp = all_data[i] + (all_data[i + 1] << 8)
            sum = ((sum + tmp) & 0xFFFF) + ((sum + tmp) >> 16)

        sum = ~sum & 0xFFFF

        if sum == 0:
            sum = 0xFFFF

        return sum

    def __len__(self):
        return len(self.build())

    def __bytes__(self):
        return self.build()

    def __truediv__(self, other):
        if self.data:
            self.data = self.data / other
        else:
            self.data = other

        return self
