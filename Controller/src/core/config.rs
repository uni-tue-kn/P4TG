use crate::core::traffic_gen_core::helper::{
    default_fec, effective_channel_count, resolve_front_panel_mode,
};
use log::warn;
use macaddr::MacAddr;
use rbfrt::util::{AutoNegotiation, Speed, FEC};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeSet, HashMap, HashSet},
    error::Error,
    io::Read,
    mem,
    str::FromStr,
};

fn invalid_config(message: impl Into<String>) -> Box<dyn Error> {
    Box::new(std::io::Error::new(
        std::io::ErrorKind::InvalidInput,
        message.into(),
    ))
}

#[derive(Deserialize, Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(untagged)]
enum LegacyBreakoutMode {
    Bool(bool),
    Number(u8),
}

#[derive(Deserialize, Serialize, Debug, Clone)]
#[serde(deny_unknown_fields)]
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
    fn default_single(port: u32, mac: String, is_tofino2: bool) -> Self {
        let speed = if is_tofino2 {
            Speed::BF_SPEED_400G
        } else {
            Speed::BF_SPEED_100G
        };

        Self {
            port,
            mac,
            speed: Some(speed.clone()),
            fec: Some(default_fec(&speed, None)),
            auto_negotiation: Some(AutoNegotiation::PM_AN_DEFAULT),
            recirculation_ports: None,
            channel_count: None,
            legacy_breakout_mode: None,
            arp_reply: None,
            channel_mac: HashMap::new(),
            channel_arp_reply: HashMap::new(),
        }
    }

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
#[serde(deny_unknown_fields)]
pub struct RecirculationPair {
    pub(crate) tx_port: u32,
    pub(crate) rx_port: u32,
}

#[derive(Deserialize, Debug, Serialize, Clone)]
pub struct Config {
    pub(crate) tg_ports: Vec<PortDescription>,
}

impl Config {
    /// Loads each `tg_ports` entry independently. Invalid entries with a usable
    /// front-panel port number are replaced by a single-channel default for the
    /// detected ASIC; entries without a usable identity are skipped.
    pub(crate) fn from_reader_with_port_fallback<R: Read>(
        reader: R,
        num_ports: u32,
        is_tofino2: bool,
    ) -> Result<Self, Box<dyn Error>> {
        let document: serde_json::Value = serde_json::from_reader(reader)?;
        let object = document
            .as_object()
            .ok_or_else(|| invalid_config("config.json must contain a JSON object."))?;
        let entries = object
            .get("tg_ports")
            .and_then(serde_json::Value::as_array)
            .ok_or_else(|| invalid_config("config.json must contain a `tg_ports` array."))?;

        let mut tg_ports = Vec::with_capacity(entries.len());
        for (index, raw_entry) in entries.iter().enumerate() {
            let recovered_port = raw_entry
                .get("port")
                .and_then(serde_json::Value::as_u64)
                .and_then(|port| u32::try_from(port).ok())
                .filter(|port| *port > 0 && *port <= num_ports);
            let recovered_mac = raw_entry
                .get("mac")
                .and_then(serde_json::Value::as_str)
                .filter(|mac| MacAddr::from_str(mac).is_ok())
                .map(str::to_owned);
            // Preserved across a fallback: auto-assigning recirculation ports to
            // a port that had a manual mapping silently changes the topology.
            let recovered_recirculation = raw_entry
                .get("recirculation_ports")
                .cloned()
                .and_then(|value| serde_json::from_value::<RecirculationPair>(value).ok());

            let parsed = serde_json::from_value::<PortDescription>(raw_entry.clone());
            let mut port = match parsed {
                Ok(port) => port,
                Err(err) => {
                    let Some(port) = recovered_port else {
                        warn!(
                            "Ignoring invalid config.json tg_ports entry #{} because no valid front-panel port can be recovered: {}",
                            index + 1,
                            err
                        );
                        continue;
                    };
                    let mac = recovered_mac
                        .clone()
                        .unwrap_or_else(|| default_mac_for_port(port));
                    warn!(
                        "Invalid config.json entry for port {port}: {err}. Using the default single-channel configuration."
                    );
                    let mut fallback = PortDescription::default_single(port, mac, is_tofino2);
                    fallback.recirculation_ports = recovered_recirculation.clone();
                    fallback
                }
            };

            let mut single = Config {
                tg_ports: vec![port.clone()],
            };
            let entry_error = single
                .normalize(is_tofino2)
                .and_then(|_| single.validate(num_ports, is_tofino2))
                .err();

            if let Some(err) = entry_error {
                let port_number = recovered_port.unwrap_or(port.port);
                if port_number == 0 || port_number > num_ports {
                    warn!(
                        "Ignoring invalid config.json entry #{} because front-panel port {} is outside 1..={}: {}",
                        index + 1,
                        port_number,
                        num_ports,
                        err
                    );
                    continue;
                }

                let mac = if MacAddr::from_str(&port.mac).is_ok() {
                    port.mac.clone()
                } else {
                    recovered_mac.unwrap_or_else(|| default_mac_for_port(port_number))
                };
                warn!(
                    "Invalid config.json entry for port {port_number}: {err} Using the default single-channel configuration."
                );
                let mut fallback = PortDescription::default_single(port_number, mac, is_tofino2);
                fallback.recirculation_ports = port.recirculation_ports.clone();
                port = fallback;
            } else {
                port = single
                    .tg_ports
                    .pop()
                    .expect("single-entry config must retain its port");
            }

            tg_ports.push(port);
        }

        let config = Config { tg_ports };
        config.validate(num_ports, is_tofino2)?;
        Ok(config)
    }

