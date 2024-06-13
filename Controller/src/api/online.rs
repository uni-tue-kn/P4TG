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

use std::sync::Arc;
use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use schemars::JsonSchema;
use serde::Serialize;
use crate::AppState;

#[derive(Serialize, JsonSchema)]
pub enum ASIC {
    Tofino1,
    Tofino2
}

#[derive(Serialize, JsonSchema)]
pub struct Online {
    pub(crate) status: String,
    pub(crate) version: String,
    pub(crate) asic: ASIC
}

/// Online endpoint
pub async fn online(State(state): State<Arc<AppState>>) -> (StatusCode, Json<Online>) {
    (StatusCode::OK, Json(Online {status: "online".to_owned(),
        version: env!("CARGO_PKG_VERSION").parse().unwrap(),
        asic: if state.traffic_generator.lock().await.is_tofino2 {ASIC::Tofino2} else {ASIC::Tofino1}
    }
    ))
}

