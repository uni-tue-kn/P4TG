use crate::core::traffic_gen_core::types::*;
use crate::api::multiple_traffic_gen::{
    start_traffic_gen_with_duration, create_and_store_abort_sender, abort_current_test, 
    save_statistics, parse_response,
};
use crate::api::statistics::{Statistics, statistics};
use crate::AppState;

use rbfrt::util::port_manager::Speed;

use std::sync::Arc;
use axum::extract::State;
use axum::http::StatusCode;
use crate::api::server::Error;
use axum::response::{IntoResponse, Json, Response};
use log::{error, info, warn};
use tokio::time::{sleep, Duration};
use std::time::Instant;
use std::collections::BTreeMap;


use rbfrt::table;
use rbfrt::table::{MatchValue, ToBytes};
use std::collections::HashMap;


const FRAME_SIZES: [u32; 5] = [64, 128, 512, 1024, 1518];
const IAT_PRECISION: u16 = 1;
const RATE_PRECISION: u16 = 100;


// Throughput test defined in RFC 2544 section 25.1
// Uses Exponential and Binary search to find the optimal throughput
pub async fn throughput_test(
    State(state): State<Arc<AppState>>, 
    Json(payload): Json<TrafficGenData>
) -> Result<(StatusCode, Json<BTreeMap<u32, f32>>), Response> {
    abort_current_test(Arc::clone(&state)).await;
    info!("Starting throughput test for all frame sizes");

    let mut frame_rate_results = BTreeMap::new();

    for &frame_size in FRAME_SIZES.iter() {
        let mut test_payload = payload.clone();
        test_payload.streams[0].burst = RATE_PRECISION;
        test_payload.streams[0].frame_size = frame_size;

        
        save_tg(Arc::clone(&state), test_payload.clone(), format!("Throughput - {} Bytes", frame_size)).await;

        let initial_tx_rate = test_payload.streams[0].traffic_rate;

        // Perform exponential search to find the interval
        let (lower_bound, upper_bound) = exponential_search_for_max_rate(
            Arc::clone(&state),
            test_payload.clone(),
            initial_tx_rate,
        ).await?;

        warn!("Interval of Exponential search for {} Bytes: [{}, {}]", frame_size, lower_bound, upper_bound);

        // Perform binary search within the found interval, to find the maximum successful rate
        let max_successful_rate = binary_search_for_rate(
            Arc::clone(&state),
            test_payload,
            lower_bound,
            upper_bound,
        ).await?;

        info!("MAX SUCCESSFUL RATE: {}", max_successful_rate);
        
        let frame_rate = max_successful_rate * 1e9 / (frame_size as f32 * 8.0);
        
        info!("FRAME RATE: {}", frame_rate);

        let calculated_max_rate = frame_rate * frame_size as f32 * 8.0 / 1e9;

        info!("CALCULATED MAX RATE: {}", calculated_max_rate);

        // Save the result for the current frame size
        frame_rate_results.insert(frame_size, frame_rate);

        info!("{:?}", frame_rate_results);

        // Save the results to the state
        let mut test_result = state.multi_test_state.rfc_results.lock().await;
        test_result.throughput = Some(frame_rate_results.clone());
        

        // Save the statistics
        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;

        if let Err(err) = save_statistics(Arc::clone(&state), 2).await {
            error!("Failed to save the statistics of the throughput test for {} Bytes: {}", frame_size, err);
            return Err((StatusCode::INTERNAL_SERVER_ERROR, Json(Error::new(format!("Failed to save the statistics of the throughput test for {} Bytes: {}", frame_size, err)))).into_response());
        }
    }

    let result = (StatusCode::OK, Json(frame_rate_results));
    Ok(result)
}

