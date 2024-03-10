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



use axum::http::{header, HeaderValue, Response, StatusCode};
use axum::extract::Path;
use axum::body::Body;
use axum::response::IntoResponse;
use include_dir::{include_dir, Dir};

static GUI_BUILD_DIR: Dir<'static> = include_dir!("$CARGO_MANIFEST_DIR/gui_build");

pub async fn static_path(Path(path): Path<String>) -> impl IntoResponse {
    let mut path = path.trim_start_matches('/');

    if path.is_empty() {
        path = "index.html";
    }

    let mime_type = mime_guess::from_path(path).first_or_text_plain();

    match GUI_BUILD_DIR.get_file(path) {
        None => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::empty())
            .unwrap(),
        Some(file) => Response::builder()
            .status(StatusCode::OK)
            .header(
                header::CONTENT_TYPE,
                HeaderValue::from_str(mime_type.as_ref()).unwrap(),
            )
            .body(Body::from(file.contents()))
            .unwrap(),
    }
}

pub async fn serve_index() -> impl IntoResponse {
    match GUI_BUILD_DIR.get_file("index.html") {
        None => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::empty())
            .unwrap(),
        Some(file) => Response::builder()
            .status(StatusCode::OK)
            .header(
                header::CONTENT_TYPE,
                "text/html"
            )
            .body(Body::from(file.contents()))
            .unwrap()
    }
}