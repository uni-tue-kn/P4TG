use std::sync::Arc;
use std::time::Duration;
use axum::debug_handler;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json, Response};
use serde::de::DeserializeOwned;
use crate::api::helper::validate::validate_request;
use std::time::SystemTime;
use crate::api::server::Error;
use crate::AppState;
use crate::core::traffic_gen_core::types::*;
use crate::api::traffic_gen::stop_traffic_gen;
use crate::api::statistics::{Statistics, statistics, time_statistics};
use axum::extract::Query;
use crate::core::statistics::TimeStatistic;
use axum::body::{self};
use log::{error, info};
use tokio::sync::watch;

/// Method called on POST /multiple_trafficgen
/// Starts the tests of multiple traffic generations with the specified settings and durations in the POST body
#[debug_handler]
pub async fn configure_multiple_traffic_gen(State(state): State<Arc<AppState>>, Json(payload): Json<Vec<TrafficGenData>>) -> Response {
    if !validate_payload(&payload) {
        return (StatusCode::BAD_REQUEST, Json(Error::new("Each Test must have a valid duration."))).into_response();
    }

    // Abort any currently running test
    abort_current_test(Arc::clone(&state)).await;

    info!("Starting multiple traffic generations");

    let state_clone = Arc::clone(&state);
    let payload_clone = payload.clone();
    
    let mut abort_rx = create_and_store_abort_sender(state_clone.clone()).await;
    
    reset_and_start_experiment(state_clone.clone(), payload_clone.clone()).await;    

    tokio::spawn(async move {
        // Iterate over all traffic_generations which were included in the payload
        for (i, tg_data) in payload_clone.iter().enumerate() {

            let duration_f64 = tg_data.duration.map(|d| d as f64);

            match start_traffic_gen_with_duration(state_clone.clone(), tg_data.clone(), i, duration_f64, &mut abort_rx).await {
                Ok(_) => {
                        // Save statistics if multi test is running
                        // Different statistic tables have to be synchronized
                        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                        if let Err(err) = save_statistics(Arc::clone(&state_clone), i).await {
                            error!("Failed to save the statistics of the current test {}: {}", i, err);
                            return;
                        } 
                    
                },
                Err(err) => {
                    error!("{}", err);
                    break;
                }
            }
        }

        // Set the running flag to false after the last test
        let mut experiment = state_clone.experiment.lock().await;
        experiment.running = false;
    });

    StatusCode::OK.into_response()
}




/// Starts single traffic generation with duration 
pub async fn start_traffic_gen_with_duration(
    state: Arc<AppState>,
    tg_data: TrafficGenData,
    test_index: usize,
    duration: Option<f64>,
    abort_rx: &mut watch::Receiver<()>,
) -> Result<(), String> {

    info!("Start traffic generation with duration: {:?}", duration);

    let configure_response = start_traffic_gen(State(Arc::clone(&state)), Json(tg_data.clone())).await;

    if configure_response.status() != StatusCode::OK {
        error!("Failed to configure traffic generation: {:?}", configure_response);
        return Err(format!("Failed to configure traffic generation: {:?}", configure_response));
    }

    if monitor_test_duration(state.clone(), duration, test_index, abort_rx).await.is_err() {
        info!("Test {} was aborted", test_index + 1);
        return Err("Test was aborted".to_string());
    }

    let stop_response = stop_traffic_gen(State(Arc::clone(&state))).await;

    if stop_response.status() != StatusCode::OK {
        error!("Failed to stop traffic generation: {:?}", stop_response);
        return Err(format!("Failed to stop traffic generation: {:?}", stop_response));
    }

    Ok(())
}




/// Extracts the HTTP Response body
pub async fn parse_response<T: DeserializeOwned>(response: Response<axum::body::Body>) -> Result<T, serde_json::Error> {
    let body_bytes = body::to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    serde_json::from_slice(&body_bytes)
}



/// Checks Payload if the format is correct 
fn validate_payload(payload: &Vec<TrafficGenData>) -> bool {
    for tg_data in payload {
        match tg_data.duration {
            Some(d) if d > 0 => continue,
            None => continue,
            _ => return false,
        }
    }

    true
}

/// Monitors the duration of a test and regularly checks if the test has been aborted.
async fn monitor_test_duration(
    state: Arc<AppState>, 
    duration: Option<f64>, 
    test_index: usize,
    abort_rx: &mut watch::Receiver<()>,
) -> Result<(), ()> {
    if let Some(d) = duration {
        let start_time = SystemTime::now();
        let duration = Duration::from_secs_f64(d);

        loop {
            let elapsed = start_time.elapsed().unwrap_or_default();
            if elapsed >= duration {
                break;
            }

            let remaining_duration = duration - elapsed;

            tokio::select! {
                _ = tokio::time::sleep(remaining_duration.min(Duration::from_millis(100))) => {},
                _ = abort_rx.changed() => {
                    info!("Abort signal received during test duration monitoring");
                    return Err(());
                }
            }

            if !state.experiment.lock().await.running {
                info!("Skipping test {}", test_index + 1);
                break;
            }
        }
    } else {

        info!("INFINITE TEST");

        loop {
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_millis(100)) => {},
                _ = abort_rx.changed() => {
                    info!("Abort signal received during infinite test monitoring");
                    return Err(());
                }
            }

            if !state.experiment.lock().await.running {
                info!("Ending single test");
                break;
            }
        }
    }

    Ok(())
}