async fn binary_search_for_rate(
    state: Arc<AppState>,
    mut test_payload: TrafficGenData,
    mut lower_bound: f32,
    mut upper_bound: f32,
) -> Result<f32, Response> {

    let max_iterrations = 20;
    let epsilon = 0.001;
    // Change to 0.01 for 1% tolerance
    let tolerance = 0.03;
    
    
    let mut abort_rx = create_and_store_abort_sender(Arc::clone(&state)).await;
    let mut max_successful_rate = 0.0;

    for _ in 0..max_iterrations {
        let current_rate = (lower_bound + upper_bound) / 2.0;

        info!("current_rate: {}, [{},{}] ", current_rate, lower_bound, upper_bound);

        // Adjusting traffic rate for single stream
        test_payload.streams[0].traffic_rate = current_rate;
        
        match start_traffic_gen_with_duration(Arc::clone(&state), test_payload.clone(), 0, Some(10.0), &mut abort_rx).await {
            Ok(_) => {
                info!("Successfully completed traffic generation with current rate: {}", current_rate);

                let stats_response = statistics(State(Arc::clone(&state))).await;
                if let Ok(stats) = parse_response::<Statistics>(stats_response).await {
                    let total_packets_sent: u64 = stats.frame_size.values()
                        .flat_map(|f| f.tx.iter())
                        .map(|v| v.packets as u64)
                        .sum();
                    
                    let packet_loss: u64 = stats.packet_loss.values().sum();

                    let packet_loss_percent = if total_packets_sent > 0 {
                        round_to_three_places((packet_loss as f64 / total_packets_sent as f64) * 100.0)
                    } else {
                        0.0
                    };

                    info!("Total packets sent: {}", total_packets_sent);
                    info!("Packet loss: {} packets", packet_loss);
                    info!("Packet loss percentage: {:.2}%", packet_loss_percent);

                    if packet_loss_percent <= tolerance {
                        lower_bound = current_rate;
                        max_successful_rate = current_rate;
                    } else {
                        upper_bound = current_rate;
                    }
                } else {
                    error!("Failed to retrieve statistics for current rate: {}", current_rate);
                }
            },
            Err(err) => {
                error!("Error in traffic generation with current rate: {}: {}", current_rate, err);
                return Err((StatusCode::INTERNAL_SERVER_ERROR, Json(Error::new(format!("Error in traffic generation with current rate: {}: {}", current_rate, err)))).into_response());
            }
        }

        if (upper_bound - lower_bound).abs() < epsilon {
            info!("Binary search converged, returning max_successful_rate: {}", max_successful_rate);
            break;
        }
    }

    Ok(max_successful_rate)
}

async fn exponential_search_for_max_rate(
    state: Arc<AppState>,
    mut test_payload: TrafficGenData,
    initial_tx_rate: f32,
) -> Result<(f32, f32), Response> {
    let mut k = 0;
    let mut current_rate = initial_tx_rate;

    let max_iterrations = 10;

    // Limiting k to avoid infinite loop in case of errors
    while k < max_iterrations {
        let test_rate = initial_tx_rate * 2f32.powi(k);

        if test_rate > 100.0 {
            let lower_bound = initial_tx_rate * 2f32.powi(k - 1);
            info!("Test rate exceeds 100 Gbps, returning interval [{}, 100]", lower_bound);
            return Ok((lower_bound, 100.0));
        }

        info!("Exponential search iteration {}: testing rate {}", k, test_rate);

        test_payload.streams[0].traffic_rate = test_rate;

        match start_traffic_gen_with_duration(Arc::clone(&state), test_payload.clone(), 0, Some(10.0), &mut create_and_store_abort_sender(Arc::clone(&state)).await).await {
            Ok(_) => {
                info!("Successfully completed traffic generation with test rate: {}", test_rate);

                let stats_response = statistics(State(Arc::clone(&state))).await;
                if let Ok(stats) = parse_response::<Statistics>(stats_response).await {
                    let total_packets_sent: u64 = stats.frame_size.values()
                        .flat_map(|f| f.tx.iter())
                        .map(|v| v.packets as u64)
                        .sum();

                    let packet_loss: u64 = stats.packet_loss.values().sum();
                    let packet_loss_percent = if total_packets_sent > 0 {
                        round_to_three_places((packet_loss as f64 / total_packets_sent as f64) * 100.0)
                    } else {
                        0.0
                    };

                    info!("Total packets sent: {}", total_packets_sent);
                    info!("Packet loss: {} packets", packet_loss);
                    info!("Packet loss percentage: {:.3}%", packet_loss_percent);

                    if packet_loss_percent == 0.0 {
                        current_rate = test_rate;
                        k += 1;
                    } else {
                        let lower_bound = if k == 0 { 0.0 } else { initial_tx_rate * 2f32.powi(k - 1) };
                        info!("Packet loss detected: {}%, returning interval [{}, {}]", packet_loss_percent, lower_bound, test_rate);
                        return Ok((lower_bound, test_rate));
                    }
                } else {
                    error!("Failed to retrieve statistics for test rate: {}", test_rate);
                    return Err((StatusCode::INTERNAL_SERVER_ERROR, Json(Error::new(format!("Failed to retrieve statistics for test rate: {}", test_rate)))).into_response());
                }
            },
            Err(err) => {
                error!("Error in traffic generation with test rate: {}: {}", test_rate, err);
                return Err((StatusCode::INTERNAL_SERVER_ERROR, Json(Error::new(format!("Error in traffic generation with test rate: {}: {}", test_rate, err)))).into_response());
            }
        }
    }

    let lower_bound = current_rate / 2.0;
    let upper_bound = current_rate;
    Ok((lower_bound, upper_bound))
}






