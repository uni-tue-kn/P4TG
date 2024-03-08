/* Copyright 2022-present University of Tuebingen, Chair of Communication Networks
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/*
 * Steffen Lindner (steffen.lindner@uni-tuebingen.de)
 */
use std::collections::HashMap;
use std::env;
use std::fs::File;
use std::str::FromStr;
use std::sync::Arc;
use rbfrt::{SwitchConnection};
use log::{info, warn};
use macaddr::MacAddr;
use rbfrt::error::RBFRTError;
use rbfrt::util::port_manager::{AutoNegotiation, FEC, Loopback, Port, Speed};
use rbfrt::util::PortManager;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

mod core;
mod api;
mod error;

use core::FrameSizeMonitor;
use crate::core::{ARP, FrameTypeMonitor, RateMonitor, TrafficGen};
use crate::core::traffic_gen_core::event::TrafficGenEvent;

#[derive(Debug, Copy, Clone)]
pub struct PortMapping {
    pub tx_recirculation: u32,
    pub rx_recirculation: u32,
    pub mac: MacAddr
}

/// Stores the start time of the current experiment
pub struct Experiment {
    start: std::time::SystemTime,
    running: bool
}

/// App state that is used between threads
pub struct AppState {
    pub(crate) frame_size_monitor: Mutex<FrameSizeMonitor>,
    pub(crate) frame_type_monitor: Mutex<FrameTypeMonitor>,
    pub(crate) traffic_generator: Mutex<TrafficGen>,
    pub(crate) port_mapping: HashMap<u32, PortMapping>,
    pub(crate) rate_monitor: Mutex<RateMonitor>,
    pub(crate) switch: SwitchConnection,
    pub(crate) pm: PortManager,
    pub(crate) experiment: Mutex<Experiment>,
    pub(crate) sample_mode: bool,
    pub(crate) config: Mutex<Config>,
    pub(crate) arp_handler: ARP
}

async fn configure_ports(switch: &mut SwitchConnection, pm: &PortManager, config: &Config, recirculation_ports: &Vec<u32>, port_mapping: &mut HashMap<u32, PortMapping>) -> Result<(), RBFRTError> {
    // Delete previously configured ports
    switch.clear_table("$PORT").await?;

    let mut port_requests = vec![];
    let mut tg_ports = vec![];

    // TG_PORTS
    for tg in &config.tg_ports {
        let pm_req = Port::new(tg.port , 0)
            .speed(Speed::BF_SPEED_100G)
            .fec(FEC::BF_FEC_TYP_NONE)
            .auto_negotiation(AutoNegotiation::PM_AN_DEFAULT);

        // we validated the mac address before
        tg_ports.push((tg.port, MacAddr::from_str(&*tg.mac).unwrap()));

        port_requests.push(pm_req);
    }

    // Recirculation ports
    for port in recirculation_ports {
        let pm_req = Port::new(*port , 0)
            .speed(Speed::BF_SPEED_100G)
            .fec(FEC::BF_FEC_TYP_NONE)
            .auto_negotiation(AutoNegotiation::PM_AN_DEFAULT)
            .loopback(Loopback::BF_LPBK_MAC_NEAR);

        port_requests.push(pm_req);
    }

    pm.add_ports(&switch, &port_requests).await?;

    info!("Ports of device configured.");

    // create port mapping
    let mut offset = 0;

    port_mapping.clear();

    for (index, (port, mac)) in tg_ports.iter().enumerate() {
        let dev_port = pm.dev_port(*port, 0)?;
        let tx_port = pm.dev_port(*recirculation_ports.get(index+offset).unwrap(), 0)?;
        let rx_port = pm.dev_port(*recirculation_ports.get(index+offset+1).unwrap(), 0)?;

        port_mapping.insert(dev_port, PortMapping { tx_recirculation: tx_port, rx_recirculation: rx_port, mac: *mac });

        offset += 1;
    }

    Ok(())
}


#[derive(Deserialize, Serialize, Debug, Clone)]
struct PortDescription {
    port: u32,
    mac: String,
    arp_reply: Option<bool>
}


#[derive(Deserialize, Debug, Serialize, Clone)]
pub struct Config {
    tg_ports: Vec<PortDescription>
}

impl Default for Config {
    fn default() -> Self {
        let macs = vec!["fa:a6:68:e0:3d:70", "00:d0:67:a2:a9:42", "40:28:e3:cd:64:35", "be:6a:94:e8:3c:3c",
                        "d6:67:75:a1:94:c3", "e2:bd:1e:02:dc:b4", "d0:b3:7f:59:2c:4a",  "84:08:f3:bc:2b:ac",
                        "06:6c:cc:db:86:9c", "c0:db:54:17:15:0f"];
        Config {
            tg_ports: (1..11).collect::<Vec<_>>()
                .iter()
                .enumerate()
                .map(|(i, v)| PortDescription { port: *v, mac: macs.get(i).unwrap().parse().unwrap(), arp_reply: None })
                .collect()
        }
    }
}

impl Config {
    pub fn contains(&self, other: u32) -> bool {
        for i in &self.tg_ports {
            if i.port == other {
                return true;
            }
        }

        return false;
    }

