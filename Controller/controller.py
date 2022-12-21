#!/usr/bin/env python3
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
import sys
import time
import os

sys.path.append("/opt/python_packages/site-packages/tofino")
sys.path.append("/opt/python_packages/site-packages/tofino/bfrt_grpc")
sys.path.append("/opt/python_packages//site-packages")
sys.path.append("/opt/python_packages/site-packages/bf-ptf")

from libs.PortManager import PortManager
from libs.Switch import Switch
from libs.TrafficGen import TrafficGen
from libs.FrameMonitoring import FrameMonitoring
from libs.FrameTypeMonitoring import FrameTypeMonitoring

from libs.RateMonitor import RateMonitor

import logging
import threading

logging.basicConfig(level=logging.DEBUG, datefmt='%m/%d/%Y %I:%M:%S', format='[%(levelname)s] %(asctime)s %(message)s')

from api.server import RestAPI

def main():
    s1 = Switch(name="s1", ip="127.0.0.1", grpc_port=50052, thrift_port=9090, program="traffic_gen")
    pm = PortManager(switch=s1)

    tg_ports = range(1, 11)
    recirc_ports = range(11, 33)

    # Add tg ports (ports that can be used to transmit / receive traffic
    # Only frontports 1-10
    for p in tg_ports:
        pm.add_port(port=p, channel=0, speed=7, fec=0, auto_neg=0)

    # Add recirc ports, used for processing
    for p in recirc_ports:
        pm.add_port(port=p, channel=0, speed=7, fec=0, auto_neg=0, loopback=True)

    # Dev Port to recir port mapping
    devport_to_recirc_port_mapping = {}
    offset = 0
    for (i, p) in enumerate(tg_ports):
        dev_port = s1.pal.pal_port_front_panel_port_to_dev_port_get(0, p, 0)
        tx_recirc = s1.pal.pal_port_front_panel_port_to_dev_port_get(0, recirc_ports[i + offset], 0)
        rx_recirc = s1.pal.pal_port_front_panel_port_to_dev_port_get(0, recirc_ports[i+1+offset], 0)
        devport_to_recirc_port_mapping[dev_port] = {"tx_recirc": tx_recirc, "rx_recirc": rx_recirc}

        offset += 1


    frame = FrameMonitoring(switch=s1, port_mapping=devport_to_recirc_port_mapping)
    frame_type = FrameTypeMonitoring(switch=s1, port_mapping=devport_to_recirc_port_mapping)

    tg = TrafficGen(switch=s1, port_mapping=devport_to_recirc_port_mapping, frame_monitor=frame)

    monitor = RateMonitor(switch=s1, port_mapping=devport_to_recirc_port_mapping, monitor_indices=tg.indices)

    # start iat/rtt monitor only after 10 seconds, this filters too large iat from old packet
    tg.on_start(lambda: threading.Timer(10, monitor.start_iat_measure).start())
    tg.on_start(lambda: threading.Timer(10, monitor.start_rtt_measure).start())

    # add frame monitoring rules
    tg.on_start(frame_type.add_frame_monitoring)

    # add frame size monitoring rules
    tg.on_start(frame.add_ranges)

    tg.on_stop(monitor.stop_iat_measure)
    tg.on_stop(monitor.stop_rtt_measure)

    tg.on_reset(monitor.reset)
    tg.on_reset(frame.del_ranges)
    tg.on_reset(frame_type.del_frame_monitoring)

    api = RestAPI(switch=s1, tg=tg, pm=pm, rate=monitor, frame_monitor=frame, frame_type=frame_type)

    api.start()

    monitor.running = False



main()