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

from wsgiref.simple_server import make_server, WSGIServer

import falcon
from api.endpoints.online import Online
from api.endpoints.trafficgen import TrafficGen
from api.endpoints.ports import Ports
from api.endpoints.statistics import Statistics
from api.endpoints.reset import Reset
from api.endpoints.tables import Tables

import logging

class SilentWSGIServer(WSGIServer):
    # block socket for at most 5 seconds
    request_timeout = 5

    def get_request(self):
        request, client_addr = super().get_request()
        request.settimeout(self.request_timeout)
        return request, client_addr

class RestAPI:
    def __init__(self, switch=None, tg=None, pm=None, rate=None, frame_monitor=None, frame_type=None):
        self.app = falcon.App(cors_enable=True)

        traffic_gen = TrafficGen(tg=tg)

        tables = ["ingress.p4tg.tg_forward", "ingress.p4tg.monitor_forward", "ingress.p4tg.frame_type.frame_type_monitor",
                  "egress.header_replace.header_replace", "egress.frame_size_monitor"]

        self.app.add_route('/online', Online())
        self.app.add_route('/trafficgen', traffic_gen)
        self.app.add_route('/ports', Ports(pm=pm))
        self.app.add_route('/reset', Reset(tg=tg))
        self.app.add_route('/tables', Tables(switch=switch, tables=tables))
        self.app.add_route('/statistics',
                           Statistics(rate=rate, frame_monitor=frame_monitor, frame_type=frame_type))

        #self.app.add_route('/statistics', Statistics(rate=rate, frame_monitor=tg.frame_monitor, frame_type=tg.frame_type_monitor))

    def start(self, port=8000):
        self.running = True
        httpd = make_server("", port, self.app, server_class=SilentWSGIServer)
        logging.info("Starting REST-API server on port {}".format(port))

        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            httpd.__shutdown_request = True
            pass

        httpd.server_close()
