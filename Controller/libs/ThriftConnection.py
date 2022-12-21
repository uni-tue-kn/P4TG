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

from thrift.transport import TSocket
from thrift.transport import TTransport
from thrift.protocol import TBinaryProtocol, TMultiplexedProtocol

import importlib

class ThriftConnection:
    def __init__(self, ip=None, port=9090):
        self.transport = TTransport.TBufferedTransport(TSocket.TSocket(ip, port))
        self.protocol = TBinaryProtocol.TBinaryProtocol(self.transport)
        self.conn_mgr_client_module = importlib.import_module(".".join(["conn_mgr_pd_rpc", "conn_mgr"]))
        self.conn_mgr_protocol = self.conn_mgr_protocol = TMultiplexedProtocol.TMultiplexedProtocol(self.protocol, "conn_mgr")
        self.conn_mgr = self.conn_mgr_client_module.Client(self.conn_mgr_protocol)

        self.transport.open()

        self.hdl = self.conn_mgr.client_init()

    def end(self):
        self.conn_mgr.client_cleanup(self.hdl)