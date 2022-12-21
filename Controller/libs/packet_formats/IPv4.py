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
from libs.packet_formats.UDP import UDP

def ip2int(addr):
    return struct.unpack("!I", socket.inet_aton(addr))[0]


class IPv4(Packet):
    def __init__(self, tos=0, proto=17, src="127.0.0.1", dst="127.0.0.1"):
        self.tos = tos
        self.proto = proto
        self.src = src
        self.dst = dst

        # we only support standard 20 byte IPv4 header
        self.ihl = 5
        self.version = 4
        self.flags = 0
        self.offset = 0
        self.ttl = 64

        # needs to be updated when we add data
        self.tol = 20

        # we calculate it when we build the packet
        self.checksum = 0

        self.data = None

    def __calculate_checksum(self):
        if self.data:
            self.tol = 20 + len(self.data)
        else:
            self.tol = 20

        # combine version and ihl to 1 byte
        version_ihl = (self.version << 4) + self.ihl

        # combine flats and
        flags_offset = (self.flags << 13) + self.offset

        bytes = list(reversed(struct.pack('!BBHHHBBLL',
                                          version_ihl,
                                          self.tos,
                                          self.tol,
                                          1,
                                          flags_offset,
                                          self.ttl,
                                          self.proto,
                                          ip2int(self.src),
                                          ip2int(self.dst)
                                          )))

        sum = 0

        for i in range(0, len(bytes), 2):
            tmp = bytes[i] + (bytes[i + 1] << 8)
            sum = ((sum + tmp) & 0xFFFF) + ((sum + tmp) >> 16)

        sum = ~sum & 0xFFFF

        return sum

    def get_checksum(self):
        return self.__calculate_checksum()

    def build(self):
        if self.data:
            self.tol = 20 + len(self.data)
        else:
            self.tol = 20

        # combine version and ihl to 1 byte
        version_ihl = (self.version << 4) + self.ihl

        # combine flats and
        flags_offset = (self.flags << 13) + self.offset

        ip_pkt = struct.pack('!BBHHHBBHLL',
                            version_ihl,
                            self.tos,
                            self.tol,
                            1,
                            flags_offset,
                            self.ttl,
                            self.proto,
                            self.get_checksum(),
                            ip2int(self.src),
                            ip2int(self.dst)
                            )

        if self.data:
            d = bytearray(ip_pkt)
            ip_pkt = bytes(d + bytearray(bytes(self.data)))

        return ip_pkt

    def __len__(self):
        return len(self.build())

    def __bytes__(self):
        return self.build()

    def __truediv__(self, other):
        if self.data:
            self.data = self.data / other
        else:
            self.data = other

            if type(other) == UDP:
                other.set_ip_src(self.src)
                other.set_ip_dst(self.dst)

        self.tol = 20 + len(self.data)

        return self


ip = IPv4()
