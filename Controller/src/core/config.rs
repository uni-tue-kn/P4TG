use crate::core::traffic_gen_core::helper::{
    default_fec, effective_channel_count, resolve_front_panel_mode, sanitize_fec,
};
use log::warn;
use macaddr::MacAddr;
use rbfrt::util::{AutoNegotiation, Speed, FEC};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, error::Error, str::FromStr};

#[derive(Deserialize, Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(untagged)]
enum LegacyBreakoutMode {
    Bool(bool),
    Number(u8),
}

#[derive(Deserialize, Serialize, Debug, Clone)]
pub struct PortDescription {
    pub(crate) port: u32,
    pub(crate) mac: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) speed: Option<Speed>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fec: Option<FEC>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_negotiation: Option<AutoNegotiation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) recirculation_ports: Option<RecirculationPair>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) channel_count: Option<u8>,
    #[serde(default, rename = "breakout_mode", skip_serializing)]
    legacy_breakout_mode: Option<LegacyBreakoutMode>,
    arp_reply: Option<bool>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    channel_mac: HashMap<u8, String>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    channel_arp_reply: HashMap<u8, bool>,
}

impl PortDescription {
    pub(crate) fn speed_or_default(&self, is_tofino2: bool) -> Speed {
        self.speed.clone().unwrap_or(if is_tofino2 {
            Speed::BF_SPEED_400G
        } else {
            Speed::BF_SPEED_100G
        })
    }

    pub(crate) fn effective_channel_count(&self) -> u8 {
        effective_channel_count(self.channel_count)
    }

    pub(crate) fn mac_for_channel(&self, channel: u8) -> Option<String> {
        self.channel_mac
            .get(&channel)
            .cloned()
            .or_else(|| increment_mac(&self.mac, channel))
    }
}

#[derive(Deserialize, Serialize, Debug, Clone)]
pub struct RecirculationPair {
    pub(crate) tx_port: u32,
    pub(crate) rx_port: u32,
}

#[derive(Deserialize, Debug, Serialize, Clone)]
pub struct Config {
    pub(crate) tg_ports: Vec<PortDescription>,
}

impl Config {
    pub fn contains(&self, other: u32) -> bool {
        for i in &self.tg_ports {
            if i.port == other {
                return true;
            }
        }

        false
    }

    pub(crate) fn normalize(&mut self, is_tofino2: bool) -> Result<(), Box<dyn Error>> {
        for port in &mut self.tg_ports {
            let legacy_breakout_mode = port.legacy_breakout_mode.take();
            if let Some(legacy) = legacy_breakout_mode {
                warn!(
                    "Port {} uses deprecated field `breakout_mode`; use `channel_count` instead.",
                    port.port
                );

                match legacy {
                    LegacyBreakoutMode::Bool(false) => {
                        if port.channel_count.is_some_and(|count| count != 1) {
                            return Err(Box::new(std::io::Error::new(
                                std::io::ErrorKind::InvalidInput,
                                format!(
                                    "Port {} mixes deprecated `breakout_mode: false` with `channel_count: {}`.",
                                    port.port,
                                    port.channel_count.unwrap_or(1)
                                ),
                            )));
                        }
                    }
                    LegacyBreakoutMode::Bool(true) => {
                        let normalized_speed =
                            normalize_legacy_breakout_speed(port.speed.clone(), is_tofino2)?;

                        if port.channel_count.is_some_and(|count| count != 4) {
                            return Err(Box::new(std::io::Error::new(
                                std::io::ErrorKind::InvalidInput,
                                format!(
                                    "Port {} mixes deprecated `breakout_mode: true` with `channel_count: {}`.",
                                    port.port,
                                    port.channel_count.unwrap_or(1)
                                ),
                            )));
                        }

                        port.channel_count = Some(4);
                        port.speed = Some(normalized_speed);
                    }
                    LegacyBreakoutMode::Number(v) => {
                        return Err(Box::new(std::io::Error::new(
                            std::io::ErrorKind::InvalidInput,
                            format!(
                                "Port {} uses unsupported deprecated value `breakout_mode: {}`. Use `channel_count: {}` instead.",
                                port.port, v, v
                            ),
                        )));
                    }
                }
            }

            if port.channel_count == Some(1) {
                port.channel_count = None;
            }
        }

        Ok(())
    }

