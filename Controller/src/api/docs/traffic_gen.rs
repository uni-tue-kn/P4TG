use std::collections::HashMap;
use std::net::Ipv4Addr;
use aide::transform::TransformOperation;
use crate::api::docs::extractor::Json;
use crate::api::{Stream, StreamSetting};
use crate::api::traffic_gen::{EmptyResponse, TrafficGenData};
use crate::core::traffic_gen_core::types::{Encapsulation, GenerationMode};

/// API description for /trafficgen
pub fn get_traffic_gen(op: TransformOperation) -> TransformOperation {
    op.description("The GET /trafficgen endpoint is used to query the current traffic generation configuration. It returns a 202 accepted if the traffic generator is not running at the moment.")
        .summary("/trafficgen")
        .tag("Traffic Generation")
        .response_with::<200, Json<TrafficGenData>, _>(|res| {
            res.example(TrafficGenData {
                mode: GenerationMode::CBR,
                stream_settings: vec![StreamSetting {
                    port: 150,
                    stream_id: 1,
                    vlan_id: 10,
                    pcp: 2,
                    dei: 0,
                    inner_vlan_id: 0,
                    inner_pcp: 0,
                    inner_dei: 0,
                    mpls_stack: Vec::new(),
                    eth_src: "3B:D5:42:2A:F6:92".to_string(),
                    eth_dst: "81:E7:9D:E3:AD:47".to_string(),
                    ip_src: Ipv4Addr::from([192, 168, 178, 10]),
                    ip_dst: Ipv4Addr::from([192, 168, 178, 11]),
                    ip_tos: 2,
                    ip_src_mask: Ipv4Addr::from([0, 0, 0, 0]),
                    ip_dst_mask: Ipv4Addr::from([255, 255, 0, 0]),
                    active: true,
                    vxlan: None
                }],
                streams: vec![Stream {
                    stream_id: 1,
                    app_id: 2,
                    frame_size: 64,
                    vxlan: false,
                    encapsulation: Encapsulation::VLAN,
                    number_of_lse: 0,
                    traffic_rate: 55.2,
                    burst: 1,
                    n_packets: None,
                    timeout: None,
                    generation_accuracy: None,
                    n_pipes: None,
                }],
                port_tx_rx_mapping: HashMap::from([(150, 134)]),
            }).description("Traffic generation is running.")
        })
        .response_with::<202, Json<EmptyResponse>, _>(|res| {
            res.example(EmptyResponse { message: "Not running.".to_string() })
                .description("Traffic generation is not running.")
        })
}

pub fn post_traffic_gen(op: TransformOperation) -> TransformOperation {
    op.description("The POST /trafficgen endpoint is used to configure a traffic generation. It returns a list of configured streams.")
        .summary("/trafficgen")
        .tag("Traffic Generation")
        .response_with::<200, Json<Vec<Stream>>, _>(|res| {
            res.example(vec![Stream {
                stream_id: 1,
                app_id: 2,
                vxlan: false,
                frame_size: 1024,
                encapsulation: Encapsulation::VLAN,
                number_of_lse: 0,
                traffic_rate: 90f32,
                burst: 1,
                n_packets: Some(1),
                timeout: Some(188),
                generation_accuracy: Some(99.101654),
                n_pipes: Some(2),
            }]).description("Traffic generation was successfully started.")

        })
}

pub fn delete_traffic_gen(op: TransformOperation) -> TransformOperation {
    op.description("The DELETE /trafficgen endpoint is used to stop the traffic generation.")
        .summary("/trafficgen")
        .tag("Traffic Generation")
        .response_with::<200, (), _>(|res| {
            res.description("Traffic generation was successfully stopped.")
        })
}
