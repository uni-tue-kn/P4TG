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
use log::{info, warn};
use macaddr::MacAddr;
use rbfrt::error::RBFRTError;
use rbfrt::table::ActionData;
use rbfrt::util::PortManager;
use rbfrt::util::{AutoNegotiation, Loopback, Port, Speed, FEC};
use rbfrt::{table, SwitchConnection};
use std::collections::HashMap;
use std::collections::HashSet;
use std::env;
use std::fs::File;
use std::str::FromStr;
use std::sync::Arc;
use tokio::sync::Mutex;

mod api;
mod core;
mod error;

use crate::api::statistics::StatisticsApi;
use crate::api::statistics::TimeStatisticsApi;
use crate::core::traffic_gen_core::const_definitions::{
    DEVICE_CONFIGURATION, DEVICE_CONFIGURATION_TF2, PORT_CFG_TF2,
};
use crate::core::traffic_gen_core::event::TrafficGenEvent;
use crate::core::traffic_gen_core::helper::breakout_mapping;
use crate::core::{
    Arp, Config, DurationMonitorTask, FrameSizeMonitor, FrameTypeMonitor, HistogramMonitor,
    RateMonitor, TrafficGen,
};

#[derive(Debug, Copy, Clone)]
pub struct PortMapping {
    pub tx_recirculation: u32,
    pub rx_recirculation: u32,
    pub front_panel_port: u32,
    pub mac: MacAddr,
    pub breakout_mode: Option<bool>,
    pub channel: u8,
}

/// Stores the start time of the current experiment
pub struct Experiment {
    start: std::time::SystemTime,
    running: bool,
}

#[derive(Clone, Debug)]
struct RecChoice {
    tx_port: u32,
    tx_speed: Option<Speed>,
    tx_fec: Option<FEC>,
    tx_auto_neg: Option<AutoNegotiation>,
    rx_port: u32,
    rx_speed: Option<Speed>,
    rx_fec: Option<FEC>,
    rx_auto_neg: Option<AutoNegotiation>,
}

/// Stores statistics and configurations, as well as an abort signal for multiple tests
pub struct MultiTest {
    pub(crate) collected_statistics: Mutex<Vec<StatisticsApi>>,
    pub(crate) collected_time_statistics: Mutex<Vec<TimeStatisticsApi>>,
    pub(crate) multiple_test_monitor_task: Mutex<DurationMonitorTask>,
}

/// App state that is used between threads
pub struct AppState {
    pub(crate) frame_size_monitor: Mutex<FrameSizeMonitor>,
    pub(crate) frame_type_monitor: Mutex<FrameTypeMonitor>,
    pub(crate) traffic_generator: Mutex<TrafficGen>,
    pub(crate) port_mapping: HashMap<u32, PortMapping>,
    pub(crate) rate_monitor: Mutex<RateMonitor>,
    pub(crate) rtt_histogram_monitor: Mutex<HistogramMonitor>,
    pub(crate) switch: SwitchConnection,
    pub(crate) pm: PortManager,
    pub(crate) experiment: Mutex<Experiment>,
    pub(crate) sample_mode: bool,
    pub(crate) config: Mutex<Config>,
    pub(crate) arp_handler: Arp,
    pub(crate) tofino2: bool,
    pub(crate) loopback_mode: bool,
    pub(crate) monitor_task: Mutex<DurationMonitorTask>,
    pub(crate) multiple_tests: MultiTest,
}

