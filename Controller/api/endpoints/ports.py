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

import falcon
from falcon.media.validators import jsonschema

class Ports:
    post_schema = {
        "type": "object",
        "properties": {
            "pid": {
                "type": "number"
            },
            "speed": {
                "type": "string"
            },
            "fec": {
                "type": "string"
            },
            "auto_neg": {
                "type": "string"
            }
        },
        "required": ["pid", "speed", "fec"]
    }

    def __init__(self, pm=None):
        self.pm = pm

    def on_get(self, req, resp):
        data = list(
            map(lambda x: {"pid": self.pm.get_port_id(port=x["port"], channel=x["channel"]),
                           "port": x["port"], "channel": x["channel"], "speed": x["speed"],
                           "auto_neg": x["auto_neg"],
                           "fec": x["fec"],
                           "status": x["status"],
                           "loopback": x["loopback"]},
                self.pm.get_ports()))

        resp.media = data

    @jsonschema.validate(post_schema)
    def on_post(self, req, resp):
        data = req.get_media()

        try:
            self.pm.update_port(p_id=data["pid"], speed=data["speed"], fec=data["fec"], auto_neg=data["auto_neg"])

            resp.status = falcon.HTTP_201
            resp.media = {
                "message": "Port {} updated.".format(data["pid"])
            }
        except Exception as e:
            resp.status = falcon.HTTP_400
            resp.media = {
                "message": "{}".format(e)
            }
