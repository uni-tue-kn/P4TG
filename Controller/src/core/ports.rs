use log::{info, warn};
use macaddr::MacAddr;
use rbfrt::error::RBFRTError;
use rbfrt::util::PortManager;
use rbfrt::util::{AutoNegotiation, Loopback, Port, Speed, FEC};
use rbfrt::SwitchConnection;
use std::collections::HashMap;
use std::collections::HashSet;
use std::str::FromStr;

use crate::core::config::RecirculationPair;
use crate::PortMapping;

use crate::core::traffic_gen_core::helper::{breakout_mapping, get_base_speed};
use crate::core::Config;

struct TGPortConfiguration {
    port_requests: Vec<Port>,
    auto_tg_ports: Vec<(u32, MacAddr)>,
    manual_tg_ports: Vec<(u32, MacAddr)>,
}

fn configure_tg_ports(
    config: &mut Config,
    is_tofino2: bool,
    loopback_mode: bool,
) -> TGPortConfiguration {
    let mut tg_port_requests = Vec::new();
    let mut auto_tg_ports = Vec::new();
    let mut manual_tg_ports = Vec::new();

    for tg in &mut config.tg_ports {
        let speed = get_base_speed(tg, is_tofino2);
        let fec = tg.fec.clone().unwrap_or(
            if is_tofino2
                && (speed == Speed::BF_SPEED_400G
                    || tg.breakout_mode.is_some() && speed == Speed::BF_SPEED_100G)
            {
                FEC::BF_FEC_TYP_REED_SOLOMON
            } else {
                FEC::BF_FEC_TYP_NONE
            },
        );

        let (channels, per_channel_speed, n_lanes) =
            breakout_mapping(&speed, tg.breakout_mode, is_tofino2);

        if tg.breakout_mode.is_some() && channels.len() == 1 {
            // Invalid speed configured for breakout mode
            tg.breakout_mode = None;
            warn!("Invalid port speed for breakout mode on port configured. Only 400G (Tofino 2), 100G and 40G are possible. Falling back to single channel.");
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
            if let Some(n) = n_lanes {
                req = req.n_lanes(n);
            }

            tg_port_requests.push(req);
        }

        let mac = MacAddr::from_str(&tg.mac).unwrap(); // validated earlier
        if tg.recirculation_ports.is_some() {
            manual_tg_ports.push((tg.port, mac));
        } else {
            auto_tg_ports.push((tg.port, mac));
        }
    }

    TGPortConfiguration {
        port_requests: tg_port_requests,
        auto_tg_ports,
        manual_tg_ports,
    }
}

