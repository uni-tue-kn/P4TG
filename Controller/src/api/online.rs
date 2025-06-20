/* Copyright 2022-present University of Tuebingen, Chair of Communication Networks
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/*
 * Steffen Lindner (steffen.lindner@uni-tuebingen.de)
 */

use crate::api::docs;
use crate::AppState;
use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use schemars::JsonSchema;
use serde::Serialize;
use std::sync::Arc;
use utoipa::ToSchema;

#[derive(Serialize, JsonSchema, ToSchema)]
pub enum Asic {
    Tofino1,
    Tofino2,
}

#[derive(Serialize, JsonSchema, ToSchema)]
pub struct Online {
    pub(crate) status: String,
    pub(crate) version: String,
    pub(crate) asic: Asic,
    pub(crate) loopback: bool,
}

/// Online endpoint
/// Returns the currently configured ports
#[utoipa::path(
    get,
    path = "/api/online",
    responses(
    (status = 200,
    body = Online,
    description = "Returns the status of P4TG.",
    example = json!(*docs::online::EXAMPLE_GET_1)
    ))
)]
pub async fn online(State(state): State<Arc<AppState>>) -> (StatusCode, Json<Online>) {
    (
        StatusCode::OK,
        Json(Online {
            status: "online".to_owned(),
            version: env!("CARGO_PKG_VERSION").parse().unwrap(),
            asic: if state.tofino2 {
                Asic::Tofino2
            } else {
                Asic::Tofino1
            },
            loopback: state.loopback_mode,
        }),
    )
}
