use log::{info, warn};
use macaddr::MacAddr;
use rbfrt::error::RBFRTError;
use rbfrt::util::PortManager;
use rbfrt::util::{AutoNegotiation, Loopback, Port};
use rbfrt::SwitchConnection;
use std::collections::HashMap;
use std::collections::HashSet;
use std::str::FromStr;

use crate::core::config::RecirculationPair;
use crate::PortMapping;

use crate::core::traffic_gen_core::helper::{default_fec, resolve_port_layout, sanitize_fec};
use crate::core::Config;

struct TGPortConfiguration {
    port_requests: Vec<Port>,
    auto_tg_ports: Vec<u32>,
    manual_tg_ports: Vec<u32>,
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
        let speed = tg.speed_or_default(is_tofino2);
        let channel_count = tg.channel_count;
        let layout = resolve_port_layout(&speed, channel_count, is_tofino2)
            .expect("validated port mode must be resolvable");

        let default_port_fec = default_fec(&layout.front_panel.speed, channel_count);
        let requested_fec = tg.fec.clone().unwrap_or(default_port_fec.clone());
        let fec = sanitize_fec(
            &layout.front_panel.speed,
            channel_count,
            requested_fec.clone(),
        );
        if tg.fec.is_some() && fec != requested_fec {
            warn!(
                "Port {} uses unsupported FEC {:?} for speed {:?} and channel_count {}. Using {:?} instead.",
                tg.port,
                requested_fec,
                layout.front_panel.speed,
                tg.effective_channel_count(),
                fec
            );
        }

        for c in layout.front_panel.channels {
            let mut req = Port::new(tg.port, c)
                .speed(layout.front_panel.speed.clone())
                .fec(fec.clone())
                .auto_negotiation(
                    tg.auto_negotiation
                        .clone()
                        .unwrap_or(AutoNegotiation::PM_AN_DEFAULT),
                );

            if loopback_mode {
                req = req.loopback(Loopback::BF_LPBK_MAC_NEAR);
            }
            if let Some(n) = layout.front_panel.n_lanes {
                req = req.n_lanes(n);
            }

            tg_port_requests.push(req);
        }

        if tg.recirculation_ports.is_some() {
            manual_tg_ports.push(tg.port);
        } else {
            auto_tg_ports.push(tg.port);
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
    auto_tg_ports: &[u32],
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
    for (i, tg_port) in auto_tg_ports.iter().enumerate() {
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
    auto_tg_ports: &[u32],
    manual_tg_ports: &[u32],
    recirc_ports_per_tg_choice: &HashMap<u32, RecirculationPair>,
    is_tofino2: bool,
) -> Vec<Port> {
    // --- Configure recirc ports actually used ---
    let mut added_recirc_once: HashSet<(u32, u32)> = HashSet::new();
    let mut port_requests = Vec::new();

    for tg_port in manual_tg_ports.iter().chain(auto_tg_ports.iter()) {
        let tg_cfg = config
            .tg_ports
            .iter()
            .find(|p| p.port == *tg_port)
            .expect("internal: missing tg cfg");

        let speed = tg_cfg.speed_or_default(is_tofino2);
        let channel_count = tg_cfg.channel_count;
        let layout = resolve_port_layout(&speed, channel_count, is_tofino2)
            .expect("validated port mode must be resolvable");

        let choice = recirc_ports_per_tg_choice
            .get(tg_port)
            .expect("internal: missing recirc choice");

        let fec = default_fec(&layout.recirculation.speed, channel_count);

        for &ch in &layout.recirculation.channels {
            if added_recirc_once.insert((choice.tx_port, ch as u32)) {
                let mut port_req = Port::new(choice.tx_port, ch)
                    .speed(layout.recirculation.speed.clone())
                    .fec(fec.clone())
                    .auto_negotiation(AutoNegotiation::PM_AN_DEFAULT)
                    .loopback(Loopback::BF_LPBK_MAC_NEAR);
                if let Some(n) = layout.recirculation.n_lanes {
                    port_req = port_req.n_lanes(n);
                }
                port_requests.push(port_req);
            }
        }

        for &ch in &layout.recirculation.channels {
            if added_recirc_once.insert((choice.rx_port, ch as u32)) {
                let mut port_req = Port::new(choice.rx_port, ch)
                    .speed(layout.recirculation.speed.clone())
                    .fec(fec.clone())
                    .auto_negotiation(AutoNegotiation::PM_AN_DEFAULT)
                    .loopback(Loopback::BF_LPBK_MAC_NEAR);
                if let Some(n) = layout.recirculation.n_lanes {
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
    auto_tg_ports: &[u32],
    manual_tg_ports: &[u32],
    recirc_ports_per_tg_choice: &HashMap<u32, RecirculationPair>,
    is_tofino2: bool,
) -> Result<HashMap<u32, PortMapping>, RBFRTError> {
    let mut port_mapping: HashMap<u32, PortMapping> = HashMap::new();

    for tg_port in manual_tg_ports.iter().chain(auto_tg_ports.iter()) {
        let tg_cfg = config
            .tg_ports
            .iter()
            .find(|p| p.port == *tg_port)
            .expect("internal: missing tg cfg");

        let speed = tg_cfg.speed_or_default(is_tofino2);
        let layout = resolve_port_layout(&speed, tg_cfg.channel_count, is_tofino2)
            .expect("validated port mode must be resolvable");

        let choice = recirc_ports_per_tg_choice
            .get(tg_port)
            .expect("internal: missing recirc choice");

        for &ch in &layout.front_panel.channels {
            let tx_dev = pm.dev_port(choice.tx_port, ch)?;
            let rx_dev = pm.dev_port(choice.rx_port, ch)?;
            let dev_port = pm.dev_port(*tg_port, ch)?;
            let mac = config
                .get_mac_state(*tg_port, Some(ch))
                .as_deref()
                .and_then(|value| MacAddr::from_str(value).ok())
                .expect("validated channel MAC must be available");

            port_mapping.insert(
                dev_port,
                PortMapping {
                    tx_recirculation: tx_dev,
                    rx_recirculation: rx_dev,
                    mac,
                    front_panel_port: *tg_port,
                    channel_count: tg_cfg.channel_count,
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
