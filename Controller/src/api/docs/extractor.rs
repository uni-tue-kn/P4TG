use aide::operation::OperationIo;
use axum::response::IntoResponse;
use axum_jsonschema::JsonSchemaRejection;
use axum_macros::FromRequest;
use serde::Serialize;
use crate::api::server::Error;

#[derive(FromRequest, OperationIo)]
#[from_request(via(axum_jsonschema::Json), rejection(Error))]
#[aide(
input_with = "axum_jsonschema::Json<T>",
output_with = "axum_jsonschema::Json<T>",
json_schema
)]
pub struct Json<T>(pub T);

impl<T> IntoResponse for Json<T>
    where
        T: Serialize,
{
    fn into_response(self) -> axum::response::Response {
        axum::Json(self.0).into_response()
    }
}

impl From<JsonSchemaRejection> for Error {
    fn from(rejection: JsonSchemaRejection) -> Self {
        match rejection {
            JsonSchemaRejection::Json(j) => Self::new(j.to_string()),
            JsonSchemaRejection::Serde(_) => Self::new("invalid request".to_string()),
            JsonSchemaRejection::Schema(_) => {
                Self::new("invalid request".to_string())
            }
        }
    }
}