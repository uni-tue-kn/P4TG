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
use std::env;

use log::{info, warn};
use serde::Serialize;
use axum::{routing::get, Json, Router};
use axum::http::Method;
use axum::response::{IntoResponse, Response};
use axum::routing::post;

use utoipa::{openapi::security::{ApiKey, ApiKeyValue, SecurityScheme}, Modify, OpenApi};
use utoipa_swagger_ui::SwaggerUi;

use tower_http::cors::{Any, CorsLayer};
use crate::api::{add_port, config, configure_traffic_gen, online, ports, reset, restart, statistics, stop_traffic_gen, traffic_gen, configure_multiple_traffic_gen, run_profile, rfc_results, abort_profile};


use crate::api::helper::serve_static_files::{serve_index, static_path};
use crate::api::ports::arp_reply;
use crate::api::statistics::time_statistics;
use crate::api::tables::tables;
use crate::AppState;
use crate::api::tables;

use crate::core::traffic_gen_core::types::*;


#[derive(OpenApi)]
#[openapi(
    paths(
        traffic_gen::traffic_gen,
        traffic_gen::configure_traffic_gen,
        traffic_gen::stop_traffic_gen,
        tables::tables,
        statistics::statistics,
        restart::restart,
        reset::reset,
        ports::ports
    ),
    components(
        schemas(TrafficGenData,
        GenerationMode,
        Encapsulation,
        StreamSetting,
        Stream,
        EmptyResponse,
        Reset,
        Ethernet,
        IPv4,
        Vlan,
        VxLAN,
        MPLSHeader,
        tables::TableDescriptor,
        statistics::Statistics,
        crate::core::statistics::RangeCount,
        crate::core::statistics::RangeCountValue,
        crate::core::statistics::TypeCount,
        crate::core::statistics::IATStatistics,
        crate::core::statistics::RTTStatistics,
        crate::core::statistics::IATValues
        )
    ),
    modifiers(&SecurityAddon),
    tags(
        (name = "P4TG REST-API", description = "Documentation of the REST-API of P4TG.")
    )
)]
struct ApiDoc;

struct SecurityAddon;

impl Modify for SecurityAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        if let Some(components) = openapi.components.as_mut() {
            components.add_security_scheme(
                "api_key",
                SecurityScheme::ApiKey(ApiKey::Header(ApiKeyValue::new("todo_apikey"))),
            )
        }
    }
}


#[derive(Serialize)]
pub struct Error {
    pub(crate) message: String
}

impl Error {
    pub fn new<T: Into<String> + AsRef<str>>(message: T)-> Error {
        warn!("Error from REST API: {}", message.as_ref());
        Error { message: message.into() }
    }
}

impl IntoResponse for Error {
    fn into_response(self) -> Response {
        Json(self).into_response()
    }
}


pub async fn start_api_server(state: Arc<AppState>) {

    let port = env::var("P4TG_PORT").unwrap_or("8000".to_owned()).parse().unwrap_or(8000);

    let cors = CorsLayer::new()
        // allow `GET` and `POST` when accessing the resource
        .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::OPTIONS])
        // allow requests from any origin
        .allow_origin(Any)
        .allow_headers(Any);


    // Router for the REST API
    let api_router = Router::new()
        .route("/online", get(online))
        .route("/statistics", get(statistics))
        .route("/time_statistics", get(time_statistics))
        .route("/trafficgen", get(traffic_gen).post(configure_traffic_gen).delete(stop_traffic_gen))
        .route("/reset", get(reset))
        .route("/restart", get(restart))
        .route("/ports", get(ports))
        .route("/ports", post(add_port))
        .route("/ports/arp", post(arp_reply))
        .route("/tables", get(tables))
        .route("/config", get(config))
        .route("/multiple_trafficgen", post(configure_multiple_traffic_gen))
        .route("/profiles", get(rfc_results).post(run_profile).delete(abort_profile))
        .layer(cors)
        .with_state(Arc::clone(&state));

    // Router for the static configuration gui
    let app = Router::new()
        .merge(SwaggerUi::new("/api/docs").url("/api-docs/openapi.json", ApiDoc::openapi()))
        .nest_service("/api", api_router)
        .route("/", get(serve_index)) // create react routing endpoints
        .route("/home", get(serve_index))
        .route("/ports", get(serve_index))
        .route("/tables", get(serve_index))
        .route("/settings", get(serve_index))
        .route("/*path", get(static_path));


    info!("Starting rest api server on port {}.", port);


    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port))
        .await.unwrap_or_else(|_| panic!("Unable to listen on 0.0.0.0:{}", port));

    axum::serve(listener, app).await.unwrap();
}





