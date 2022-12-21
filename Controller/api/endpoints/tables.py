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


class Tables:
    def __init__(self, switch=None, tables=None):
        self.switch=switch
        self.tables = tables

    def on_get(self, req, resp):
        data = {}

        for t in self.tables:
            table = self.switch.bfrt_info.table_get(t)
            entries = table.entry_get(self.switch.target)

            t_data = []

            for e in entries:
                data_dict = e[0].to_dict()
                if "is_default_entry" in data_dict:
                    del data_dict["is_default_entry"]

                t_data.append({"key": e[1].to_dict(), "data": data_dict})

            data[t] = t_data

        resp.media = data