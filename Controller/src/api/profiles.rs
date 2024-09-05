use crate::core::traffic_gen_core::types::*;
use crate::api::multiple_traffic_gen::abort_current_test;
use crate::api::traffic_gen::{stop_traffic_gen, configure_traffic_gen};
use crate::api::rfc_tests::{throughput_test, latency_test, frame_loss_rate_test, reset_test, reset_results, reset_collected_statistics, handle_test_result, set_running_flag, set_name_flag};
use crate::AppState;


use std::sync::Arc;
use log::info;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json, Response};
use serde::Deserialize;
use std::future::Future;

#[derive(Clone, Debug, Deserialize)]
pub struct TestRequest {
    pub profile_id: u8, // IMIX = 0, RFC 2544 = 1
    pub test_id: u8, // If RFC 2544: 0 = Run all tests, 1 = Throughput, 2 = Latency, 3 = Frame Loss Rate, 4 = Reset
    pub payload: TrafficGenData,
}

/// Method called on GET /profiles
pub async fn rfc_results(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let test_results = state.multi_test_state.rfc_results.lock().await;
    Json(test_results.clone()).into_response()
}
/// Method called on POST /profiles
pub async fn run_profile(State(state): State<Arc<AppState>>, Json(request): Json<TestRequest>) -> Response {
    match request.profile_id {
        1 => run_rfc(State(state), Json(request)).await,
        0 => run_imix(State(state), Json(request)).await,
        _ => (StatusCode::BAD_REQUEST, Json("Invalid profile_id")).into_response(),
    }
}

// Start IMIX test
pub async fn run_imix(
    state: State<Arc<AppState>>,
    Json(request): Json<TestRequest>,
) -> Response {
    configure_traffic_gen(state, Json(request.payload)).await
}


// Start RFC 2544 test
pub async fn run_rfc(State(state): State<Arc<AppState>>, Json(request): Json<TestRequest>) -> Response {
    
    // Check if exactly one stream is defined
    if request.payload.streams.len() != 1 {
        return (StatusCode::BAD_REQUEST, Json("RFC 2544 Test can only process one stream")).into_response();
    }

    // Reset results before starting tests
    reset_results(Arc::clone(&state)).await;

    // Abort any currently running test
    abort_current_test(Arc::clone(&state)).await;
    
    let state_clone = Arc::clone(&state);
    let payload = request.payload.clone();
    
    // Clear collected statistics and traffic generators
    reset_collected_statistics(Arc::clone(&state)).await;
 
    tokio::spawn(async move {
        if request.test_id == 0 {
            // Run all tests
            if run_all_tests_inner(state_clone, payload).await.is_err() {
                set_running_flag(&state, false).await;
            }
        } else {
            // Run a specific test
            if run_single_test(state_clone, request.test_id, payload).await.is_err() {
                set_running_flag(&state, false).await;
            }
        }
    });


    // Return an immediate response to the client
    StatusCode::OK.into_response()
}

/// Method called on DELETE /profiles
pub async fn abort_profile(State(state): State<Arc<AppState>>) -> Response {
    info!("Abort test profile");
    
    abort_current_test(Arc::clone(&state)).await;

    stop_traffic_gen(State(Arc::clone(&state))).await;

    (StatusCode::OK, Json("Profile aborted")).into_response()
}


// Run all RFC 2544 tests sequentially
async fn run_all_tests_inner(state: Arc<AppState>, payload: TrafficGenData) -> Result<(), ()> {
    set_running_flag(&state, true).await;

    // Run all tests sequentially
    if run_test(Arc::clone(&state), payload.clone(), throughput_test, "Throughput").await.is_err() {
        return Err(());
    }
    if run_test(Arc::clone(&state), payload.clone(), latency_test, "Latency").await.is_err() {
        return Err(());
    }
    if run_test(Arc::clone(&state), payload.clone(), frame_loss_rate_test, "Frame Loss Rate").await.is_err() {
        return Err(());
    }
    if run_test(Arc::clone(&state), payload, reset_test, "Reset").await.is_err() {
        return Err(());
    }

    set_running_flag(&state, false).await;
    Ok(())
}

// Run a single RFC 2544 test
async fn run_single_test(state: Arc<AppState>, test_id: u8, payload: TrafficGenData) -> Result<(), ()> {
    // Set the running flag to true
    set_running_flag(&state, true).await;

    let result = match test_id {
        1 => run_test(Arc::clone(&state), payload, throughput_test, "Throughput").await,
        2 => run_test(Arc::clone(&state), payload, latency_test, "Latency").await,
        3 => run_test(Arc::clone(&state), payload, frame_loss_rate_test, "Frame Loss Rate").await,
        4 => run_test(Arc::clone(&state), payload, reset_test, "Reset").await,
        _ => Err(()),
    };

    // Set the running flag to false
    set_running_flag(&state, false).await;

    result
}


async fn run_test<F, Fut, T>(
    state: Arc<AppState>,
    payload: TrafficGenData,
    test_fn: F,
    test_name: &str,
) -> Result<(), ()>
where
    F: Fn(State<Arc<AppState>>, Json<TrafficGenData>) -> Fut,
    Fut: Future<Output = Result<(StatusCode, Json<T>), Response>>,
    T: std::fmt::Debug,
{
    info!("Starting {} test", test_name);
    set_name_flag(&state, format!("{} Test", test_name)).await;
    let result = test_fn(State(Arc::clone(&state)), Json(payload)).await;
    handle_test_result(result, test_name).await
}

