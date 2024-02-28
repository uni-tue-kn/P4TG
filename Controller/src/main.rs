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
use std::sync::Arc;
use rbfrt::SwitchConnection;
use log::{info, warn};
use rbfrt::util::port_manager::{AutoNegotiation, FEC, Loopback, Port, Speed};
use rbfrt::util::PortManager;
use tokio::sync::Mutex;

mod core;
mod api;
mod error;

use core::FrameSizeMonitor;
use crate::core::{FrameTypeMonitor, RateMonitor, TrafficGen};
use crate::core::traffic_gen_core::event::TrafficGenEvent;

#[derive(Debug, Copy, Clone)]
pub struct PortMapping {
    pub tx_recirculation: u32,
    pub rx_recirculation: u32
}

/// Stores the start time of the current experiment
pub struct Experiment {
    start: std::time::SystemTime,
    running: bool
}

/// App state that is used between threads
#[derive()]
pub struct AppState {
    pub(crate) frame_size_monitor: Mutex<FrameSizeMonitor>,
    pub(crate) frame_type_monitor: Mutex<FrameTypeMonitor>,
    pub(crate) traffic_generator: Mutex<TrafficGen>,
    pub(crate) port_mapping: HashMap<u32, PortMapping>,
    pub(crate) rate_monitor: Mutex<RateMonitor>,
    pub(crate) switch: SwitchConnection,
    pub(crate) pm: PortManager,
    pub(crate) experiment: Mutex<Experiment>,
    pub(crate) sample_mode: bool
}

async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let sample_mode = env::var("SAMPLE").unwrap_or("0".to_owned()).parse().unwrap_or(0);
    let sample_mode = if sample_mode == 1 { true } else { false };

    info!("Start controller...");

    // Front panel ports that can be used for traffic generation.
    // At the moment, the first 10 ports are used for traffic generation.
    let tg_ports: Vec<u32> = (1..11).collect();

    // Front panel ports that are used for recirculation purposes
    // Recirculations are needed for measurement purposes
    let recirculation_ports: Vec<u32> = (11..33).collect();

    let mut port_mapping: HashMap<u32, PortMapping> = HashMap::new();

    let mut switch = SwitchConnection::new("localhost", 50052)
        .device_id(0)
        .client_id(1)
        .p4_name("traffic_gen")
        .connect()
        .await?;

    // Delete previously configured ports
    switch.clear_table("$PORT").await?;

    let pm = PortManager::new(&mut switch).await;

    let mut port_requests = vec![];

    // TG_PORTS
    for port in &tg_ports {
        let pm_req = Port::new(*port , 0)
            .speed(Speed::BF_SPEED_100G)
            .fec(FEC::BF_FEC_TYP_NONE)
            .auto_negotiation(AutoNegotiation::PM_AN_DEFAULT);

        port_requests.push(pm_req);
    }

    // Recirculation ports
    for port in &recirculation_ports {
        let pm_req = Port::new(*port , 0)
            .speed(Speed::BF_SPEED_100G)
            .fec(FEC::BF_FEC_TYP_NONE)
            .auto_negotiation(AutoNegotiation::PM_AN_DEFAULT)
            .loopback(Loopback::BF_LPBK_MAC_NEAR);

        port_requests.push(pm_req);
    }

    pm.add_ports(&mut switch, &port_requests).await?;

    info!("Ports of device configured.");

    // create port mapping
    let mut offset = 0;

    for (index, port) in tg_ports.iter().enumerate() {
        let dev_port = pm.dev_port(*port, 0)?;
        let tx_port = pm.dev_port(*recirculation_ports.get(index+offset).unwrap(), 0)?;
        let rx_port = pm.dev_port(*recirculation_ports.get(index+offset+1).unwrap(), 0)?;

        port_mapping.insert(dev_port, PortMapping { tx_recirculation: tx_port, rx_recirculation: rx_port });

        offset += 1;
    }

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

    let state = Arc::new(AppState {
        frame_size_monitor: Mutex::new(frame_size_monitor),
        frame_type_monitor: Mutex::new(frame_type_monitor),
        traffic_generator: Mutex::new(traffic_generator),
        port_mapping,
        rate_monitor: Mutex::new(rate_monitor),
        switch,
        pm,
        sample_mode,
        experiment: Mutex::new(Experiment { start: std::time::SystemTime::now(), running: false })
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