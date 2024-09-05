use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::str::FromStr;
use lazy_static::lazy_static;
use crate::core::traffic_gen_core::types::*;

lazy_static! {
    pub static ref EXAMPLE_GET_1: TrafficGenData = TrafficGenData {
        mode: GenerationMode::Cbr,
        stream_settings: vec![StreamSetting {
                port: 128,
                stream_id: 1,
                ethernet: Ethernet {
                    eth_src: "32:D5:42:2A:F6:92".to_string(),
                    eth_dst: "81:E7:9D:E3:AD:47".to_string(),
                },
                ip: IPv4 {
                    ip_src: Ipv4Addr::from_str("192.168.178.10").unwrap(),
                    ip_dst: Ipv4Addr::from_str("192.168.178.11").unwrap(),
                    ip_tos: 0,
                    ip_src_mask: Ipv4Addr::from_str("0.0.0.0").unwrap(),
                    ip_dst_mask: Ipv4Addr::from_str("0.0.0.0").unwrap()
                },
                active: true,
                mpls_stack: None,
                vxlan: None,
                vlan: Some(Vlan {
                    pcp: 1,
                    dei: 0,
                    vlan_id: 5,
                    inner_pcp: 0,
                    inner_dei: 0,
                    inner_vlan_id: 0
                })
            }
        ],
        streams: vec![Stream {
                stream_id: 1,
                app_id: 1,
                frame_size: 64,
                encapsulation: Encapsulation::Vlan,
                traffic_rate: 80f32,
                burst: 100,
                vxlan: false,
                n_packets: Some(5),
                timeout: Some(88),
                generation_accuracy: Some(100f32),
                n_pipes: Some(2),
                number_of_lse: None
            }
        ],
        port_tx_rx_mapping: HashMap::from([(128, 136)]),
        duration: None,
        name: None,
        all_test: None,
    };

    pub static ref EXAMPLE_GET_2: TrafficGenData = TrafficGenData {
        mode: GenerationMode::Cbr,
        stream_settings: vec![StreamSetting {
                port: 128,
                stream_id: 1,
                ethernet: Ethernet {
                    eth_src: "32:D5:42:2A:F6:92".to_string(),
                    eth_dst: "81:E7:9D:E3:AD:47".to_string()
                },
                ip: IPv4 {
                    ip_src: Ipv4Addr::from_str("192.168.178.10").unwrap(),
                    ip_dst: Ipv4Addr::from_str("192.168.178.11").unwrap(),
                    ip_tos: 0,
                    ip_src_mask: Ipv4Addr::from_str("0.0.0.0").unwrap(),
                    ip_dst_mask: Ipv4Addr::from_str("0.0.0.0").unwrap()
                },
                active: true,
                vxlan: Some(VxLAN {
                    eth_src: "32:D5:42:2A:F6:92".to_string(),
                    eth_dst: "81:E7:9D:E3:AD:47".to_string(),
                    ip_src: Ipv4Addr::from_str("192.168.178.10").unwrap(),
                    ip_dst: Ipv4Addr::from_str("192.168.178.11").unwrap(),
                    ip_tos: 0,
                    udp_source: 49152,
                    vni: 1
                }),
                mpls_stack: None,
                vlan: None
            }
        ],
        streams: vec![Stream {
                stream_id: 1,
                app_id: 1,
                frame_size: 1024,
                encapsulation: Encapsulation::None,
                traffic_rate: 100f32,
                burst: 100,
                vxlan: true,
                n_packets: Some(5),
                timeout: Some(876),
                generation_accuracy: Some(99.908676f32),
                n_pipes: Some(2),
                number_of_lse: None
            }
        ],
        port_tx_rx_mapping: HashMap::from([(128, 136)]),
        duration: None,
        name: None,
        all_test: None,
    };


    pub static ref EXAMPLE_POST_1_RESPONSE: Vec<Stream> = vec![Stream {
        stream_id: 1,
        app_id: 1,
        frame_size: 1024,
        encapsulation: Encapsulation::None,
        number_of_lse: None,
        traffic_rate: 100f32,
        burst: 100,
        n_packets: Some(5),
        timeout: Some(876),
        generation_accuracy: Some(99.908676f32),
        n_pipes: Some(2),
        vxlan: true
    }];

    pub static ref EXAMPLE_POST_1_REQUEST: TrafficGenData = TrafficGenData {
        mode: GenerationMode::Cbr,
        stream_settings: vec![StreamSetting {
                port: 128,
                stream_id: 1,
                ethernet: Ethernet {
                    eth_src: "32:D5:42:2A:F6:92".to_string(),
                    eth_dst: "81:E7:9D:E3:AD:47".to_string()
                },
                ip: IPv4 {
                    ip_src: Ipv4Addr::from_str("192.168.178.10").unwrap(),
                    ip_dst: Ipv4Addr::from_str("192.168.178.11").unwrap(),
                    ip_tos: 0,
                    ip_src_mask: Ipv4Addr::from_str("0.0.0.0").unwrap(),
                    ip_dst_mask: Ipv4Addr::from_str("0.0.0.0").unwrap()
                },
                active: true,
                vxlan: Some(VxLAN {
                    eth_src: "32:D5:42:2A:F6:92".to_string(),
                    eth_dst: "81:E7:9D:E3:AD:47".to_string(),
                    ip_src: Ipv4Addr::from_str("192.168.178.10").unwrap(),
                    ip_dst: Ipv4Addr::from_str("192.168.178.11").unwrap(),
                    ip_tos: 0,
                    udp_source: 49152,
                    vni: 1
                }),
                mpls_stack: None,
                vlan: None
            }
        ],
        streams: vec![Stream {
                stream_id: 1,
                app_id: 1,
                frame_size: 1024,
                encapsulation: Encapsulation::None,
                traffic_rate: 100f32,
                burst: 100,
                vxlan: true,
                generation_accuracy: None,
                n_packets: None,
                n_pipes: None,
                timeout: None,
                number_of_lse: None
            }
        ],
        port_tx_rx_mapping: HashMap::from([(128, 136)]),
        duration: None,
        all_test: None,
        name: None,
};

    pub static ref EXAMPLE_POST_2_REQUEST: TrafficGenData = TrafficGenData {
        mode: GenerationMode::Cbr,
        stream_settings: vec![StreamSetting {
                port: 128,
                stream_id: 1,
                ethernet: Ethernet {
                    eth_src: "32:D5:42:2A:F6:92".to_string(),
                    eth_dst: "81:E7:9D:E3:AD:47".to_string(),
                },
                ip: IPv4 {
                    ip_src: Ipv4Addr::from_str("192.168.178.10").unwrap(),
                    ip_dst: Ipv4Addr::from_str("192.168.178.11").unwrap(),
                    ip_tos: 0,
                    ip_src_mask: Ipv4Addr::from_str("0.0.0.0").unwrap(),
                    ip_dst_mask: Ipv4Addr::from_str("0.0.0.0").unwrap()
                },
                active: true,
                mpls_stack: None,
                vxlan: None,
                vlan: Some(Vlan {
                    pcp: 1,
                    dei: 0,
                    vlan_id: 5,
                    inner_pcp: 0,
                    inner_dei: 0,
                    inner_vlan_id: 0
                })
            }
        ],
        streams: vec![Stream {
                stream_id: 1,
                app_id: 1,
                frame_size: 64,
                encapsulation: Encapsulation::Vlan,
                traffic_rate: 80f32,
                burst: 100,
                vxlan: false,
                generation_accuracy: None,
                n_packets: None,
                n_pipes: None,
                timeout: None,
                number_of_lse: None
            }
        ],
        port_tx_rx_mapping: HashMap::from([(128, 136)]),
        duration: None,
        all_test: None,
        name: None,
    };

    pub static ref EXAMPLE_POST_2_RESPONSE: Vec<Stream> = vec![Stream {
        stream_id: 1,
        app_id: 1,
        frame_size: 64,
        encapsulation: Encapsulation::Vlan,
        number_of_lse: None,
        traffic_rate: 80f32,
        burst: 100,
        n_packets: Some(5),
        timeout: Some(88),
        generation_accuracy: Some(100f32),
        n_pipes: Some(2),
        vxlan: false
    }];

    pub static ref EXAMPLE_POST_3_REQUEST: TrafficGenData = TrafficGenData {
        mode: GenerationMode::Poisson,
        port_tx_rx_mapping: HashMap::from([(68, 68)]),
        stream_settings: vec![
            StreamSetting {
                active: true,
                ethernet: Ethernet {
                    eth_src: "32:D5:42:2A:F6:92".to_string(),
                    eth_dst: "81:E7:9D:E3:AD:47".to_string(),
                },
                ip: IPv4 {
                    ip_src: Ipv4Addr::from_str("192.168.178.10").unwrap(),
                    ip_dst: Ipv4Addr::from_str("192.168.178.11").unwrap(),
                    ip_tos: 0,
                    ip_src_mask: Ipv4Addr::from_str("0.0.0.0").unwrap(),
                    ip_dst_mask: Ipv4Addr::from_str("0.0.0.0").unwrap(),
                },
                mpls_stack: None,
                port: 68,
                stream_id: 1,
                vlan: None,
                vxlan: None,
            }
        ],
        streams: vec![
            Stream {
                stream_id: 1,
                app_id: 1,
                frame_size: 64,
                traffic_rate: 30f32,
                burst: 100,
                encapsulation: Encapsulation::None,
                vxlan: false,
                number_of_lse: None,
                timeout: None,
                n_packets: None,
                generation_accuracy: None,
                n_pipes: None,
            }
        ],
        duration: None,
        all_test: None,
        name: None,
    };
}

