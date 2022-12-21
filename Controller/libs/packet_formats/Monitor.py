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


class Monitor(Packet):

    def __init__(self):
        self.tstmp = 0
        self.byte_counter_l1 = 0
        self.byte_counter_l2 = 0
        self.packet_loss = 0
        self.app_counter = 0
        self.out_of_order = 0
        self.port = 0
        self.index = 0

        self.data = None

    def build(self):
        port_index = (self.port << 15) + self.index

        monitor = struct.pack('!6sQQQ6s5s3s',
                              self.tstmp.to_bytes(6, "big"),
                              self.byte_counter_l1,
                              self.byte_counter_l2,
                              self.packet_loss,
                              self.app_counter.to_bytes(6, "big"),
                              self.out_of_order.to_bytes(5, "big"),
                              port_index.to_bytes(3, "big"))

        if self.data:
            d = bytearray(monitor)
            monitor = bytes(d + bytearray(bytes(self.data)))

        return monitor

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
