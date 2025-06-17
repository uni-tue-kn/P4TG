use macaddr::MacAddr;
use serde::{Deserialize, Serialize};
use std::str::FromStr;

#[derive(Deserialize, Serialize, Debug, Clone)]
pub struct PortDescription {
    pub(crate) port: u32,
    pub(crate) mac: String,
    arp_reply: Option<bool>,
}

#[derive(Deserialize, Debug, Serialize, Clone)]
pub struct Config {
    pub(crate) tg_ports: Vec<PortDescription>,
}

impl Default for Config {
    fn default() -> Self {
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
                .map(|(i, v)| PortDescription {
                    port: *v,
                    mac: macs.get(i).unwrap().parse().unwrap(),
                    arp_reply: None,
                })
                .collect(),
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

        false
    }

    pub(crate) fn validate(&self) -> bool {
        for port in &self.tg_ports {
            if MacAddr::from_str(&port.mac).is_err() {
                return false;
            }
        }

        self.tg_ports.len() <= 10
            && self
                .tg_ports
                .clone()
                .into_iter()
                .filter(|p| p.port > 32)
                .collect::<Vec<_>>()
                .is_empty()
    }

    pub(crate) fn update_arp_state(&mut self, port: u32, state: bool) {
        for p in &mut self.tg_ports {
            if p.port == port {
                p.arp_reply = Some(state);
            }
        }
    }
}