fn build_recirculation_config(
    config: &Config,
    recirculation_ports: &[u32],
    auto_tg_ports: &[(u32, MacAddr)],
) -> HashMap<u32, RecirculationPair> {
    // --- Build choices for each TG: config-first, then auto from remaining pool ---
    let mut recirc_ports_per_tg_choice: HashMap<u32, RecirculationPair> = HashMap::new();
    let mut used_recirc: HashSet<u32> = HashSet::new();

    // Reserve manual mappings and enforce uniqueness up-front
    for tg in &config.tg_ports {
        if let Some(rec) = &tg.recirculation_ports {
            for &p in &[rec.tx_port, rec.rx_port] {
                if !used_recirc.insert(p) {
                    panic!("Recirculation port {p} is used more than once in config.");
                }
                if used_recirc.contains(&tg.port) {
                    panic!("Recirculation port {p} is also used as front panel TG port.");
                }
            }
            recirc_ports_per_tg_choice.insert(
                tg.port,
                RecirculationPair {
                    tx_port: rec.tx_port,
                    rx_port: rec.rx_port,
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
        recirc_ports_per_tg_choice.insert(
            *tg_port,
            RecirculationPair {
                tx_port: free[2 * i],
                rx_port: free[2 * i + 1],
            },
        );
        used_recirc.insert(free[2 * i]);
        used_recirc.insert(free[2 * i + 1]);
    }

    recirc_ports_per_tg_choice
}

pub fn configure_recirculation_ports(
    config: &Config,
    auto_tg_ports: &[(u32, MacAddr)],
    manual_tg_ports: &[(u32, MacAddr)],
    recirc_ports_per_tg_choice: &HashMap<u32, RecirculationPair>,
    is_tofino2: bool,
) -> Vec<Port> {
    // --- Configure recirc ports actually used ---
    let mut added_recirc_once: HashSet<(u32, u32)> = HashSet::new();
    let mut port_requests = Vec::new();

    for (tg_port, _) in manual_tg_ports.iter().chain(auto_tg_ports.iter()) {
        let tg_cfg = config
            .tg_ports
            .iter()
            .find(|p| &p.port == tg_port)
            .expect("internal: missing tg cfg");

        let base_speed = get_base_speed(tg_cfg, is_tofino2);
        let breakout_lanes = tg_cfg.breakout_mode;
        let (channels, per_channel_speed, n_lanes) =
            breakout_mapping(&base_speed, breakout_lanes, is_tofino2);

        let choice = recirc_ports_per_tg_choice
            .get(tg_port)
            .expect("internal: missing recirc choice");

        let fec = if breakout_lanes.is_some() {
            if per_channel_speed == Speed::BF_SPEED_100G || per_channel_speed == Speed::BF_SPEED_50G
            {
                FEC::BF_FEC_TYP_REED_SOLOMON
            } else {
                FEC::BF_FEC_TYP_NONE
            }
        } else if is_tofino2 {
            FEC::BF_FEC_TYP_REED_SOLOMON
        } else {
            FEC::BF_FEC_TYP_NONE
        };

        // Always use maximum possible rate for recirculation ports
        // 8-lane breakout -> 50G, 4-lane breakout -> 100G (or 25G for 100G/40G base)
        let speed = if breakout_lanes.is_some() {
            per_channel_speed.clone()
        } else if is_tofino2 {
            Speed::BF_SPEED_400G
        } else {
            Speed::BF_SPEED_100G
        };

        for &ch in &channels {
            if added_recirc_once.insert((choice.tx_port, ch as u32)) {
                let mut port_req = Port::new(choice.tx_port, ch)
                    .speed(speed.clone())
                    .fec(fec.clone())
                    .auto_negotiation(AutoNegotiation::PM_AN_DEFAULT)
                    .loopback(Loopback::BF_LPBK_MAC_NEAR);
                if let Some(n) = n_lanes {
                    port_req = port_req.n_lanes(n);
                }
                port_requests.push(port_req);
            }
        }

        for &ch in &channels {
            if added_recirc_once.insert((choice.rx_port, ch as u32)) {
                let mut port_req = Port::new(choice.rx_port, ch)
                    .speed(speed.clone())
                    .fec(fec.clone())
                    .auto_negotiation(AutoNegotiation::PM_AN_DEFAULT)
                    .loopback(Loopback::BF_LPBK_MAC_NEAR);
                if let Some(n) = n_lanes {
                    port_req = port_req.n_lanes(n);
                }
                port_requests.push(port_req);
            }
        }
    }
    port_requests
}

fn build_tg_recirc_mapping(
    config: &Config,
    pm: &PortManager,
    auto_tg_ports: &[(u32, MacAddr)],
    manual_tg_ports: &[(u32, MacAddr)],
    recirc_ports_per_tg_choice: &HashMap<u32, RecirculationPair>,
    is_tofino2: bool,
) -> Result<HashMap<u32, PortMapping>, RBFRTError> {
    let mut port_mapping: HashMap<u32, PortMapping> = HashMap::new();

    for (tg_port, mac) in manual_tg_ports.iter().chain(auto_tg_ports.iter()) {
        let tg_cfg = config
            .tg_ports
            .iter()
            .find(|p| &p.port == tg_port)
            .expect("internal: missing tg cfg");

        let base_speed = get_base_speed(tg_cfg, is_tofino2);
        let (channels, _per_ch_speed, _n_lanes) =
            breakout_mapping(&base_speed, tg_cfg.breakout_mode, is_tofino2);

        let choice = recirc_ports_per_tg_choice
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

    Ok(port_mapping)
}

pub async fn configure_ports(
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

    // Build Port requests to configure traffic generation ports
    let tg_port_config = configure_tg_ports(config, is_tofino2, loopback_mode);
    port_requests.extend(tg_port_config.port_requests);

    // Build recirculation port assignments based on config and auto assignment
    let recirc_ports_per_tg_choice =
        build_recirculation_config(config, recirculation_ports, &tg_port_config.auto_tg_ports);

    // Build Port requests to configure recirculation ports
    let recirculation_port_requests = configure_recirculation_ports(
        config,
        &tg_port_config.auto_tg_ports,
        &tg_port_config.manual_tg_ports,
        &recirc_ports_per_tg_choice,
        is_tofino2,
    );
    port_requests.extend(recirculation_port_requests);

    // Push to hardware
    pm.add_ports(switch, &port_requests).await?;
    info!("Ports of device configured.");

    // --- Build mapping (TG dev_port(+ch) -> recirc dev_ports(+ch)) ---
    port_mapping.clear();

    match build_tg_recirc_mapping(
        config,
        pm,
        &tg_port_config.auto_tg_ports,
        &tg_port_config.manual_tg_ports,
        &recirc_ports_per_tg_choice,
        is_tofino2,
    ) {
        Ok(mapping) => {
            *port_mapping = mapping;
        }
        Err(e) => {
            return Err(e);
        }
    }

    Ok(())
}