// Reset of statistics and traffic_generators in Appstate, start of experiment
pub async fn reset_and_start_experiment(state_clone: Arc<AppState>, payload_clone: Vec<TrafficGenData>) {
    let mut collected_statistics = state_clone.multi_test_state.collected_statistics.lock().await;
    collected_statistics.clear();

    let mut collected_time_statistics = state_clone.multi_test_state.collected_time_statistics.lock().await; 
    collected_time_statistics.clear();

    let mut multiple_traffic_generators = state_clone.multi_test_state.multiple_traffic_generators.lock().await;
    multiple_traffic_generators.clear(); 
    multiple_traffic_generators.extend(payload_clone.clone());
}

// Save the statistics of the current test in Appstate
pub async fn save_statistics(state_clone: Arc<AppState>, i: usize) -> Result<(), String> {
    // Using statistics endpoint to retrieve the statistics of the current test

    let stats_response = statistics(State(Arc::clone(&state_clone))).await;
    if let Ok(mut stats) = parse_response::<Statistics>(stats_response).await {
        // Storing statistics in AppState
        stats.previous_statistics = None;
        state_clone.multi_test_state.collected_statistics.lock().await.push(stats.clone());
    } else {
        return Err(format!("Failed to retrieve statistics for test {}", i + 1));
    }

    // Using time_statistics endpoint to retrieve the statistics of the current test
    let time_stats_response = time_statistics(State(Arc::clone(&state_clone)), Query(Default::default())).await;
    if let Ok(mut time_stats) = parse_response::<TimeStatistic>(time_stats_response).await {
        // Storing time_statistics in AppState
        time_stats.previous_time_statistics = None;
        state_clone.multi_test_state.collected_time_statistics.lock().await.push(time_stats.clone());
    } else {
        return Err(format!("Failed to retrieve time statistics for test {}", i + 1));
    }

    Ok(())
}

// Creates abort sender and stores it in the AppState, s.t. other threads can abort the current test
pub async fn create_and_store_abort_sender(state: Arc<AppState>) -> watch::Receiver<()> {
    let (abort_tx, abort_rx) = watch::channel(());

    {
        let mut abort_sender = state.multi_test_state.abort_sender.lock().await;
        *abort_sender = Some(abort_tx);
    }

    abort_rx
}



// Aborts the current test
pub async fn abort_current_test(state: Arc<AppState>) {
    let abort_sender = state.multi_test_state.abort_sender.lock().await.clone();
    
    if let Some(abort_tx) = abort_sender {
        // Send the abort signal
        let _ = abort_tx.send(());
        info!("Abort signal sent");
    }
}


/// Starts single traffic generation
async fn start_traffic_gen(State(state): State<Arc<AppState>>, payload: Json<TrafficGenData>) -> Response {
    let tg = &mut state.traffic_generator.lock().await;

    // contains the description of the stream, i.e., packet size and rate
    // only look at active stream settings
    let active_stream_settings: Vec<StreamSetting> = payload.stream_settings.clone().into_iter().filter(|s| s.active).collect();
    let active_stream_ids: Vec<u8> = active_stream_settings.iter().map(|s| s.stream_id).collect();
    let active_streams: Vec<Stream> = payload.streams.clone().into_iter().filter(|s| active_stream_ids.contains(&s.stream_id)).collect();

    // Poisson traffic is only allowed to have a single stream
    if payload.mode == GenerationMode::Poisson && active_streams.len() != 1 {
        return (StatusCode::BAD_REQUEST, Json(Error::new("Poisson generation mode only allows for one stream."))).into_response()
    }

    // no streams should be generated in monitor/analyze mode
    if payload.mode == GenerationMode::Analyze && !active_streams.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(Error::new("No stream definition in analyze mode allowed."))).into_response();
    }

    // contains the mapping of Send->Receive ports
    // required for analyze mode
    let port_mapping = &payload.port_tx_rx_mapping;

    // validate request
    match validate_request(&active_streams, &active_stream_settings, &payload.mode, tg.is_tofino2) {
        Ok(_) => {},
        Err(e) => return (StatusCode::BAD_REQUEST, Json(e)).into_response()
    }

    match tg.start_traffic_generation(&state, active_streams, payload.mode, active_stream_settings, port_mapping).await {
        Ok(streams) => {
            // store the settings for synchronization between multiple
            // GUI clients
            tg.port_mapping = payload.port_tx_rx_mapping.clone();
            tg.stream_settings = payload.stream_settings.clone();
            tg.streams = payload.streams.clone();
            tg.mode = payload.mode;

            // experiment starts now
            // these values are used to show how long the experiment is running at the GUI
            state.experiment.lock().await.start = SystemTime::now();
            state.experiment.lock().await.running = true;

            info!("Traffic generation started.");
            (StatusCode::OK, Json(streams)).into_response()
        }
        Err(err) => (StatusCode::INTERNAL_SERVER_ERROR, Json(Error::new(format!("{:#?}", err)))).into_response()
    }
}