// Latency test defined in RFC 2544 section 25.2
// Uses One-Way Latency to measure the average latency
pub async fn latency_test(State(state): State<Arc<AppState>>, Json(payload): Json<TrafficGenData>) -> Result<(StatusCode, Json<BTreeMap<u32, f64>>), Response> {
    abort_current_test(Arc::clone(&state)).await;
    info!("Starting latency test for all frame sizes");

    let mut latency_results = BTreeMap::new();

    for &frame_size in FRAME_SIZES.iter() {
        let frame_rate = {
            let test_results = state.multi_test_state.rfc_results.lock().await;
            test_results.throughput.as_ref().and_then(|throughput_map| throughput_map.get(&frame_size).cloned())
        };

        let mut adjusted_payload = payload.clone();
        adjusted_payload.streams[0].burst = RATE_PRECISION;

        if let Some(rate) = frame_rate {
            adjusted_payload.streams[0].traffic_rate = rate * frame_size as f32 * 8.0 / 1e9;
        } else {
            adjusted_payload.streams[0].traffic_rate = payload.streams[0].traffic_rate;
        }

        adjusted_payload.streams[0].frame_size = frame_size;

        save_tg(Arc::clone(&state), adjusted_payload.clone(), format!("Latency - {} Bytes", frame_size)).await;

        let mut abort_rx = create_and_store_abort_sender(Arc::clone(&state)).await;
        let mut rtt_values_for_frame_size = Vec::new();

        for i in 0..10 { 
            match start_traffic_gen_with_duration(Arc::clone(&state), adjusted_payload.clone(), i, Some(10.0), &mut abort_rx).await {
                Ok(_) => {
                    info!("Successfully completed traffic generation {}", i + 1);
                    
                    // RTT-Value from rtt_storage 
                    let rtt_storage = state.rate_monitor.lock().await.rtt_storage.clone();
                    for (_, rtts) in rtt_storage.iter() {
                        rtt_values_for_frame_size.extend(rtts.iter().copied());
                    }
                },
                Err(err) => {
                    error!("Error in traffic generation {}: {}", i + 1, err);
                    return Err((StatusCode::INTERNAL_SERVER_ERROR, Json(Error::new(format!("Error in traffic generation {}: {}", i + 1, err)))).into_response());
                }
            }
        }

        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;

        if let Err(err) = save_statistics(Arc::clone(&state), 2).await {
            error!("Failed to save the statistics of the latency test for {} Bytes: {}", frame_size, err);
            return Err((StatusCode::INTERNAL_SERVER_ERROR, Json(Error::new(format!("Failed to save the statistics of the latency test for {} Bytes: {}", frame_size, err)))).into_response());
        }


        if !rtt_values_for_frame_size.is_empty() {
            let overall_mean_ns = calculate_mean(&rtt_values_for_frame_size);
            let overall_mean_us = overall_mean_ns / 1000.0;
            let one_way_latency = overall_mean_us / 2.0;
            latency_results.insert(frame_size, one_way_latency);
            info!("Overall Mean RTT for {} Bytes: {:.4} µs", frame_size, overall_mean_us);
        } else {
            warn!("No RTT values collected for frame size {}. Skipping.", frame_size);
            latency_results.insert(frame_size, f64::NAN);
        }
        
        let mut test_result = state.multi_test_state.rfc_results.lock().await;
        test_result.latency = Some(latency_results.clone());
    }

    let result = (StatusCode::OK, Json(latency_results));
    Ok(result)
}





