use aide::transform::TransformOperation;
use crate::api::docs::extractor::Json;
use crate::api::online::Online;

pub fn get_online(op: TransformOperation) -> TransformOperation {
    op.description("This endpoint is used to check if the control plane is available.")
        .summary("/online")
        .tag("Online status")
        .response_with::<200, Json<Online>, _>(|res| {
            res.example(Online { status: "online".to_string() })
        })
}