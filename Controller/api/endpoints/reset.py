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

import logging


class Reset:

    def __init__(self, tg=None):
        self.tg = tg

    def on_get(self, req, resp):
        try:
            self.tg.reset()
            resp.media = {
                "message": "Reset complete."
            }
        except Exception as e:
            logging.error(e)

            resp.status = falcon.HTTP_500
            resp.media = {
                "message": "{}".format(e)
            }
