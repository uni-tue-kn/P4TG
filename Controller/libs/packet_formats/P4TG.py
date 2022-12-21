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


class P4TG(Packet):

    def __init__(self, seq=0, tx_tstmp=0, app_id=0):
        self.seq = seq
        self.tx_tstmp = tx_tstmp
        self.app_id = app_id

        self.data = None

    def build(self):
        p4tg = struct.pack('!I6sB',
                           self.seq,
                           self.tx_tstmp.to_bytes(6, "big"),
                           self.app_id)

        if self.data:
            d = bytearray(p4tg)
            p4tg = bytes(d + bytearray(bytes(self.data)))

        return p4tg

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
