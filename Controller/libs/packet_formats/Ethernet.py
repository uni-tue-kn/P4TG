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
from libs.packet_formats.Packet import Packet


def mac_to_int(mac):
    return int(mac.replace(":", ""), 16)


class Ethernet(Packet):

    def __init__(self, src="00:00:00:00:00:00", dst="00:00:00:00:00:00", type=0x800):
        self.src = mac_to_int(src)
        self.dst = mac_to_int(dst)
        self.type = type
        self.data = None

    def build(self):
        eth_pkt = struct.pack('!6s6sH', self.dst.to_bytes(6, 'big'), self.src.to_bytes(6, 'big'), self.type)

        if self.data:
            d = bytearray(eth_pkt)
            eth_pkt = bytes(d + bytearray(bytes(self.data)))

        return eth_pkt

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
