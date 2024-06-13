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
use rbfrt::util::port_manager::FEC::BF_FEC_TYP_REED_SOLOMON;
use rbfrt::util::PortManager;
use tokio::sync::Mutex;

mod core;
mod api;
mod error;

use core::FrameSizeMonitor;
use crate::core::{Arp, Config, FrameTypeMonitor, RateMonitor, TrafficGen};
use crate::core::traffic_gen_core::const_definitions::{PORT_CFG_TF2};
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
    pub(crate) arp_handler: Arp,
    pub(crate) tofino2: bool,
    pub(crate) loopback_mode: bool
}

async fn configure_ports(switch: &mut SwitchConnection, pm: &PortManager, config: &Config,
                         recirculation_ports: &Vec<u32>, port_mapping: &mut HashMap<u32, PortMapping>,
                         is_tofino2: bool, loopback_mode: bool) -> Result<(), RBFRTError> {
    // Delete previously configured ports
    switch.clear_table("$PORT").await?;

    let mut port_requests = vec![];
    let mut tg_ports = vec![];

    // TG_PORTS
    for tg in &config.tg_ports {
        let mut pm_req = Port::new(tg.port , 0)
            .speed(if is_tofino2 {Speed::BF_SPEED_400G} else {Speed::BF_SPEED_100G})
            .fec(if is_tofino2 {BF_FEC_TYP_REED_SOLOMON} else {FEC::BF_FEC_TYP_NONE})
            .auto_negotiation(AutoNegotiation::PM_AN_DEFAULT);

        if loopback_mode { // loopback mode is used for testing if no cables are available
            pm_req = pm_req.loopback(Loopback::BF_LPBK_MAC_NEAR);
        }

        // we validated the mac address before
        tg_ports.push((tg.port, MacAddr::from_str(&tg.mac).unwrap()));

        port_requests.push(pm_req);
    }

    // Recirculation ports
    for port in recirculation_ports {
        let pm_req = Port::new(*port , 0)
            .speed(if is_tofino2 {Speed::BF_SPEED_400G} else {Speed::BF_SPEED_100G})
            .fec(if is_tofino2 {BF_FEC_TYP_REED_SOLOMON} else {FEC::BF_FEC_TYP_NONE})
            .auto_negotiation(AutoNegotiation::PM_AN_DEFAULT)
            .loopback(Loopback::BF_LPBK_MAC_NEAR);

        port_requests.push(pm_req);
    }

    pm.add_ports(switch, &port_requests).await?;

    info!("Ports of device configured.");

    port_mapping.clear();

    for (offset, (index, (port, mac))) in tg_ports.iter().enumerate().enumerate() {
        let dev_port = pm.dev_port(*port, 0)?;
        let tx_port = pm.dev_port(*recirculation_ports.get(index+offset).unwrap(), 0)?;
        let rx_port = pm.dev_port(*recirculation_ports.get(index+offset+1).unwrap(), 0)?;

        port_mapping.insert(dev_port, PortMapping { tx_recirculation: tx_port, rx_recirculation: rx_port, mac: *mac });
    }

    // Verify that all recirculation ports are unique
    let mut used_recirculation_ports = vec![];

    for port in port_mapping.values() {
        used_recirculation_ports.push(port.tx_recirculation);
        used_recirculation_ports.push(port.rx_recirculation);
    }

    used_recirculation_ports.dedup();

    if used_recirculation_ports.len() != tg_ports.len() * 2 {
        panic!("Recirculation ports not unique.")
    }

    Ok(())
}

async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let sample_mode = env::var("SAMPLE").unwrap_or("0".to_owned()).parse().unwrap_or(0);
    let sample_mode = sample_mode == 1;
    let p4_name = env::var("P4_NAME").unwrap_or("traffic_gen".to_owned());
    let loopback_mode = env::var("LOOPBACK").unwrap_or("0".to_owned()).parse().unwrap_or(false);

    info!("Start controller...");

    let mut switch = SwitchConnection::new("localhost", 50052)
        .device_id(0)
        .client_id(1)
        .p4_name(&p4_name)
        .connect()
        .await?;

    // check if its tofino 1 or tofino 2
    // this could be done more intelligent
    // we simply check if a table in tf2 scope exists
    let is_tofino2 = switch.has_table(PORT_CFG_TF2);

    if is_tofino2 {
        info!("ASIC: Tofino2");
    }
    else {
        info!("ASIC: Tofino1");
    }

    if loopback_mode {
        info!("Loopback mode activated.");
    }

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
            warn!("No config file (/app/config.json) for controller found. Using default config.");
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

    let pm = PortManager::new(&switch).await;

    configure_ports(&mut switch, &pm, &config, &recirculation_ports, &mut port_mapping, is_tofino2, loopback_mode).await?;

    // configures frame size count tables
    let frame_size_monitor = FrameSizeMonitor::new(port_mapping.clone());

    // configures frame type count tables (multicast, broadcast, vlan, ipv4, ...)
    let frame_type_monitor = FrameTypeMonitor::new(port_mapping.clone());

    // configures rate monitoring and monitoring packets related tables
    let mut rate_monitor = RateMonitor::new(port_mapping.clone());
    rate_monitor.init_rtt_meter(&switch).await?;
    rate_monitor.init_iat_meter(&switch, sample_mode).await?;
    rate_monitor.on_reset(&switch).await?;

    let mut traffic_generator = TrafficGen::new(is_tofino2);
    traffic_generator.stop(&switch).await?;

    let index_mapping = traffic_generator.init_monitoring_packet(&switch, &port_mapping).await?;

    let arp_handler = Arp::new();
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
        arp_handler,
        tofino2: is_tofino2,
        loopback_mode
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
async fn main() {
    env_logger::init();

    match run().await {
        Ok(_) => {}
        Err(e) => {
            warn!("Error: {}", e);
        }
    }
}