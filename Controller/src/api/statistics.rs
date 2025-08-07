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

use crate::core::statistics::{
    IATStatistics, IATValues, RTTStatistics, Statistics, TimeStatistics,
};
use crate::core::traffic_gen_core::helper::{
    generate_dev_port_to_front_panel_mappings, translate_port_numbers,
};
use crate::AppState;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json, Response};
use serde::Deserialize;
use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use std::time::Duration;

use crate::api::{docs, helper};

#[utoipa::path(
    get,
    path = "/api/statistics",
    responses(
        (status = 200,
        description = "Returns the statistics.",
        body = Vec<Statistics>,
        example = json!(*docs::statistics::EXAMPLE_GET_1)
        ))
)]
/// Returns the current statistics such as traffic rates, frame types, etc.
pub async fn statistics(State(state): State<Arc<AppState>>) -> Response {
    let stats = get_statistics(&state).await;

    (StatusCode::OK, Json(stats)).into_response()
}

pub async fn get_statistics(state: &Arc<AppState>) -> Vec<Statistics> {
    let frame_size_monitor = &state.frame_size_monitor;
    let frame_type_monitor = &state.frame_type_monitor;
    let rate_monitor = &state.rate_monitor;
    let rtt_histogram_monitor = &state.rtt_histogram_monitor;

    let mut stats = Statistics {
        sample_mode: state.sample_mode,
        frame_size: Default::default(),
        frame_type_data: Default::default(),
        tx_rate_l1: Default::default(),
        tx_rate_l2: Default::default(),
        rx_rate_l1: Default::default(),
        rx_rate_l2: Default::default(),
        app_tx_l2: Default::default(),
        app_rx_l2: Default::default(),
        iats: Default::default(),
        rtts: Default::default(),
        packet_loss: Default::default(),
        out_of_order: Default::default(),
        elapsed_time: 0,
        rtt_histogram: Default::default(),
        name: None,
    };

    {
        stats.frame_size = frame_size_monitor
            .lock()
            .await
            .statistics
            .frame_size
            .clone();
        stats.frame_type_data = frame_type_monitor
            .lock()
            .await
            .statistics
            .frame_type_data
            .clone();
        stats.rtt_histogram = rtt_histogram_monitor.lock().await.histogram.clone();
        stats.name = state.traffic_generator.lock().await.name.clone();
    }

    let monitor_statistics = rate_monitor.lock().await.statistics.clone();

    let rtts = rate_monitor.lock().await.rtt_storage.clone();

    let mut rtt_stats = HashMap::new();

    for (port, rtt_samples) in &rtts {
        let mean = helper::simple_stats::average(rtt_samples);
        let std = helper::simple_stats::std(rtt_samples);

        let stats = RTTStatistics {
            mean,
            min: *rtt_samples.iter().min().unwrap_or(&0) as u32,
            max: *rtt_samples.iter().max().unwrap_or(&0) as u32,
            current: *rtt_samples.iter().last().unwrap_or(&0) as u32,
            jitter: std,
            n: rtt_samples.len() as u32,
        };

        rtt_stats.insert(*port, stats);
    }

    if state.sample_mode {
        let mut iats = HashMap::new();
        let tx_stats = &mut state.rate_monitor.lock().await.tx_iat_storage.clone();
        let rx_stats = &mut state.rate_monitor.lock().await.rx_iat_storage.clone();

        for port in state.port_mapping.keys() {
            let tx_iats = tx_stats.entry(*port).or_default();
            let rx_iats = rx_stats.entry(*port).or_default();

            let iat_stats = IATStatistics {
                tx: IATValues {
                    mean: helper::simple_stats::average(tx_iats) as f32,
                    std: Some(helper::simple_stats::std(tx_iats) as f32),
                    mae: 0.0,
                    n: tx_iats.len() as u32,
                },
                rx: IATValues {
                    mean: helper::simple_stats::average(rx_iats) as f32,
                    std: Some(helper::simple_stats::std(rx_iats) as f32),
                    mae: 0.0,
                    n: rx_iats.len() as u32,
                },
            };

            iats.insert(*port, iat_stats);
        }

        stats.iats = iats;
    } else {
        stats.iats = monitor_statistics.iats.clone();
    }

    stats.rtts = rtt_stats;
    stats.tx_rate_l1 = monitor_statistics.tx_rate_l1.clone();
    stats.rx_rate_l1 = monitor_statistics.rx_rate_l1.clone();
    stats.tx_rate_l2 = monitor_statistics.tx_rate_l2.clone();
    stats.rx_rate_l2 = monitor_statistics.rx_rate_l2.clone();
    stats.app_tx_l2 = monitor_statistics.app_tx_l2.clone();
    stats.app_rx_l2 = monitor_statistics.app_rx_l2.clone();
    stats.packet_loss = monitor_statistics.packet_loss.clone();
    stats.out_of_order = monitor_statistics.out_of_order.clone();
    stats.elapsed_time = {
        let experiment = state.experiment.lock().await;
        if experiment.running {
            experiment
                .start
                .elapsed()
                .unwrap_or(Duration::from_secs(0))
                .as_secs() as u32
        } else {
            0
        }
    };

    let dev_port_to_front_panel_port_mappings =
        generate_dev_port_to_front_panel_mappings(&state.port_mapping);

    // Translate the internal dev port mappings to front_panel_ports
    let stats = Statistics {
        sample_mode: state.sample_mode,
        frame_size: translate_port_numbers(
            &stats.frame_size,
            &dev_port_to_front_panel_port_mappings,
        ),
        frame_type_data: translate_port_numbers(
            &stats.frame_type_data,
            &dev_port_to_front_panel_port_mappings,
        ),
        tx_rate_l1: translate_port_numbers(
            &stats.tx_rate_l1,
            &dev_port_to_front_panel_port_mappings,
        ),
        tx_rate_l2: translate_port_numbers(
            &stats.tx_rate_l2,
            &dev_port_to_front_panel_port_mappings,
        ),
        rx_rate_l1: translate_port_numbers(
            &stats.rx_rate_l1,
            &dev_port_to_front_panel_port_mappings,
        ),
        rx_rate_l2: translate_port_numbers(
            &stats.rx_rate_l2,
            &dev_port_to_front_panel_port_mappings,
        ),
        app_tx_l2: translate_port_numbers(&stats.app_tx_l2, &dev_port_to_front_panel_port_mappings),
        app_rx_l2: translate_port_numbers(&stats.app_rx_l2, &dev_port_to_front_panel_port_mappings),
        iats: translate_port_numbers(&stats.iats, &dev_port_to_front_panel_port_mappings),
        rtts: translate_port_numbers(&stats.rtts, &dev_port_to_front_panel_port_mappings),
        packet_loss: translate_port_numbers(
            &stats.packet_loss,
            &dev_port_to_front_panel_port_mappings,
        ),
        out_of_order: translate_port_numbers(
            &stats.out_of_order,
            &dev_port_to_front_panel_port_mappings,
        ),
        elapsed_time: stats.elapsed_time,
        rtt_histogram: translate_port_numbers(
            &stats.rtt_histogram,
            &dev_port_to_front_panel_port_mappings,
        ),
        name: stats.name.clone(),
    };

    let mut all_stats = vec![stats];
    let previous_stats = state
        .multiple_tests
        .collected_statistics
        .lock()
        .await
        .clone();
    all_stats.extend(previous_stats);

    all_stats
}