    pub(crate) fn default_tofino(is_tofino2: bool) -> Self {
        let macs = [
            "fa:a6:68:e0:3d:70",
            "00:d0:67:a2:a9:42",
            "40:28:e3:cd:64:35",
            "be:6a:94:e8:3c:3c",
            "d6:67:75:a1:94:c3",
            "e2:bd:1e:02:dc:b4",
            "d0:b3:7f:59:2c:4a",
            "84:08:f3:bc:2b:ac",
            "06:6c:cc:db:86:9c",
            "c0:db:54:17:15:0f",
        ];
        Config {
            tg_ports: (1..11)
                .collect::<Vec<_>>()
                .iter()
                .enumerate()
                .map(|(i, v)| {
                    let speed = if is_tofino2 {
                        Speed::BF_SPEED_400G
                    } else {
                        Speed::BF_SPEED_100G
                    };
                    PortDescription {
                        port: *v,
                        mac: macs.get(i).unwrap().parse().unwrap(),
                        arp_reply: None,
                        speed: Some(speed.clone()),
                        fec: Some(default_fec(&speed, None)),
                        auto_negotiation: Some(AutoNegotiation::PM_AN_DEFAULT),
                        recirculation_ports: None,
                        channel_count: None,
                        legacy_breakout_mode: None,
                        channel_mac: HashMap::new(),
                        channel_arp_reply: HashMap::new(),
                    }
                })
                .collect(),
        }
    }

    pub(crate) fn validate(&self, num_ports: u32, is_tofino2: bool) -> Result<(), Box<dyn Error>> {
        for port in &self.tg_ports {
            if MacAddr::from_str(&port.mac).is_err() {
                return Err(Box::new(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    format!("MAC address for port {port:?} is not valid."),
                )));
            }

            for (channel, mac) in &port.channel_mac {
                if MacAddr::from_str(mac).is_err() {
                    return Err(Box::new(std::io::Error::new(
                        std::io::ErrorKind::InvalidInput,
                        format!(
                            "MAC address '{}' for port {}/{} is not valid.",
                            mac, port.port, channel
                        ),
                    )));
                }
            }

            let speed = port.speed_or_default(is_tofino2);
            let channel_count = port.channel_count;

            if !is_tofino2 && speed == Speed::BF_SPEED_400G {
                return Err(Box::new(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    format!(
                        "Port {} uses BF_SPEED_400G, which is only supported on Tofino 2.",
                        port.port
                    ),
                )));
            }

