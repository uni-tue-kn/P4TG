use aide::transform::TransformOperation;
use crate::api::docs::extractor::Json;
use crate::api::reset::Reset;

pub fn get_reset(op: TransformOperation) -> TransformOperation {
    op.description("This endpoint is used to reset the statistics.")
        .summary("/reset")
        .tag("Statistics")
        .response_with::<200, Json<Reset>, _>(|res| {
            res.example(Reset { message: "Reset complete".to_string() })
                .description("Statistics were successfully reset.")
        })
}