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
 * Fabian Ihle (fabian.ihle@uni-tuebingen.de)
 */

use std::time::Duration;

use crate::{
    api::statistics::{get_statistics, get_time_statistics, Params},
    AppState,
};
use log::{error, info};
use std::sync::Arc;
use tokio::{task::JoinHandle, time::Instant};
use tokio_util::sync::CancellationToken;

use super::traffic_gen_core::types::TrafficGenData;
use crate::api::traffic_gen::start_single_test;
use crate::core::rfc2544;

pub struct DurationMonitorTask {
    pub handle: Option<JoinHandle<()>>,
    pub cancel_token: Option<CancellationToken>,
}

impl DurationMonitorTask {
    /// Monitors the duration of a test and regularly checks if the test has been aborted or if a cancellation token was sent. Stops traffic generation after duration exceeded.
    ///
    /// - `state`: App state that holds DurationMonitor
    /// - `duration_secs`: Duration to wait in seconds
    /// - `cancel_token`: The CancellationToken for this task
    async fn monitor_test_duration(
        state: Arc<AppState>,
        duration_secs: u32,
        cancel_token: CancellationToken,
    ) {
        let deadline = Instant::now() + Duration::from_secs_f64(duration_secs as f64);
        let mut interval = tokio::time::interval(Duration::from_millis(100));

        loop {
            tokio::select! {
                _ = interval.tick() => {
                    let running = {
                        let experiment = state.experiment.lock().await;
                        experiment.running
                    };

                    if !running {
                        info!("Traffic generation stopped.");
                        break;
                    }

                    if Instant::now() >= deadline {
                        info!("Duration elapsed. Stopping traffic generation...");
                        break;
                    }
                }
                _ = cancel_token.cancelled() => {
                    info!("Monitor task received cancellation request. Exiting...");
                    break;
                }
            }
        }

        let running = {
            let experiment = state.experiment.lock().await;
            experiment.running
        };

        if running {
            // Perform the shutdown
            let tg = &state.traffic_generator;
            let switch = &state.switch;

            match tg.lock().await.stop(switch).await {
                Ok(_) => {
                    info!("Traffic generation stopped after duration.");
                    state.experiment.lock().await.running = false;
                }
                Err(e) => {
                    error!("Error while stopping traffic generation: {e}");
                }
            }
        }
    }

    /// Starts a duration monitor task that waits for duration and stops traffic generation after duration has exceeded
    ///
    /// - `state`: App state that holds DurationMonitor
    /// - `duration_secs`: Duration to wait in seconds
    pub async fn start(&mut self, state: &Arc<AppState>, duration_secs: u32) {
        let state_clone = state.clone();
        let cancel_token = CancellationToken::new();
        let cancel_token_clone = cancel_token.clone();

        let handle = tokio::spawn(async move {
            Self::monitor_test_duration(state_clone, duration_secs, cancel_token_clone).await
        });

        self.handle = Some(handle);
        self.cancel_token = Some(cancel_token);
    }

    /// Starts a monitor task that starts a single task and waits until the monitor_test_duraton task exits.
    ///
    /// - `state`: App state that holds DurationMonitor
    /// - `payload`: List of TrafficGenData objects, each describing a traffic gen event
    pub async fn start_multiple_tests(
        &mut self,
        state: &Arc<AppState>,
        payloads: Vec<TrafficGenData>,
    ) {
        let cancel_token: CancellationToken = CancellationToken::new();
        let cancel_token_clone = cancel_token.clone();
        let state_clone: Arc<AppState> = state.clone();

        let handle = tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(100));
            let num_tests = payloads.len();

            #[allow(clippy::never_loop)]
            'outer: for (idx, traffic_gen_data) in payloads.iter().enumerate() {
                // Start the test
                let idx = idx + 1;

                let _ = start_single_test(&state_clone, traffic_gen_data.clone()).await;

                loop {
                    tokio::select! {
                        _ = interval.tick() => {
                            let running = {
                                let experiment = state_clone.experiment.lock().await;
                                experiment.running
                            };

                            if !running {
                                // This condition is true if the other DurationMonitor stops the traffic generation, i.e. time has elapsed
                                info!("Test {idx} of {num_tests} done.");
                                break;
                            }
                        }
                        _ = cancel_token.cancelled() => {
                            // Cancel both loops when stopping. This cancels all experiments
                            info!("Monitor task received cancellation request. Exiting...");
                            break 'outer;
                        }
                    }
                }

                if idx != payloads.len() {
                    // Do not copy the last test to history, otherwise it is duplicate
                    Self::copy_stats_to_history(&state_clone).await;
                }

                // Wait 2s between tests
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            }
        });

        self.handle = Some(handle);
        self.cancel_token = Some(cancel_token_clone);
    }

    pub async fn start_rfc2544(&mut self, state: &Arc<AppState>, payload: TrafficGenData) {
        let cancel_token: CancellationToken = CancellationToken::new();
        let cancel_token_clone = cancel_token.clone();
        let state_clone: Arc<AppState> = state.clone();

        let handle = tokio::spawn(async move {
            rfc2544::run(state_clone, payload, cancel_token_clone).await;
        });

        self.handle = Some(handle);
        self.cancel_token = Some(cancel_token);
    }

    pub async fn copy_stats_to_history(state: &Arc<AppState>) {
        // Move stats into state where it is then moved into the history by the API later
        // Index 0 holds the current test; a panic here would silently kill the
        // multi-test task, so bail out loudly instead if the invariant breaks.
        let Some(stats) = get_statistics(state).await.into_iter().next() else {
            error!("No current statistics available; test not copied to history.");
            return;
        };
        let mut stats_lock = state.multiple_tests.collected_statistics.lock().await;
        stats_lock.push(stats);
        let Some(time_stats) = get_time_statistics(state, Params { limit: None })
            .await
            .into_iter()
            .next()
        else {
            error!("No current time statistics available; test not copied to history.");
            return;
        };
        let mut time_stats_lock = state.multiple_tests.collected_time_statistics.lock().await;
        time_stats_lock.push(time_stats);
    }

    /// Check if a duration monitor task is running and cancels it using its CancellationToken
    pub async fn cancel_existing_monitoring_task(&mut self) {
        if let Some(token) = self.cancel_token.take() {
            token.cancel();
            info!("Monitoring task cancelled.")
        }

        if let Some(handle) = self.handle.take() {
            if let Err(e) = handle.await {
                error!("Monitor task join error: {e}");
            }
        }
    }
}