// Frame loss rate test defined in RFC 2544 section 25.3
pub async fn frame_loss_rate_test(State(state): State<Arc<AppState>>, Json(payload): Json<TrafficGenData>) -> Result<(StatusCode, Json<BTreeMap<u32, BTreeMap<u32, f64>>>), Response> {
    abort_current_test(Arc::clone(&state)).await;
    info!("Starting frame loss rate test with multiple frame sizes and rates");

    let mut abort_rx = create_and_store_abort_sender(Arc::clone(&state)).await;
    let mut results = BTreeMap::new();

    let ports = state.pm.get_ports(&state.switch).await.map_err(|err| {
        error!("Failed to get ports: {:?}", err);
        (StatusCode::INTERNAL_SERVER_ERROR, Json(Error::new(format!("Failed to get ports: {:?}", err)))).into_response()
    })?;

    // Determine the maximum speed from the sending ports
    let max_speed = ports.iter().map(|port| match port.get_speed() {
        Speed::BF_SPEED_1G => 1.0,
        Speed::BF_SPEED_10G => 10.0,
        Speed::BF_SPEED_20G => 20.0,
        Speed::BF_SPEED_25G => 25.0,
        Speed::BF_SPEED_40G => 40.0,
        Speed::BF_SPEED_50G => 50.0,
        Speed::BF_SPEED_100G => 100.0,
        Speed::BF_SPEED_400G => 400.0,
    }).max_by(|a, b| a.partial_cmp(b).unwrap()).unwrap_or(1.0);

    for &frame_size in &FRAME_SIZES {
        let mut test_payload = payload.clone();
        test_payload.streams[0].burst = RATE_PRECISION;
        test_payload.streams[0].traffic_rate = max_speed;
        test_payload.streams[0].frame_size = frame_size;

        save_tg(Arc::clone(&state), test_payload.clone(), format!("Frame Loss Rate - {} Bytes", frame_size)).await;

        let mut frame_results = BTreeMap::new();
        let mut consecutive_zero_loss_tests = 0;

        for i in 0..10 {
            let reduction_factor = 100 - 10 * i as u32;
            let test_rate = max_speed * (reduction_factor as f32 / 100.0);

            test_payload.streams[0].traffic_rate = test_rate;

            match start_traffic_gen_with_duration(Arc::clone(&state), test_payload.clone(), i, Some(10.0), &mut abort_rx).await {
                Ok(_) => {
                    info!("Successfully completed traffic generation {} for frame size {}", i + 1, frame_size);

                    let stats_response = statistics(State(Arc::clone(&state))).await;
                    if let Ok(stats) = parse_response::<Statistics>(stats_response).await {
                        let total_packets_sent: u64 = stats.frame_size.values()
                            .flat_map(|f| f.tx.iter())
                            .map(|v| v.packets as u64)
                            .sum();

                        let packet_loss: u64 = stats.packet_loss.values().sum();

                        let mut packet_loss_percent = if total_packets_sent > 0 {
                            round_to_three_places((packet_loss as f64 / total_packets_sent as f64) * 100.0)
                        } else {
                            0.0
                        };

                        if packet_loss_percent > 100.0 {
                            packet_loss_percent = 100.0;
                        }

                        info!("Total packets sent: {}", total_packets_sent);
                        info!("Packet loss: {} packets", packet_loss);
                        info!("Packet loss percentage: {:.2}%", packet_loss_percent);

                        frame_results.insert(reduction_factor, packet_loss_percent);

                        if packet_loss_percent == 0.0 {
                            consecutive_zero_loss_tests += 1;
                            if consecutive_zero_loss_tests == 2 {
                                info!("Two consecutive tests with 0% frame loss detected for frame size {}. Aborting further tests for this size.", frame_size);
                                break;
                            }
                        } else {
                            consecutive_zero_loss_tests = 0;
                        }
                    } else {
                        error!("Failed to retrieve statistics for test {}", i + 1);
                    }
                },
                Err(err) => {
                    error!("Error in traffic generation {}: {}", i + 1, err);
                    return Err((StatusCode::INTERNAL_SERVER_ERROR, Json(Error::new(format!("Error in traffic generation {}: {}", i + 1, err)))).into_response());
                }
            }
        }

        results.insert(frame_size, frame_results);

        // Update frame_loss_rate_map and save results after each frame size test
        let mut test_result = state.multi_test_state.rfc_results.lock().await;
        test_result.frame_loss_rate = Some(results.clone());

        // Save statistics after each frame size test
        if let Err(err) = save_statistics(Arc::clone(&state), 3).await {
            error!("Failed to save the statistics after testing frame size {}: {}", frame_size, err);
            return Err((StatusCode::INTERNAL_SERVER_ERROR, Json(Error::new(format!("Failed to save the statistics after testing frame size {}: {}", frame_size, err)))).into_response());
        }
    }

    Ok((StatusCode::OK, Json(results)))
}





