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

import logging

import traceback


class TrafficGen:
    post_schema = {
        "type": "object",
        "properties": {
            "mode": {
                "type": "string"
            },
            "streams": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "frame_size": {
                            "type": "integer"
                        },
                        "traffic_rate": {
                            "type": "number"
                        },
                        "stream_id": {
                            "type": "number",
                        },
                        "app_id": {
                            "type": "number"
                        },
                        "burst": {
                            "type": "integer"
                        }

                    },
                    "required": ["frame_size", "traffic_rate", "stream_id", "app_id", "burst"]
                }
            },
            "port_tx_rx_mapping": {
                "type": "object",
                "items": {
                    "type": "object",
                    "additionalProperties": {
                        "type": "string"
                    }
                }
            },
            "stream_settings": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "port": {
                            "type": "number"
                        },
                        "stream_id": {
                            "type": "number"
                        },
                        "eth_src": {
                            "type": "string"
                        },
                        "eth_dst": {
                            "type": "string"
                        },
                        "ip_src": {
                            "type": "string"
                        },
                        "ip_dst": {
                            "type": "string"
                        },
                        "ip_dst_mask": {
                            "type": "string"
                        },
                        "ip_src_mask": {
                            "type": "string"
                        },
                        "ip_tos": {
                            "type": "integer"
                        }
                    },
                    "required": ["port", "stream_id", "eth_src", "eth_dst", "ip_src", "ip_dst", "ip_dst_mask",
                                 "ip_src_mask", "ip_tos"]
                }
            }
        },
        "required": ["streams", "mode", "stream_settings", "port_tx_rx_mapping"]
    }

    def __init__(self, tg=None):
        self.tg = tg

    def on_get(self, req, resp):
        resp.media = self.tg.config if self.tg.running else {}

    @jsonschema.validate(post_schema)
    def on_post(self, req, resp):
        data = req.get_media()

        try:
            self.tg.configureTrafficGen(streams=data["streams"],
                                        mode=data["mode"],
                                        stream_settings=data["stream_settings"],
                                        port_mapping=data["port_tx_rx_mapping"]
                                        )

            resp.media = {
                "message": "Configured traffic gen for streams: {}".format(data["streams"])
            }

        except Exception as e:
            traceback.print_exc()
            resp.status = falcon.HTTP_400
            resp.media = {
                "message": "{}".format(e)
            }

    def on_delete(self, req, resp):
        try:
            self.tg.stopTrafficGen()

            resp.media = {
                "message": "Traffic gen stopped."
            }
        except Exception as e:
            resp.status = falcon.HTTP_400
            resp.media = {
                "message": "{}".format(e)
            }
