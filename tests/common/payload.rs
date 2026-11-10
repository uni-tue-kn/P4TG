use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Ethernet {
    pub eth_src: String,
    pub eth_dst: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Ipv4 {
    pub ip_src: String,
    pub ip_dst: String,
    pub ip_tos: u8,
    pub ip_src_mask: String,
    pub ip_dst_mask: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StreamSetting {
    pub port: u32,
    pub channel: u8,
    pub stream_id: u8,
    pub active: bool,
    pub ethernet: Ethernet,
    pub ip: Ipv4,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Stream {
    pub stream_id: u8,
    pub app_id: u8,
    pub frame_size: u32,
    pub encapsulation: u8,
    pub traffic_rate: f64,
    pub burst: u32,
    pub batches: bool,
    pub vxlan: bool,
    pub gtpu: bool,
    pub ip_version: u8,
    pub unit: u8,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RxTarget {
    pub port: u32,
    pub channel: u8,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TrafficGenPayload {
    pub name: String,
    pub mode: u8,
    pub stream_settings: Vec<StreamSetting>,
    pub streams: Vec<Stream>,
    pub rx_mapping_mode: String,
    pub port_tx_rx_mapping: BTreeMap<String, BTreeMap<String, RxTarget>>,
    pub duration: u64,
    pub repetitions: u32,
    pub drain_duration_secs: u64,
    pub rtt_histogram_config: Value,
    pub iat_histogram_config: Value,
}

impl TrafficGenPayload {
    pub fn valid(rate: f64) -> Self {
        let mut channels = BTreeMap::new();
        channels.insert(
            "0".into(),
            RxTarget {
                port: 2,
                channel: 0,
            },
        );
        let mut mappings = BTreeMap::new();
        mappings.insert("1".into(), channels);
        Self {
            name: "rust black-box test".into(),
            mode: 1,
            stream_settings: vec![StreamSetting {
                port: 1,
                channel: 0,
                stream_id: 1,
                active: true,
                ethernet: Ethernet {
                    eth_src: "02:00:00:00:00:01".into(),
                    eth_dst: "02:00:00:00:00:02".into(),
                },
                ip: Ipv4 {
                    ip_src: "192.0.2.1".into(),
                    ip_dst: "198.51.100.1".into(),
                    ip_tos: 0,
                    ip_src_mask: "0.0.0.0".into(),
                    ip_dst_mask: "0.0.0.0".into(),
                },
            }],
            streams: vec![Stream {
                stream_id: 1,
                app_id: 1,
                frame_size: 128,
                encapsulation: 0,
                traffic_rate: rate,
                burst: 1,
                batches: false,
                vxlan: false,
                gtpu: false,
                ip_version: 4,
                unit: 0,
            }],
            rx_mapping_mode: "per_tx_port".into(),
            port_tx_rx_mapping: mappings,
            duration: 2,
            repetitions: 1,
            drain_duration_secs: 0,
            rtt_histogram_config: json!({}),
            iat_histogram_config: json!({}),
        }
    }

    pub fn json(&self) -> Value {
        serde_json::to_value(self).expect("test payload must serialize")
    }
}
