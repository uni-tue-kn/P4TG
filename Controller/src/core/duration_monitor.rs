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

use super::traffic_gen::stop_traffic_generation_locked;
use super::traffic_gen_core::types::TrafficGenData;
use crate::api::traffic_gen::start_single_test;
use crate::core::rfc2544;

const TEST_COOLDOWN: Duration = Duration::from_secs(3);

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
                biased;

                _ = cancel_token.cancelled() => {
                    info!("Monitor task received cancellation request. Exiting...");
                    // The caller that cancels a duration monitor owns the
                    // replacement/stop operation. Returning here avoids a
                    // second hardware stop racing with that operation. The
                    // caller also owns the drain that follows the explicit
                    // stop.
                    return;
                }
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
            }
        }

        let running = {
            let experiment = state.experiment.lock().await;
            experiment.running
        };

        if running {
            // Perform the shutdown
            let _lifecycle = state.traffic_lifecycle.lock().await;
            let stop_result = stop_traffic_generation_locked(&state).await;

            match stop_result {
                Ok(_) => info!("Traffic generation stopped after duration."),
                Err(e) => {
                    error!("Error while stopping traffic generation: {e}");
                }
            }

            // Never leave the orchestration waiting forever if hardware
            // shutdown fails. A subsequent run will retry stop as part of
            // start_traffic_generation and abort the sequence if that fails.
            state.experiment.lock().await.running = false;
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
            let num_runs: u64 = payloads
                .iter()
                .map(|payload| u64::from(payload.repetitions))
                .sum();
            let mut run_idx = 0_u64;

            'outer: for traffic_gen_data in &payloads {
                for repetition_idx in 0..traffic_gen_data.repetitions {
                    if cancel_token.is_cancelled() {
                        info!("Monitor task received cancellation request. Exiting...");
                        break 'outer;
                    }

                    run_idx += 1;
                    let mut run_data = traffic_gen_data.clone();
                    if traffic_gen_data.repetitions > 1 {
                        let base_name = run_data.name.as_deref().unwrap_or("Test");
                        run_data.name = Some(format!(
                            "{base_name} [{}/{}]",
                            repetition_idx + 1,
                            traffic_gen_data.repetitions
                        ));
                    }
                    if let Err(err) = start_single_test(&state_clone, run_data).await {
                        error!("Failed to start test run {run_idx} of {num_runs}: {err}");
                        state_clone.experiment.lock().await.running = false;
                        break 'outer;
                    }

                    loop {
                        tokio::select! {
                            _ = interval.tick() => {
                                let running = {
                                    let experiment = state_clone.experiment.lock().await;
                                    experiment.running
                                };

                                if !running {
                                    // This condition is true if the other DurationMonitor stops the traffic generation, i.e. time has elapsed
                                    info!("Test run {run_idx} of {num_runs} done.");
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

                    if run_idx != num_runs {
                        // Do not copy the last test to history, otherwise it is duplicate
                        Self::copy_stats_to_history(&state_clone).await;

                        // Draining has completed at this point. Keep a separate
                        // idle phase so digest processing and controller-side
                        // snapshots settle before the next run resets counters.
                        tokio::select! {
                            _ = tokio::time::sleep(TEST_COOLDOWN) => {}
                            _ = cancel_token.cancelled() => {
                                info!("Monitor task cancelled during test cooldown.");
                                break 'outer;
                            }
                        }
                    }
                }
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
        let Some(time_stats) = get_time_statistics(state, Params { limit: None })
            .await
            .into_iter()
            .next()
        else {
            error!("No current time statistics available; test not copied to history.");
            return;
        };

        // Do not retain either history mutex across an await or while acquiring
        // the other history mutex. This keeps history writes out of lock-order
        // dependencies with API reads and resets.
        state
            .multiple_tests
            .collected_statistics
            .lock()
            .await
            .push(stats);
        state
            .multiple_tests
            .collected_time_statistics
            .lock()
            .await
            .push(time_stats);
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