// Reset test definend in RFC 2544 section 25.6
pub async fn reset_test(State(state): State<Arc<AppState>>, Json(payload): Json<TrafficGenData>) -> Result<(StatusCode, Json<f64>), Response> {
    info!("Starting reset test for the minimum frame size (64 Bytes)");

    let duration = Duration::from_secs(120);
    let interval = Duration::from_millis(100); 

    let frame_size = 64;
    let mut result = 0.0; // Default value 

    let mut results = BTreeMap::new();

    set_name_flag(&state, format!("Reset - {} Bytes", frame_size)).await;


    let frame_rate = {
            let test_results = state.multi_test_state.rfc_results.lock().await;
            test_results.throughput.as_ref().and_then(|throughput_map| throughput_map.get(&frame_size).cloned()).unwrap_or(payload.streams[0].traffic_rate * 1e9 / (frame_size as f32 * 8.0))
        };


    let mut adjusted_payload = payload.clone();
    adjusted_payload.streams[0].traffic_rate = frame_rate * frame_size as f32 * 8.0 / 1e9;
    adjusted_payload.streams[0].frame_size = frame_size;
    adjusted_payload.streams[0].burst = IAT_PRECISION;

    save_tg(Arc::clone(&state), adjusted_payload.clone(), format!("Reset - {} Bytes", frame_size)).await;

    let state_clone = Arc::clone(&state);
    let abort_rx = create_and_store_abort_sender(state_clone.clone()).await;

    // Abort Receiver for both tasks
    let mut tg_abort_rx = abort_rx.clone();
    let mut monitor_abort_rx = abort_rx.clone();
    
    // Traffic gen task
    let tg_task = tokio::spawn(async move {
        start_traffic_gen_with_duration(
            state_clone,
            adjusted_payload,
            0,
            Some(duration.as_secs_f64()),
            &mut tg_abort_rx
        ).await
    });

    // Monitoring task
    let state_clone = Arc::clone(&state);
    let monitor_task = tokio::spawn(async move {
        monitor_packet_loss(&state_clone, duration, interval, &mut monitor_abort_rx).await
    });

    let (tg_result, monitor_result) = tokio::join!(tg_task, monitor_task);

    // Check results of traffic generation
    match tg_result {
        Ok(Ok(())) => info!("Traffic generation completed successfully"),
        Ok(Err(err)) => {
            error!("Error starting traffic generator: {}", err);
            return Err((StatusCode::INTERNAL_SERVER_ERROR, Json(Error::new(format!("Error starting traffic generator: {}", err)))).into_response());
        },
        Err(err) => {
            error!("Traffic generation task panicked: {:?}", err);
            return Err((StatusCode::INTERNAL_SERVER_ERROR, Json(Error::new("Traffic generation task panicked".to_string()))).into_response());
        }
    }

    // Check results of monitoring
    match monitor_result {
        Ok(Ok((duration_a, duration_b))) => {
            if duration_a.is_none() {
                info!("No significant packet loss detected within 120 seconds for frame size {}.", frame_size);
            } else {
                let duration_a = duration_a.unwrap();
                info!("Duration A for frame size {}: {:?}", frame_size, duration_a);

                if duration_b.is_none() {
                    info!("No packet loss recovery detected for frame size {}.", frame_size);
                } else {
                    let duration_b = duration_b.unwrap();
                    info!("Duration B for frame size {}: {:?}", frame_size, duration_b);

                    // Recovery interval
                    let recovery_time = duration_b - duration_a;
                    let recovery_time_secs = recovery_time.as_secs_f64();
                    info!("Recovery time after reset for frame size {}: {:.3} seconds", frame_size, recovery_time_secs);

                    result = recovery_time_secs;
                }
            }
        },
        Ok(Err(err)) => {
            error!("Error in packet loss monitoring for frame size {}: {:?}", frame_size, err);
            return Err((StatusCode::INTERNAL_SERVER_ERROR, Json(Error::new("Error in packet loss monitoring".to_string()))).into_response());
        },
        Err(err) => {
            error!("Packet loss monitoring task panicked for frame size {}: {:?}", frame_size, err);
            return Err((StatusCode::INTERNAL_SERVER_ERROR, Json(Error::new("Packet loss monitoring task panicked".to_string()))).into_response());
        }
    }

    // Save statistics after the test
    if let Err(err) = save_statistics(Arc::clone(&state), 5).await {
        error!("Failed to save the statistics of the reset test for frame size {}: {}", frame_size, err);
        return Err((StatusCode::INTERNAL_SERVER_ERROR, Json(Error::new(format!("Failed to save the statistics of the reset test for frame size {}: {}", frame_size, err)))).into_response());
    }

    results.insert(frame_size, result);

    let mut test_result = state.multi_test_state.rfc_results.lock().await;
    test_result.reset = Some(results);

    Ok((StatusCode::OK, Json(result)))
}

