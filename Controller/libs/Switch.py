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

from bfrt_grpc.client import ClientInterface
import bfrt_grpc.client as gc

from libs.ThriftConnection import ThriftConnection
from thrift.protocol import TBinaryProtocol, TMultiplexedProtocol

import logging
import importlib


class Switch:

    def __init__(self, name=None, ip="127.0.0.1", grpc_port=50052, thrift_port=9090, clear=True, program=""):
        self.name = name
        self.grpc_addr = ip + ":" + str(grpc_port)
        self.thrift = ThriftConnection(ip=ip, port=thrift_port)

        self.c = ClientInterface(self.grpc_addr, 1, 0)
        self.c.bind_pipeline_config(program)

        # pal
        self.pal_client_module = importlib.import_module(".".join(["pal_rpc", "pal"]))
        self.pal = self.pal_client_module.Client(TMultiplexedProtocol.TMultiplexedProtocol(self.thrift.protocol, "pal"))

        self.mc_client_module = importlib.import_module(".".join(["mc_pd_rpc", "mc"]))
        self.mc_protocol = TMultiplexedProtocol.TMultiplexedProtocol(self.thrift.protocol, "mc")
        self.mc = self.mc_client_module.Client(self.mc_protocol)
        self.mc_sess_hdl = self.mc.mc_create_session()

        if clear:
            self.c.clear_all_tables()

        self.bfrt_info = self.c.bfrt_info_get()
        self.target = gc.Target(device_id=0, pipe_id=0xffff)

    def clear(self):
        self.c.clear_all_tables()

    def TableEntry(self, table=None, match_fields=None, action_name="", action_params=None):
        bfrt_table = self.bfrt_info.table_get(table)

        keys = []

        for m in match_fields:
            if type(match_fields.get(m)) is tuple:
                keys.append(gc.KeyTuple(m, low=match_fields.get(m)[0], high=match_fields.get(m)[1]))
            else:
                keys.append(gc.KeyTuple(m, match_fields.get(m)))

        fields = bfrt_table.make_key(keys)

        data = []

        for a in action_params:
            data.append(gc.DataTuple(a, action_params.get(a)))

        action = bfrt_table.make_data(data, action_name)

        bfrt_table.entry_add(self.target, [fields], [action])

        logging.debug("Writing table entry on {} for {}: {} with action {} and params {}".format(self.name, table,
                                                                                                str(match_fields),
                                                                                                str(action_name),
                                                                                                str(action_params)))

    def RemoveEntry(self, table=None, match_fields=None):
        bfrt_table = self.bfrt_info.table_get(table)

        keys = []

        for m in match_fields:
            if type(match_fields.get(m)) is tuple:
                keys.append(gc.KeyTuple(m, low=match_fields.get(m)[0], high=match_fields.get(m)[1]))
            else:
                keys.append(gc.KeyTuple(m, match_fields.get(m)))

        fields = bfrt_table.make_key(keys)

        bfrt_table.entry_del(self.target, [fields])

        logging.debug("Deleting table entry on {} for {}: {}".format(self.name, table, str(match_fields)))

    def ClearTable(self, table=None):
        bfrt_table = self.bfrt_info.table_get(table)
        bfrt_table.entry_del(self.target)


    def UpdateEntry(self, table=None, match_fields=None, action_name="", action_params=None):
        bfrt_table = self.bfrt_info.table_get(table)

        keys = []

        for m in match_fields:
            keys.append(gc.KeyTuple(m, match_fields.get(m)))

        fields = bfrt_table.make_key(keys)

        data = []

        for a in action_params:
            data.append(gc.DataTuple(a, action_params.get(a)))

        action = bfrt_table.make_data(data, action_name)

        bfrt_table.entry_mod(self.target, [fields], [action])

        logging.debug("Update table entry on {} for {}: {} with action {} and params {}".format(self.name, table,
                                                                                                 str(match_fields),
                                                                                                 str(action_name),
                                                                                                 str(action_params)))

    def GetEntry(self, table=None, match_fields=None):
        bfrt_table = self.bfrt_info.table_get(table)

        keys = []

        for m in match_fields:
            keys.append(gc.KeyTuple(m, match_fields.get(m)))

        fields = bfrt_table.make_key(keys)

        entries = bfrt_table.entry_get(s.target, [fields])

        return entries

    def ResetRegister(self, register_name=""):
        reg_table = self.bfrt_info.table_get(register_name)
        reg_table.entry_del(self.target)

    def ReadRegister(self, register_name="", register_index=""):
        reg_table = self.bfrt_info.table_get(register_name)
        resp = reg_table.entry_get(
            self.target,
            [reg_table.make_key(
                [gc.KeyTuple('$REGISTER_INDEX', register_index)])],
            {"from_hw": True})

        return next(resp)

    def __del__(self):
        self.shutdown()


    def shutdown(self):
        logging.debug("Shutting down connection to {}".format(self.name))

        try:
            self.mc.mc_destroy_session(self.mc_sess_hdl)
        except Exception as e:
            pass

        self.thrift.end()
        self.c.channel.close()
