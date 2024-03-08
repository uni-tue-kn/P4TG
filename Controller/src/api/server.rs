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

use std::net::SocketAddr;
use std::sync::{Arc};
use std::env;

use aide::{
    axum::ApiRouter,
    openapi::OpenApi,
    transform::TransformOpenApi,
};
use aide::axum::routing::{delete_with, get_with, post_with};
use log::{info, warn};
use serde::Serialize;
use axum::{routing::get, Extension, Json};
use axum::http::Method;
use axum::response::{IntoResponse, Response};
use axum::routing::post;

use tower_http::cors::{Any, CorsLayer};
use crate::api::{configure_traffic_gen, online, ports, reset, statistics, stop_traffic_gen, traffic_gen, restart, add_port, config};
use crate::api::docs::doc_route;
use crate::api::docs::online::get_online;
use crate::api::docs::reset::get_reset;
use crate::api::docs::restart::get_restart;
use crate::api::docs::statistics::{get_statistics};
use crate::api::docs::traffic_gen::{delete_traffic_gen, get_traffic_gen, post_traffic_gen};
use crate::api::helper::serve_static_files::{serve_index, static_path};
use crate::api::ports::arp_reply;
use crate::api::statistics::time_statistics;
use crate::api::tables::tables;
use crate::AppState;


#[derive(Serialize)]
pub struct Error {
    pub(crate) message: String
}

impl Error {
    pub fn new(message: String) -> Error {
        warn!("Error from REST API: {}", message);
        Error { message }
    }
}

impl IntoResponse for Error {
    fn into_response(self) -> Response {
        Json(self).into_response()
    }
}


pub async fn start_api_server(state: Arc<AppState>) {
    aide::gen::extract_schemas(true);
    let mut api = OpenApi::default();

    let port = env::var("P4TG_PORT").unwrap_or("8000".to_owned()).parse().unwrap_or(8000);

    let cors = CorsLayer::new()
        // allow `GET` and `POST` when accessing the resource
        .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::OPTIONS])
        // allow requests from any origin
        .allow_origin(Any)
        .allow_headers(Any);

    // Router for the REST API
    let api_router = ApiRouter::new()
        .api_route("/online", get_with(online, get_online))
        .api_route("/statistics", get_with(statistics, get_statistics))
        .route("/time_statistics", get(time_statistics))
        .api_route("/trafficgen", get_with(traffic_gen, get_traffic_gen))
        .api_route("/trafficgen", post_with(configure_traffic_gen, post_traffic_gen))
        .api_route("/trafficgen", delete_with(stop_traffic_gen, delete_traffic_gen))
        .api_route("/reset", get_with(reset, get_reset))
        .api_route("/restart", get_with(restart, get_restart))
        .route("/ports", get(ports))
        .route("/ports", post(add_port))
        .route("/ports/arp", post(arp_reply))
        .route("/tables", get(tables))
        .route("/config", get(config))
        .nest_api_service("/docs", doc_route::docs_routes())
        .layer(cors)
        .finish_api_with(&mut api, api_docs)
        .layer(Extension(Arc::new(api)))
        .with_state(Arc::clone(&state));

    // Router for the static configuration gui
    let app = ApiRouter::new()
        .nest_service("/api", api_router)
        .route("/", get(serve_index)) // create react routing endpoints
        .route("/home", get(serve_index))
        .route("/ports", get(serve_index))
        .route("/tables", get(serve_index))
        .route("/settings", get(serve_index))
        .route("/*path", get(static_path));


    info!("Starting rest api server on port {}.", port);

    let addr = SocketAddr::from(([0,0,0,0], port));


    axum::Server::bind(&addr)
        .serve(app.into_make_service())
        .await
        .unwrap();
}

fn api_docs(api: TransformOpenApi) -> TransformOpenApi {
    api.title("P4TG Rest API documentation")
        .summary("Documentation for the rest api of P4TG.")
        .description("This documentation covers the REST API of the P4TG controller. \
                       The REST API offers endpoint to configure the traffic generator.")
}