// monitors if packets are received within monitoring_duration
// returns time point A and B if no packets are received for a certain time
async fn monitor_packet_loss(
    state: &Arc<AppState>,
    monitoring_duration: Duration,
    interval: Duration,
    abort_rx: &mut tokio::sync::watch::Receiver<()>
) -> Result<(Option<Instant>, Option<Instant>), Response> {
    
    let mut previous_packets_received = wait_for_first_packet(state, interval, abort_rx).await;

    if previous_packets_received == 0 {
        info!("Monitoring aborted during wait for first packet.");
        return Ok((None, None));
    }
    
    let start_time = Instant::now();
    let mut time_point_a: Option<Instant> = None;
    let mut time_point_b: Option<Instant>;
    let mut longest_time_point_a: Option<Instant> = None;
    let mut longest_time_point_b: Option<Instant> = None;
    let mut max_duration_a_to_b: Option<Duration> = None;

    while Instant::now().duration_since(start_time) < monitoring_duration {
        tokio::select! {
            _ = sleep(interval) => {},
            _ = abort_rx.changed() => {
                info!("Abort signal received, stopping monitoring.");
                return Ok((None, None));
            }
        }

        info!("{:?} - {:?}", Instant::now().duration_since(start_time), monitoring_duration);
        

        let total_packets_received = get_total_received_packets(state).await;

            
        if total_packets_received.abs_diff(previous_packets_received) == 0 {
            info!("NO PACKETS RECEIVED!!!!!!!!!!!!");
        }
        info!("Differenz {}", total_packets_received.abs_diff(previous_packets_received));


        if total_packets_received == previous_packets_received && time_point_a.is_none() {
            // Time point A if no new packets are received
            time_point_a = Some(Instant::now());
            info!("Time Point A recorded: {:?}", time_point_a);
        } else if total_packets_received > previous_packets_received && time_point_a.is_some() {
            // Time point B if packets are received after A
            time_point_b = Some(Instant::now());
            info!("Time Point B recorded: {:?}", time_point_b);

            // Calculate the time span between A and B
            if let Some(a) = time_point_a {
                let duration = time_point_b.unwrap().duration_since(a);

                info!("Duration between A and B: {:?}", duration);

                // Check if this is the longest observed duration
                if max_duration_a_to_b.is_none() || max_duration_a_to_b.unwrap() < duration {
                    max_duration_a_to_b = Some(duration);
                    longest_time_point_a = time_point_a;
                    longest_time_point_b = time_point_b;
                    info!("New maximum duration between A and B: {:?}", max_duration_a_to_b);
                }
            }

            time_point_a = None;
        } 

        previous_packets_received = total_packets_received;
    }

    Ok((longest_time_point_a, longest_time_point_b))
}



// Waits for the first packet to be received
async fn wait_for_first_packet(
    state: &Arc<AppState>,
    interval: Duration,
    abort_rx: &mut tokio::sync::watch::Receiver<()>
) -> u64 {
    // Wait until the experiment is running
    loop {
        tokio::select! {
            _ = tokio::time::sleep(interval) => {
                let running = state.experiment.lock().await.running;
                if running {
                    break;
                }
                info!("Experiment not running yet, waiting...");
            }
            _ = abort_rx.changed() => {
                info!("Abort signal received, stopping wait for first packet.");
                return 0; // You can return a default value or handle it differently
            }
        }
    }

    // Wait until the first frame is received
    loop {
        tokio::select! {
            _ = tokio::time::sleep(interval) => {
                let total_packets_received = get_total_received_packets(state).await;
                if total_packets_received > 0 {
                    info!("First packet received: {}", total_packets_received);
                    return total_packets_received;
                }
                info!("No packets yet, waiting...");
            }
            _ = abort_rx.changed() => {
                info!("Abort signal received, stopping wait for first packet.");
                return 0; // Again, handle this however you see fit
            }
        }
    }
}





