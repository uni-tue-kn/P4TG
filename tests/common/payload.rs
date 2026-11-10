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

/// Independently maintained payload variants used to exercise the controller's
/// public wire format. Keeping these outside the binary catches serde/schema
/// drift instead of compiling against controller-private types.
#[derive(Clone, Copy, Debug)]
pub enum HeaderProfile {
    Ipv4,
    Ipv6,
    Vlan,
    QinQ,
    Mpls,
    Vxlan,
    Gtpu,
    Srv6,
}

impl HeaderProfile {
    pub const fn name(self) -> &'static str {
        match self {
            Self::Ipv4 => "ipv4",
            Self::Ipv6 => "ipv6",
            Self::Vlan => "vlan",
            Self::QinQ => "qinq",
            Self::Mpls => "mpls",
            Self::Vxlan => "vxlan",
            Self::Gtpu => "gtpu",
            Self::Srv6 => "srv6",
        }
    }
}

pub fn payload_for_profile(rate: f64, profile: HeaderProfile) -> Value {
    let mut payload = TrafficGenPayload::valid(rate).json();
    match profile {
        HeaderProfile::Ipv4 => {}
        HeaderProfile::Ipv6 => {
            payload["stream_settings"][0]
                .as_object_mut()
                .unwrap()
                .remove("ip");
            payload["stream_settings"][0]["ipv6"] = json!({
                "ipv6_src": "2001:db8::1", "ipv6_dst": "2001:db8::2",
                "ipv6_traffic_class": 0, "ipv6_src_mask": "::",
                "ipv6_dst_mask": "::", "ipv6_flow_label": 0
            });
            payload["streams"][0]["ip_version"] = json!(6);
        }
        HeaderProfile::Vlan | HeaderProfile::QinQ => {
            payload["streams"][0]["encapsulation"] =
                json!(if matches!(profile, HeaderProfile::Vlan) {
                    1
                } else {
                    2
                });
            payload["stream_settings"][0]["vlan"] = json!({
                "vlan_id": 100, "pcp": 0, "dei": 0,
                "inner_vlan_id": 200, "inner_pcp": 0, "inner_dei": 0
            });
        }
        HeaderProfile::Mpls => {
            payload["streams"][0]["encapsulation"] = json!(3);
            payload["streams"][0]["number_of_lse"] = json!(2);
            payload["stream_settings"][0]["mpls_stack"] = json!([
                {"label": 100, "tc": 0, "bos": false, "ttl": 64},
                {"label": 200, "tc": 0, "bos": true, "ttl": 64}
            ]);
        }
        HeaderProfile::Vxlan => {
            payload["streams"][0]["vxlan"] = json!(true);
            payload["stream_settings"][0]["vxlan"] = json!({
                "eth_src": "02:00:00:00:10:01", "eth_dst": "02:00:00:00:10:02",
                "ip_src": "203.0.113.1", "ip_dst": "203.0.113.2", "ip_tos": 0,
                "udp_source": 49152, "vni": 42
            });
        }
        HeaderProfile::Gtpu => {
            payload["streams"][0]["gtpu"] = json!(true);
            payload["stream_settings"][0]["gtpu"] = json!({
                "ip_src": "203.0.113.1", "ip_dst": "203.0.113.2", "ip_tos": 0,
                "udp_source": 2152, "teid": 42
            });
        }
        HeaderProfile::Srv6 => {
            payload["streams"][0]["encapsulation"] = json!(4);
            payload["streams"][0]["number_of_srv6_sids"] = json!(2);
            payload["streams"][0]["srv6_ip_tunneling"] = json!(false);
            payload["stream_settings"][0]
                .as_object_mut()
                .unwrap()
                .remove("ip");
            payload["stream_settings"][0]["srv6_base_header"] = json!({
                "ipv6_src": "2001:db8:1::1", "ipv6_dst": "2001:db8:1::2",
                "ipv6_traffic_class": 0, "ipv6_src_mask": "::",
                "ipv6_dst_mask": "::", "ipv6_flow_label": 0
            });
            payload["stream_settings"][0]["sid_list"] = json!(["2001:db8:2::1", "2001:db8:2::2"]);
        }
    }
    payload["name"] = json!(format!("rust {} model test", profile.name()));
    payload
}