    pub fn contains(&self, other: u32) -> bool {
        for i in &self.tg_ports {
            if i.port == other {
                return true;
            }
        }

        false
    }

    /// Rewrites deprecated fields, migrates legacy channel IDs, and drops
    /// channel overrides that the resulting layout cannot address.
    ///
    /// The three passes below must stay in this order and must not be merged:
    ///
    /// 1. `breakout_mode` is resolved first because `breakout_mode: true` is
    ///    what produces the `channel_count: 4` + 10G/25G combination that pass 2
    ///    keys off. Running pass 2 first would skip those ports.
    /// 2. The Tofino 2 channel-ID migration rewrites `0,1,2,3` to `0,2,4,6`. It
    ///    must precede pass 3, which would otherwise prune channels 1 and 3 as
    ///    unaddressable and destroy exactly the overrides being migrated.
    /// 3. Pruning runs last, once the layout each port will actually use is
    ///    known, and applies to both ASICs.
    pub(crate) fn normalize(&mut self, is_tofino2: bool) -> Result<(), Box<dyn Error>> {
        // Pass 1: deprecated `breakout_mode` -> `channel_count` + per-channel speed.
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

        // Pass 2: on Tofino 2, `4x10G`/`4x25G` moved from channels 0,1,2,3 to
        // 0,2,4,6. Other four-way modes were always 0,2,4,6 and are left alone.
        if is_tofino2 {
            for port in &mut self.tg_ports {
                let speed = port.speed_or_default(is_tofino2);
                if port.channel_count != Some(4)
                    || !matches!(speed, Speed::BF_SPEED_10G | Speed::BF_SPEED_25G)
                {
                    continue;
                }

                let override_channels: Vec<_> = port
                    .channel_mac
                    .keys()
                    .chain(port.channel_arp_reply.keys())
                    .copied()
                    .collect();
                let has_legacy_channel = override_channels
                    .iter()
                    .any(|channel| matches!(channel, 1 | 3));
                let has_current_channel = override_channels
                    .iter()
                    .any(|channel| matches!(channel, 4 | 6));

                if has_legacy_channel && has_current_channel {
                    return Err(invalid_config(format!(
                        "Channel-specific configuration for Tofino 2 port {} mixes legacy channel IDs 0,1,2,3 with current channel IDs 0,2,4,6.",
                        port.port
                    )));
                }

                if has_legacy_channel {
                    if let Some(channel) = override_channels.iter().find(|channel| **channel > 3) {
                        return Err(invalid_config(format!(
                            "Legacy channel-specific configuration for Tofino 2 port {} contains invalid channel ID {}.",
                            port.port, channel
                        )));
                    }
                    migrate_legacy_tofino2_four_way_map(&mut port.channel_mac);
                    migrate_legacy_tofino2_four_way_map(&mut port.channel_arp_reply);
                    warn!(
                        "Migrated legacy channel-specific configuration for Tofino 2 port {} from channel IDs 0,1,2,3 to 0,2,4,6.",
                        port.port
                    );
                } else if !override_channels.is_empty()
                    && override_channels
                        .iter()
                        .all(|channel| matches!(channel, 0 | 2))
                {
                    warn!(
                        "Channel-specific configuration for Tofino 2 port {} uses only channel IDs 0 and/or 2, which are ambiguous between old and current layouts. Treating them as current physical channel IDs; verify these overrides if the file predates 4x50G support.",
                        port.port
                    );
                }
            }
        }

        // Pass 3: every lookup is keyed by a channel of the active layout, so
        // overrides outside it are never read. Drop them so they cannot reappear
        // through `GET /api/config` and be saved back into a later config.json.
        for port in &mut self.tg_ports {
            let speed = port.speed_or_default(is_tofino2);
            let Some(mode) = resolve_front_panel_mode(&speed, port.channel_count, is_tofino2)
            else {
                continue;
            };

            let active: HashSet<_> = mode.channels.iter().copied().collect();
            let stale: BTreeSet<_> = port
                .channel_mac
                .keys()
                .chain(port.channel_arp_reply.keys())
                .filter(|channel| !active.contains(channel))
                .copied()
                .collect();

            if !stale.is_empty() {
                warn!(
                    "Channel-specific configuration for port {} targets channels {:?} outside its active channel layout {:?}. These entries are ignored.",
                    port.port, stale, mode.channels
                );
                port.channel_mac.retain(|channel, _| active.contains(channel));
                port.channel_arp_reply
                    .retain(|channel, _| active.contains(channel));
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
        if self.tg_ports.is_empty() {
            return Err(invalid_config(
                "At least one traffic-generation port must be configured.",
            ));
        }

        let mut tg_ports = HashSet::new();
        for port in &self.tg_ports {
            if port.port == 0 || port.port > num_ports {
                return Err(invalid_config(format!(
                    "Traffic-generation port {} is outside the available front-panel range 1..={num_ports}.",
                    port.port
                )));
            }
            if !tg_ports.insert(port.port) {
                return Err(invalid_config(format!(
                    "Traffic-generation port {} is configured more than once.",
                    port.port
                )));
            }
        }

        let mut used_recirculation_ports = HashSet::new();
        for port in &self.tg_ports {
            if let Some(pair) = &port.recirculation_ports {
                for recirculation_port in [pair.tx_port, pair.rx_port] {
                    if recirculation_port == 0 || recirculation_port > num_ports {
                        return Err(invalid_config(format!(
                            "Recirculation port {recirculation_port} for traffic-generation port {} is outside the available front-panel range 1..={num_ports}.",
                            port.port
                        )));
                    }
                    if tg_ports.contains(&recirculation_port) {
                        return Err(invalid_config(format!(
                            "Recirculation port {recirculation_port} is also configured as a traffic-generation port."
                        )));
                    }
                    if !used_recirculation_ports.insert(recirculation_port) {
                        return Err(invalid_config(format!(
                            "Recirculation port {recirculation_port} is used more than once."
                        )));
                    }
                }
            }
        }

        let automatically_mapped_ports = self
            .tg_ports
            .iter()
            .filter(|port| port.recirculation_ports.is_none())
            .count();
        let free_ports = (1..=num_ports)
            .filter(|port| !tg_ports.contains(port) && !used_recirculation_ports.contains(port))
            .count();
        let required_free_ports = automatically_mapped_ports.saturating_mul(2);
        if free_ports < required_free_ports {
            return Err(invalid_config(format!(
                "Not enough free recirculation ports: need {required_free_ports}, have {free_ports} after reserving manual mappings."
            )));
        }

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

            if !is_tofino2 && matches!(speed, Speed::BF_SPEED_200G | Speed::BF_SPEED_400G) {
                return Err(Box::new(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    format!(
                        "Port {} uses {:?}, which is only supported on Tofino 2.",
                        port.port, speed
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

    pub(crate) fn arp_reply_for_channel(&self, port: u32, channel: u8) -> bool {
        self.tg_ports
            .iter()
            .find(|candidate| candidate.port == port)
            .and_then(|candidate| {
                candidate
                    .channel_arp_reply
                    .get(&channel)
                    .copied()
                    .or(candidate.arp_reply)
            })
            .unwrap_or(false)
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

fn default_mac_for_port(port: u32) -> String {
    let bytes = port.to_be_bytes();
    format!(
        "02:00:{:02x}:{:02x}:{:02x}:{:02x}",
        bytes[0], bytes[1], bytes[2], bytes[3]
    )
}

fn migrate_legacy_tofino2_four_way_map<T>(values: &mut HashMap<u8, T>) {
    let previous = mem::take(values);
    values.extend(previous.into_iter().map(|(channel, value)| {
        let migrated_channel = match channel {
            0 => 0,
            1 => 2,
            2 => 4,
            3 => 6,
            _ => unreachable!("legacy channel range was validated"),
        };
        (migrated_channel, value)
    }));
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
