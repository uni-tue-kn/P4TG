use macaddr::MacAddr;
use rbfrt::util::{AutoNegotiation, Speed, FEC};
use serde::{Deserialize, Serialize};
use std::{error::Error, str::FromStr};

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
    pub(crate) breakout_mode: Option<bool>,
    arp_reply: Option<bool>,
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
                .map(|(i, v)| PortDescription {
                    port: *v,
                    mac: macs.get(i).unwrap().parse().unwrap(),
                    arp_reply: None,
                    speed: Some(if is_tofino2 {
                        Speed::BF_SPEED_400G
                    } else {
                        Speed::BF_SPEED_100G
                    }),
                    fec: Some(if is_tofino2 {
                        FEC::BF_FEC_TYP_REED_SOLOMON
                    } else {
                        FEC::BF_FEC_TYP_NONE
                    }),
                    auto_negotiation: Some(AutoNegotiation::PM_AN_DEFAULT),
                    recirculation_ports: None,
                    breakout_mode: None,
                })
                .collect(),
        }
    }

    pub(crate) fn validate(&self, num_ports: u32) -> Result<(), Box<dyn Error>> {
        for port in &self.tg_ports {
            if MacAddr::from_str(&port.mac).is_err() {
                return Err(Box::new(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    format!("MAC address for port {port:?} is not valid."),
                )));
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

    pub(crate) fn update_arp_state(&mut self, port: u32, state: bool) {
        for p in &mut self.tg_ports {
            if p.port == port {
                p.arp_reply = Some(state);
            }
        }
    }
}