async fn configure_ports(
    switch: &mut SwitchConnection,
    pm: &PortManager,
    config: &mut Config,
    recirculation_ports: &[u32],
    port_mapping: &mut HashMap<u32, PortMapping>,
    is_tofino2: bool,
    loopback_mode: bool,
) -> Result<(), RBFRTError> {
    // Reset
    switch.clear_table("$PORT").await?;

    let mut port_requests = Vec::new();
    let mut auto_tg_ports = Vec::new();
    let mut manual_tg_ports = Vec::new();

    // --- TG ports ---
    for tg in &mut config.tg_ports {
        let speed = tg.speed.clone().unwrap_or(if is_tofino2 {
            Speed::BF_SPEED_400G
        } else {
            Speed::BF_SPEED_100G
        });
        let fec = tg.fec.clone().unwrap_or(if is_tofino2 {
            FEC::BF_FEC_TYP_REED_SOLOMON
        } else {
            FEC::BF_FEC_TYP_NONE
        });

        let (channels, per_channel_speed) =
            breakout_mapping(&speed, tg.breakout_mode.unwrap_or(false));

        if tg.breakout_mode == Some(true) && channels.len() == 1 {
            // Invalid speed configured for breakout mode
            tg.breakout_mode = Some(false);
            warn!("Invalid port speed for breakout mode on port configured. Only 100G and 40G are possible. Falling back to single channel.");
        }

        for c in channels {
            let mut req = Port::new(tg.port, c)
                .speed(per_channel_speed.clone())
                .fec(fec.clone())
                .auto_negotiation(
                    tg.auto_negotiation
                        .clone()
                        .unwrap_or(AutoNegotiation::PM_AN_DEFAULT),
                );

            if loopback_mode {
                req = req.loopback(Loopback::BF_LPBK_MAC_NEAR);
            }

            port_requests.push(req);
        }

        let mac = MacAddr::from_str(&tg.mac).unwrap(); // validated earlier
        if tg.recirculation_ports.is_some() {
            manual_tg_ports.push((tg.port, mac));
        } else {
            auto_tg_ports.push((tg.port, mac));
        }
    }

    // --- Build choices for each TG: config-first, then auto from remaining pool ---
    let mut per_tg_choice: HashMap<u32, RecChoice> = HashMap::new();
    let mut used_recirc: HashSet<u32> = HashSet::new();

    // Reserve manual mappings and enforce uniqueness up-front
    for tg in &config.tg_ports {
        if let Some(rec) = &tg.recirculation_ports {
            for &p in &[rec.tx.port, rec.rx.port] {
                if !used_recirc.insert(p) {
                    panic!("Recirculation port {p} is used more than once in config.");
                }
            }
            per_tg_choice.insert(
                tg.port,
                RecChoice {
                    tx_port: rec.tx.port,
                    tx_speed: rec.tx.speed.clone(),
                    tx_fec: rec.tx.fec.clone(),
                    tx_auto_neg: rec.tx.auto_negotiation.clone(),
                    rx_port: rec.rx.port,
                    rx_speed: rec.rx.speed.clone(),
                    rx_fec: rec.rx.fec.clone(),
                    rx_auto_neg: rec.rx.auto_negotiation.clone(),
                },
            );
        }
    }

    // Free pool = recirculation_ports minus manually used
    let free: Vec<u32> = recirculation_ports
        .iter()
        .copied()
        .filter(|p| !used_recirc.contains(p))
        .collect();

    let needed = auto_tg_ports.len() * 2;
    if free.len() < needed {
        panic!(
            "Not enough recirculation ports: need {}, have {} (after reserving manual mappings).",
            needed,
            free.len()
        );
    }

    // Assign pairs (2*i, 2*i+1) from the filtered pool
    for (i, (tg_port, _)) in auto_tg_ports.iter().enumerate() {
        per_tg_choice.insert(
            *tg_port,
            RecChoice {
                tx_port: free[2 * i],
                tx_speed: None,
                tx_fec: None,
                tx_auto_neg: None,
                rx_port: free[2 * i + 1],
                rx_speed: None,
                rx_fec: None,
                rx_auto_neg: None,
            },
        );
        used_recirc.insert(free[2 * i]);
        used_recirc.insert(free[2 * i + 1]);
    }

    // --- Configure recirc ports actually used ---
    let mut added_recirc_once: HashSet<(u32, u32)> = HashSet::new();

    for (tg_port, _) in manual_tg_ports.iter().chain(auto_tg_ports.iter()) {
        let tg_cfg = config
            .tg_ports
            .iter()
            .find(|p| &p.port == tg_port)
            .expect("internal: missing tg cfg");

        let base_speed = tg_cfg.speed.clone().unwrap_or(if is_tofino2 {
            Speed::BF_SPEED_400G
        } else {
            Speed::BF_SPEED_100G
        });
        let breakout = tg_cfg.breakout_mode.unwrap_or(false);
        let (channels, tg_per_ch_speed) = breakout_mapping(&base_speed, breakout);

        let choice = per_tg_choice
            .get(tg_port)
            .expect("internal: missing recirc choice");

        // TX recirc (use override speed if provided; otherwise match TG per-channel speed)
        let tx_per_ch_speed = if let Some(s) = choice.tx_speed.clone() {
            breakout_mapping(&s, breakout).1
        } else {
            tg_per_ch_speed.clone()
        };
        let tx_fec = choice.tx_fec.clone().unwrap_or(if is_tofino2 {
            FEC::BF_FEC_TYP_REED_SOLOMON
        } else {
            FEC::BF_FEC_TYP_NONE
        });
        let tx_an = choice
            .tx_auto_neg
            .clone()
            .unwrap_or(AutoNegotiation::PM_AN_DEFAULT);

        for &ch in &channels {
            if added_recirc_once.insert((choice.tx_port, ch as u32)) {
                port_requests.push(
                    Port::new(choice.tx_port, ch)
                        .speed(tx_per_ch_speed.clone())
                        .fec(tx_fec.clone())
                        .auto_negotiation(tx_an.clone())
                        .loopback(Loopback::BF_LPBK_MAC_NEAR),
                );
            }
        }

        // RX recirc
        let rx_per_ch_speed = if let Some(s) = choice.rx_speed.clone() {
            breakout_mapping(&s, breakout).1
        } else {
            tg_per_ch_speed.clone()
        };
        let rx_fec = choice.rx_fec.clone().unwrap_or(if is_tofino2 {
            FEC::BF_FEC_TYP_REED_SOLOMON
        } else {
            FEC::BF_FEC_TYP_NONE
        });
        let rx_an = choice
            .rx_auto_neg
            .clone()
            .unwrap_or(AutoNegotiation::PM_AN_DEFAULT);

        for &ch in &channels {
            if added_recirc_once.insert((choice.rx_port, ch as u32)) {
                port_requests.push(
                    Port::new(choice.rx_port, ch)
                        .speed(rx_per_ch_speed.clone())
                        .fec(rx_fec.clone())
                        .auto_negotiation(rx_an.clone())
                        .loopback(Loopback::BF_LPBK_MAC_NEAR),
                );
            }
        }
    }

    // Push to hardware
    pm.add_ports(switch, &port_requests).await?;
    info!("Ports of device configured.");

    // --- Build mapping (TG dev_port(+ch) -> recirc dev_ports(+ch)) ---
    port_mapping.clear();

    for (tg_port, mac) in manual_tg_ports.iter().chain(auto_tg_ports.iter()) {
        let tg_cfg = config
            .tg_ports
            .iter()
            .find(|p| &p.port == tg_port)
            .expect("internal: missing tg cfg");

        let base_speed = tg_cfg.speed.clone().unwrap_or(if is_tofino2 {
            Speed::BF_SPEED_400G
        } else {
            Speed::BF_SPEED_100G
        });
        let breakout = tg_cfg.breakout_mode.unwrap_or(false);
        let (channels, _per_ch_speed) = breakout_mapping(&base_speed, breakout);

        let choice = per_tg_choice
            .get(tg_port)
            .expect("internal: missing recirc choice");

        for &ch in &channels {
            let tx_dev = pm.dev_port(choice.tx_port, ch)?;
            let rx_dev = pm.dev_port(choice.rx_port, ch)?;
            let dev_port = pm.dev_port(*tg_port, ch)?;

            port_mapping.insert(
                dev_port,
                PortMapping {
                    tx_recirculation: tx_dev,
                    rx_recirculation: rx_dev,
                    mac: *mac,
                    front_panel_port: *tg_port,
                    breakout_mode: tg_cfg.breakout_mode,
                    channel: ch,
                },
            );
        }
    }

    // --- Final uniqueness assertion (dev_port-level) ---
    let mut seen_dev: HashSet<u32> = HashSet::new();
    for m in port_mapping.values() {
        if !seen_dev.insert(m.tx_recirculation) || !seen_dev.insert(m.rx_recirculation) {
            panic!("Recirculation ports not unique.");
        }
    }

    Ok(())
}