pub async fn handle_test_result<T: std::fmt::Debug>(result: Result<(StatusCode, Json<T>), Response>, test_name: &str) -> Result<(), ()> {
    match result {
        Ok((status, Json(result))) if status == StatusCode::OK => {
            info!("{} test completed successfully: {:?}", test_name, result);
            Ok(())
        },
        Ok((status, _)) => {
            error!("{} test failed: {}", test_name, status);
            Err(())
        },
        Err(err) => {
            error!("{} test failed: {:?}", test_name, err);
            Err(())
        }
    }
}

// Reset the results of the RFC tests
pub async fn reset_results(state: Arc<AppState>) {
    let mut res = state.multi_test_state.rfc_results.lock().await;
    *res = TestResult {
        throughput: None,
        latency: None,
        frame_loss_rate: None,
        reset: None,
        running: false,
        current_test: None,
    };
}

pub async fn set_running_flag(state: &Arc<AppState>, running: bool) {
    let mut test_results = state.multi_test_state.rfc_results.lock().await;
    test_results.running = running;
}

pub async fn set_name_flag(state: &Arc<AppState>, name: String) {
    let mut test_results = state.multi_test_state.rfc_results.lock().await;
    test_results.current_test = Some(name);
}

async fn save_tg(state_clone: Arc<AppState>, payload: TrafficGenData, name: String) {
    let mut multiple_traffic_generators = state_clone.multi_test_state.multiple_traffic_generators.lock().await;
    let mut named_payload = payload.clone();
    named_payload.name = Some(name);
    multiple_traffic_generators.push(named_payload);
}

pub async fn reset_collected_statistics(state_clone: Arc<AppState>) {
    let mut collected_statistics = state_clone.multi_test_state.collected_statistics.lock().await;
    collected_statistics.clear();

    let mut collected_time_statistics = state_clone.multi_test_state.collected_time_statistics.lock().await; 
    collected_time_statistics.clear();

    let mut multiple_traffic_generators = state_clone.multi_test_state.multiple_traffic_generators.lock().await;
    multiple_traffic_generators.clear(); 
}


fn round_to_three_places(value: f64) -> f64 {
    (value * 1000.0).round() / 1000.0
}

fn calculate_mean(values: &[u64]) -> f64 {
    let sum: u64 = values.iter().sum();
    sum as f64 / values.len() as f64
}


async fn get_total_received_packets(state: &Arc<AppState>) -> u64 {
    const FRAME_SIZE_MONITOR: &str = "egress.frame_size_monitor";

    let request = table::Request::new(FRAME_SIZE_MONITOR);
    let sync = table::Request::new(FRAME_SIZE_MONITOR).operation(table::TableOperation::SyncCounters);


    let entries = {
        let switch = &state.switch;
        if switch.execute_operation(sync).await.is_err() {
            warn! {"Encountered error while synchronizing {}.", FRAME_SIZE_MONITOR};
        }
        switch.get_table_entry(request).await.unwrap_or_else(|err| {
            warn! {"Error while retrieving {} table. Error: {}", FRAME_SIZE_MONITOR, format!("{:#?}", err)};
            vec![]
        })
    };

    let mut total_packets_received: u64 = 0;
    let rx_mapping = state.port_mapping.iter().map(|(_, mapping)| (mapping.rx_recirculation, mapping)).collect::<HashMap<_, _>>();

    for entry in entries {
        if let Some(egress_port) = entry.match_key.get("eg_intr_md.egress_port") {
            let port_val = egress_port.get_exact_value().to_u32();

            if rx_mapping.contains_key(&port_val) {
                if let MatchValue::RangeValue { lower_bytes: _, higher_bytes: _ } = entry.match_key.get("pkt_len").unwrap() {
                    let count = entry.action_data.iter()
                        .find(|action| action.get_name() == "$COUNTER_SPEC_PKTS")
                        .map(|action| action.get_data().to_u128())
                        .unwrap_or(0);
                    total_packets_received += count as u64;
                }
            }
        }
    }

    total_packets_received
}

