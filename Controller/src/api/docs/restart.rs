use aide::transform::TransformOperation;
use crate::api::docs::extractor::Json;
use crate::api::Stream;
use crate::core::traffic_gen_core::types::Encapsulation;

pub fn get_restart(op: TransformOperation) -> TransformOperation {
    op.description("This endpoint is used to restart the current traffic generation operation.")
        .summary("/restart")
        .tag("Traffic Generation")
        .response_with::<200, Json<Vec<Stream>>, _>(|res| {
            res.example(vec![Stream {
                stream_id: 1,
                app_id: 2,
                frame_size: 1024,
                encapsulation: Encapsulation::VLAN,
                traffic_rate: 90f32,
                burst: 1,
                n_packets: Some(1),
                timeout: Some(188),
                generation_accuracy: Some(99.101654),
                n_pipes: Some(2),
            }]).description("Traffic generation was successfully restarted.")
        })
}