    fn validate(&self) -> bool {
        for port in &self.tg_ports {
            if MacAddr::from_str(&*port.mac).is_err() {
                return false
            }
        }

        !(self.tg_ports.len() > 10
            || self.tg_ports.clone().into_iter().filter(|p| p.port > 32).collect::<Vec<_>>().len() > 0)
    }

    fn update_arp_state(&mut self, port: u32, state: bool) {
        for p in &mut self.tg_ports {
            if p.port == port {
                p.arp_reply = Some(state);
            }
        }
    }
}

async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let sample_mode = env::var("SAMPLE").unwrap_or("0".to_owned()).parse().unwrap_or(0);
    let sample_mode = if sample_mode == 1 { true } else { false };
    let p4_name = env::var("P4_NAME").unwrap_or("traffic_gen".to_owned());

    info!("Start controller...");

    let mut switch = SwitchConnection::new("localhost", 50052)
        .device_id(0)
        .client_id(1)
        .p4_name(&p4_name)
        .connect()
        .await?;

    // Front panel ports that can be used for traffic generation.
    // At default, the first 10 ports are used for traffic generation.
    let all_ports: Vec<u32> = (1..33).collect(); // we dont have a 64-port Tofino for testing purposes
                                                 // limit to 32 ports

    // TG ports either from config or default
    let config = match File::open("/app/config.json") {
        Ok(file) => {
            let mut config: Config = serde_json::from_reader(file).unwrap_or_else(|_| {
                warn!("Config file not valid. Using default config.");
                Config::default()
            });

            if !config.validate() {
                warn!("Config not valid. At most 10 ports can be used, and no front panel port > 32. \
                       Mac addresses need to be correct. \
                       Using default config.");
                config = Config::default();
            }

            config

        }
        Err(_) => {
            warn!("No config file for controller found. Using default config.");
            Config::default()
        }
    };

    if config.tg_ports.is_empty() {
        panic!("No traffic generation ports should be configured.");
    }

    // Front panel ports that are used for recirculation purposes
    // Recirculations are needed for measurement purposes
    let recirculation_ports: Vec<u32> = all_ports.into_iter().filter(|p| !config.contains(*p)).collect();

    let mut port_mapping: HashMap<u32, PortMapping> = HashMap::new();

    let pm = PortManager::new(&mut switch).await;

    configure_ports(&mut switch, &pm, &config, &recirculation_ports, &mut port_mapping).await?;

    // configures frame size count tables
    let frame_size_monitor = FrameSizeMonitor::new(port_mapping.clone());

    // configures frame type count tables (multicast, broadcast, vlan, ipv4, ...)
    let frame_type_monitor = FrameTypeMonitor::new(port_mapping.clone());

    // configures rate monitoring and monitoring packets related tables
    let mut rate_monitor = RateMonitor::new(port_mapping.clone());
    rate_monitor.init_rtt_meter(&switch).await?;
    rate_monitor.init_iat_meter(&switch, sample_mode).await?;
    rate_monitor.on_reset(&switch).await?;

    let mut traffic_generator = TrafficGen::new();
    traffic_generator.stop(&switch).await?;

    let index_mapping = traffic_generator.init_monitoring_packet(&switch, &port_mapping).await?;

    let arp_handler = ARP::new();
    arp_handler.init(&switch, &port_mapping).await?;

    let state = Arc::new(AppState {
        frame_size_monitor: Mutex::new(frame_size_monitor),
        frame_type_monitor: Mutex::new(frame_type_monitor),
        traffic_generator: Mutex::new(traffic_generator),
        port_mapping,
        rate_monitor: Mutex::new(rate_monitor),
        switch,
        pm,
        sample_mode,
        experiment: Mutex::new(Experiment { start: std::time::SystemTime::now(), running: false }),
        config: Mutex::new(config),
        arp_handler
    });

    state.frame_size_monitor.lock().await.configure(&state.switch).await?;
    state.frame_type_monitor.lock().await.configure(&state.switch).await?;

    let monitoring_state = Arc::clone(&state);

    // start iat monitoring
    tokio::spawn( async move {
        let local_state = monitoring_state;

        RateMonitor::monitor_iat(local_state).await;
    });

    let monitoring_state = Arc::clone(&state);

    // start frame type monitoring
    tokio::spawn(async move {
        let local_state = monitoring_state;

        FrameSizeMonitor::monitor_statistics(local_state).await;
    });

    let monitoring_state = Arc::clone(&state);

    // start frame type monitoring
    tokio::spawn(async move {
        let local_state = monitoring_state;

        FrameTypeMonitor::monitor_statistics(local_state).await;
    });

    let monitoring_state = Arc::clone(&state);

    // start digest monitoring
    tokio::spawn(async move {
        let local_state = monitoring_state;

        RateMonitor::monitor_digests(local_state, &index_mapping, sample_mode).await;
    });

    // start rest API
    api::server::start_api_server(Arc::clone(&state)).await;

    Ok(())
}


#[tokio::main]
async fn main() -> () {
    env_logger::init();

    match run().await {
        Ok(_) => {}
        Err(e) => {
            warn!("Error: {}", e);
        }
    }
}