async fn run() -> Result<(), Box<dyn std::error::Error>> {
    //console_subscriber::init();

    let sample_mode = env::var("SAMPLE")
        .unwrap_or("0".to_owned())
        .parse()
        .unwrap_or(0);
    let sample_mode = sample_mode == 1;
    let p4_name = env::var("P4_NAME").unwrap_or("traffic_gen".to_owned());
    let loopback_mode = env::var("LOOPBACK")
        .unwrap_or("0".to_owned())
        .parse()
        .unwrap_or(false);

    // Automatically set to true by GitHub CI/CD. Used to deploy gh-pages
    let ci_docs = env::var("CI")
        .unwrap_or("0".to_owned())
        .parse()
        .unwrap_or(false);
    if ci_docs {
        info!("Building OpenAPI json file.");
        api::server::generate_api_json();
    }

    info!("Start controller...");

    let mut switch = SwitchConnection::builder("localhost", 50052)
        .device_id(0)
        .client_id(1)
        .p4_name(&p4_name)
        .connect()
        .await?;

    // check if its tofino 1 or tofino 2
    // this could be done more intelligent
    // we simply check if a table in tf2 scope exists
    let is_tofino2 = switch.has_table(PORT_CFG_TF2);

    let req = if is_tofino2 {
        info!("ASIC: Tofino2");
        table::Request::new(DEVICE_CONFIGURATION_TF2).default(true)
    } else {
        info!("ASIC: Tofino1");
        table::Request::new(DEVICE_CONFIGURATION).default(true)
    };

    let res = switch.get_table_entries(req).await.unwrap_or_default();
    let num_pipes = res[0]
        .get_action_data("num_pipes")
        .unwrap_or(&ActionData::new("num_pipes", 2))
        .as_u32();
    info!("#Pipes: {num_pipes:?}");

    // TODO find a way to derive this from device configuration
    let num_ports = env::var("NUM_PORTS")
        .unwrap_or("32".to_owned())
        .parse()
        .unwrap_or(32);

    if loopback_mode {
        info!("Loopback mode activated.");
    }

    // Front panel ports that can be used for traffic generation.
    // At default, the first 10 ports are used for traffic generation.
    let all_ports: Vec<u32> = (1..=num_ports).collect();

    // TG ports either from config or default
    let mut config = match File::open("config.json") {
        Ok(file) => {
            let config: Config = serde_json::from_reader(file).unwrap_or_else(|_| {
                warn!("Config file not valid. Using default config.");
                Config::default_tofino(is_tofino2)
            });

            let config = if let Err(err) = config.validate(num_ports) {
                warn!("{err} Using default config.");
                Config::default_tofino(is_tofino2)
            } else {
                config
            };

            config
        }
        Err(_) => {
            warn!("No config file (/app/config.json) for controller found. Using default config.");
            Config::default_tofino(is_tofino2)
        }
    };

    if config.tg_ports.is_empty() {
        panic!("No traffic generation ports should be configured.");
    }

    // Front panel ports that are used for recirculation purposes
    // Recirculations are needed for measurement purposes
    let recirculation_ports: Vec<u32> = all_ports
        .into_iter()
        .filter(|p| !config.contains(*p))
        .collect();

    let mut port_mapping: HashMap<u32, PortMapping> = HashMap::new();

    let pm = PortManager::new(&switch).await;

    configure_ports(
        &mut switch,
        &pm,
        &mut config,
        &recirculation_ports,
        &mut port_mapping,
        is_tofino2,
        loopback_mode,
    )
    .await?;

    // configures frame size count tables
    let frame_size_monitor = FrameSizeMonitor::new(port_mapping.clone());

    // configures frame type count tables (multicast, broadcast, vlan, ipv4, ...)
    let frame_type_monitor = FrameTypeMonitor::new(port_mapping.clone());

    // configures rate monitoring and monitoring packets related tables
    let mut rate_monitor = RateMonitor::new(port_mapping.clone());
    rate_monitor.init_rtt_meter(&switch).await?;
    rate_monitor.init_iat_meter(&switch, sample_mode).await?;
    rate_monitor.on_reset(&switch).await?;

    let rtt_histogram_monitor = HistogramMonitor::new(port_mapping.clone());

    let mut traffic_generator = TrafficGen::new(is_tofino2, num_pipes);
    traffic_generator.stop(&switch).await?;

    let index_mapping = traffic_generator
        .init_monitoring_packet(&switch, &port_mapping)
        .await?;

    let arp_handler = Arp::new();
    arp_handler.init(&switch, &port_mapping).await?;

    let state = Arc::new(AppState {
        frame_size_monitor: Mutex::new(frame_size_monitor),
        frame_type_monitor: Mutex::new(frame_type_monitor),
        traffic_generator: Mutex::new(traffic_generator),
        port_mapping,
        rate_monitor: Mutex::new(rate_monitor),
        rtt_histogram_monitor: Mutex::new(rtt_histogram_monitor),
        switch,
        pm,
        sample_mode,
        experiment: Mutex::new(Experiment {
            start: std::time::SystemTime::now(),
            running: false,
        }),
        config: Mutex::new(config),
        arp_handler,
        tofino2: is_tofino2,
        loopback_mode,
        monitor_task: Mutex::new(DurationMonitorTask {
            handle: None,
            cancel_token: None,
        }),
        multiple_tests: MultiTest {
            collected_statistics: Default::default(),
            collected_time_statistics: Default::default(),
            multiple_test_monitor_task: Mutex::new(DurationMonitorTask {
                handle: None,
                cancel_token: None,
            }),
        },
    });

    state
        .frame_size_monitor
        .lock()
        .await
        .configure(&state.switch)
        .await?;
    state
        .frame_type_monitor
        .lock()
        .await
        .configure(&state.switch)
        .await?;

    let monitoring_state = Arc::clone(&state);

    // start iat monitoring
    tokio::spawn(async move {
        let local_state = monitoring_state;

        RateMonitor::monitor_iat(local_state).await;
    });

    let monitoring_state = Arc::clone(&state);

    // start frame size monitoring
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

    // start RTT histogram monitoring
    tokio::spawn(async move {
        let local_state = monitoring_state;

        HistogramMonitor::monitor_histogram(local_state).await;
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
            warn!("Error: {e:#?}");
        }
    }
}