            if resolve_front_panel_mode(&speed, channel_count, is_tofino2).is_none() {
                return Err(Box::new(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    format!(
                        "Port {} uses unsupported combination speed {:?} with channel_count {}.",
                        port.port,
                        speed,
                        port.effective_channel_count()
                    ),
                )));
            }

            if let Some(mode) = resolve_front_panel_mode(&speed, channel_count, is_tofino2) {
                for channel in mode.channels {
                    if port.mac_for_channel(channel).is_none() {
                        return Err(Box::new(std::io::Error::new(
                            std::io::ErrorKind::InvalidInput,
                            format!(
                                "MAC address '{}' for port {} cannot be incremented to channel {}.",
                                port.mac, port.port, channel
                            ),
                        )));
                    }
                }
            }

            if let Some(fec) = port.fec.clone() {
                let sanitized = sanitize_fec(&speed, channel_count, fec.clone());
                if sanitized != fec {
                    warn!(
                        "Port {} uses unsupported FEC {:?} for speed {:?} and channel_count {}. Using {:?} instead.",
                        port.port,
                        fec,
                        speed,
                        port.effective_channel_count(),
                        sanitized
                    );
                }
            }
        }

        // Each port requires two recirculation ports. so floor(num_ports / 3) are actually available
        let num_availabe_tg_ports = num_ports / 3;
        if !(self.tg_ports.len() <= num_availabe_tg_ports as usize
            && self
                .tg_ports
                .clone()
                .into_iter()
                .filter(|p| p.port > num_ports)
                .collect::<Vec<_>>()
                .is_empty())
        {
            return Err(Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "Too many ports or invalid port number used".to_string(),
            )));
        }

        Ok(())
    }

    pub(crate) fn update_arp_state(&mut self, port: u32, channel: Option<u8>, state: bool) {
        for p in &mut self.tg_ports {
            if p.port == port {
                if let Some(channel) = channel {
                    p.channel_arp_reply.insert(channel, state);
                } else {
                    p.arp_reply = Some(state);
                    p.channel_arp_reply.clear();
                }
            }
        }
    }

    pub(crate) fn update_mac_state(&mut self, port: u32, channel: Option<u8>, mac: String) {
        for p in &mut self.tg_ports {
            if p.port == port {
                if let Some(channel) = channel {
                    p.channel_mac.insert(channel, mac.clone());
                } else {
                    p.mac = mac.clone();
                    p.channel_mac.clear();
                }
            }
        }
    }

    pub(crate) fn get_mac_state(&self, port: u32, channel: Option<u8>) -> Option<String> {
        self.tg_ports.iter().find(|p| p.port == port).and_then(|p| {
            if let Some(channel) = channel {
                p.mac_for_channel(channel)
            } else {
                Some(p.mac.clone())
            }
        })
    }

    pub(crate) fn materialize_channel_macs(&mut self, is_tofino2: bool) {
        for port in &mut self.tg_ports {
            let speed = port.speed_or_default(is_tofino2);
            let Some(mode) = resolve_front_panel_mode(&speed, port.channel_count, is_tofino2)
            else {
                continue;
            };

            for channel in mode.channels {
                if let Some(mac) = port.mac_for_channel(channel) {
                    port.channel_mac.entry(channel).or_insert(mac);
                }
            }
        }
    }
}

fn increment_mac(mac: &str, offset: u8) -> Option<String> {
    let mac = MacAddr::from_str(mac).ok()?;
    let value = mac
        .as_bytes()
        .iter()
        .fold(0u64, |acc, byte| (acc << 8) | (*byte as u64));
    let incremented = value.checked_add(offset as u64)?;
    if incremented > 0xFFFF_FFFF_FFFF {
        return None;
    }

    Some(
        MacAddr::from([
            ((incremented >> 40) & 0xFF) as u8,
            ((incremented >> 32) & 0xFF) as u8,
            ((incremented >> 24) & 0xFF) as u8,
            ((incremented >> 16) & 0xFF) as u8,
            ((incremented >> 8) & 0xFF) as u8,
            (incremented & 0xFF) as u8,
        ])
        .to_string(),
    )
}

fn normalize_legacy_breakout_speed(
    speed: Option<Speed>,
    is_tofino2: bool,
) -> Result<Speed, Box<dyn Error>> {
    let legacy_base_speed = speed.unwrap_or(Speed::BF_SPEED_100G);
    match legacy_base_speed {
        Speed::BF_SPEED_400G if is_tofino2 => Ok(Speed::BF_SPEED_100G),
        Speed::BF_SPEED_100G => Ok(Speed::BF_SPEED_25G),
        Speed::BF_SPEED_40G => Ok(Speed::BF_SPEED_10G),
        other => Err(Box::new(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!(
                "Deprecated `breakout_mode: true` is only compatible with legacy base speeds 40G, 100G, or 400G on Tofino 2, not {:?}.",
                other
            ),
        ))),
    }
}