#[derive(Debug, Deserialize)]
pub struct Params {
    pub limit: Option<usize>,
}

#[utoipa::path(
    get,
    path = "/api/time_statistics",
    params(
        ("limit" = Option<usize>, Query, description = "Only retrieve the last *limit* entries")
    ),
    responses(
        (status = 200,
        description = "Returns the statistics over time.",
        body = Vec<TimeStatistics>,
        example = json!(*docs::statistics::EXAMPLE_GET_2)
        ))
)]
/// Returns the current statistics over time with one data point per second.
pub async fn time_statistics(
    State(state): State<Arc<AppState>>,
    Query(params): Query<Params>,
) -> Response {
    let stats = get_time_statistics(&state, params).await;
    (StatusCode::OK, Json(stats)).into_response()
}

pub async fn get_time_statistics(state: &Arc<AppState>, params: Params) -> Vec<TimeStatistics> {
    let rate_monitor = &state.rate_monitor;
    let stats = rate_monitor.lock().await.time_statistics.clone();

    let limit = params.limit.unwrap_or(usize::MAX);

    // we typically have as many elements as elapsed seconds
    let elements = state
        .experiment
        .lock()
        .await
        .start
        .elapsed()
        .unwrap_or(Duration::from_secs(0))
        .as_secs() as usize;

    let step = {
        if limit < elements {
            elements / limit
        } else {
            1
        }
    };

    // get every ratio-nth element
    let tx: HashMap<u32, BTreeMap<u32, f64>> = stats
        .tx_rate_l1
        .clone()
        .into_iter()
        .map(|v| {
            (
                v.0,
                v.1.into_iter()
                    .filter(|elem| elem.0 % (step as u32) == 0)
                    .collect(),
            )
        })
        .collect();

    let rx: HashMap<u32, BTreeMap<u32, f64>> = stats
        .rx_rate_l1
        .clone()
        .into_iter()
        .map(|v| {
            (
                v.0,
                v.1.into_iter()
                    .filter(|elem| elem.0 % (step as u32) == 0)
                    .collect(),
            )
        })
        .collect();

    let packet_loss: HashMap<u32, BTreeMap<u32, u64>> = stats
        .packet_loss
        .clone()
        .into_iter()
        .map(|v| {
            (
                v.0,
                v.1.into_iter()
                    .filter(|elem| elem.0 % (step as u32) == 0)
                    .collect(),
            )
        })
        .collect();

    let out_of_order: HashMap<u32, BTreeMap<u32, u64>> = stats
        .out_of_order
        .clone()
        .into_iter()
        .map(|v| {
            (
                v.0,
                v.1.into_iter()
                    .filter(|elem| elem.0 % (step as u32) == 0)
                    .collect(),
            )
        })
        .collect();

    let rtt: HashMap<u32, BTreeMap<u32, u64>> = stats
        .rtt
        .clone()
        .into_iter()
        .map(|v| {
            (
                v.0,
                v.1.into_iter()
                    .filter(|elem| elem.0 % (step as u32) == 0)
                    .collect(),
            )
        })
        .collect();

    // Translate the internal dev port mappings to front_panel_ports
    let dev_port_to_front_panel_port_mappings =
        generate_dev_port_to_front_panel_mappings(&state.port_mapping);

    let name = state.traffic_generator.lock().await.name.clone();
    let new_time_stats = TimeStatistics {
        tx_rate_l1: translate_port_numbers(&tx, &dev_port_to_front_panel_port_mappings),
        rx_rate_l1: translate_port_numbers(&rx, &dev_port_to_front_panel_port_mappings),
        packet_loss: translate_port_numbers(&packet_loss, &dev_port_to_front_panel_port_mappings),
        out_of_order: translate_port_numbers(&out_of_order, &dev_port_to_front_panel_port_mappings),
        rtt: translate_port_numbers(&rtt, &dev_port_to_front_panel_port_mappings),
        name: name.clone(),
    };

    let mut all_time_stats = vec![new_time_stats];
    let previous_time_stats = state
        .multiple_tests
        .collected_time_statistics
        .lock()
        .await
        .clone();
    all_time_stats.extend(previous_time_stats);
    all_time_stats
}
