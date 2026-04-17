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
    Histogram, IATStatistics, IATValues, RTTStatistics, RangeCount, Statistics, TimeStatistics,
    TypeCount,
};
use crate::core::traffic_gen_core::helper::{
    derive_fpch, filter_map_for_keys, generate_dev_port_to_front_panel_mappings, get_used_ports,
    remap_app_map, remap_port_map,
};
use crate::AppState;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json, Response};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;
use utoipa::ToSchema;

use crate::api::{docs, helper};

// Those statistics are communicated via the API.
// The structure is Port(u32)->Channel(u8)->Stats
// Ports are front panel numbers
#[derive(Serialize, Clone, ToSchema)]
pub struct StatisticsApi {
    pub sample_mode: bool,
    pub frame_size: HashMap<u32, HashMap<u8, RangeCount>>,
    pub tx_rate_l1: HashMap<u32, HashMap<u8, f64>>,
    pub tx_rate_l2: HashMap<u32, HashMap<u8, f64>>,
    pub rx_rate_l1: HashMap<u32, HashMap<u8, f64>>,
    pub rx_rate_l2: HashMap<u32, HashMap<u8, f64>>,
    pub app_tx_l2: HashMap<u32, HashMap<u8, HashMap<u32, f64>>>,
    pub app_rx_l2: HashMap<u32, HashMap<u8, HashMap<u32, f64>>>,
    pub frame_type_data: HashMap<u32, HashMap<u8, TypeCount>>,
    pub iats: HashMap<u32, HashMap<u8, IATStatistics>>,
    pub rtts: HashMap<u32, HashMap<u8, RTTStatistics>>,
    pub packet_loss: HashMap<u32, HashMap<u8, u64>>,
    pub out_of_order: HashMap<u32, HashMap<u8, u64>>,
    pub elapsed_time: u32,
    pub rtt_histogram: HashMap<u32, HashMap<u8, Histogram>>,
    pub iat_histogram: HashMap<u32, HashMap<u8, Histogram>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

impl StatisticsApi {
    pub fn to_api_statistics(
        core: &Statistics,             // core struct, contains only dev ports
        dev_to_fp: &HashMap<u32, u32>, // dev_port -> front_panel
        is_tofino2: bool,
    ) -> StatisticsApi {
        // Deriving this mapping once would actually be nicer .....
        let dev_to_fpch = derive_fpch(dev_to_fp, is_tofino2);

        StatisticsApi {
            sample_mode: core.sample_mode,
            frame_size: remap_port_map(&core.frame_size, &dev_to_fpch),
            tx_rate_l1: remap_port_map(&core.tx_rate_l1, &dev_to_fpch),
            tx_rate_l2: remap_port_map(&core.tx_rate_l2, &dev_to_fpch),
            rx_rate_l1: remap_port_map(&core.rx_rate_l1, &dev_to_fpch),
            rx_rate_l2: remap_port_map(&core.rx_rate_l2, &dev_to_fpch),
            app_tx_l2: remap_app_map(&core.app_tx_l2, &dev_to_fpch),
            app_rx_l2: remap_app_map(&core.app_rx_l2, &dev_to_fpch),
            frame_type_data: remap_port_map(&core.frame_type_data, &dev_to_fpch),
            iats: remap_port_map(&core.iats, &dev_to_fpch),
            rtts: remap_port_map(&core.rtts, &dev_to_fpch),
            packet_loss: remap_port_map(&core.packet_loss, &dev_to_fpch),
            out_of_order: remap_port_map(&core.out_of_order, &dev_to_fpch),
            elapsed_time: core.elapsed_time,
            rtt_histogram: remap_port_map(&core.rtt_histogram, &dev_to_fpch),
            iat_histogram: remap_port_map(&core.iat_histogram, &dev_to_fpch),
            name: core.name.clone(),
        }
    }

    /// Removes all statistics of unused ports.
    /// Used ports are provided in `used_ports`.
    fn filter_inactive_ports(mut stats: StatisticsApi, used_ports: HashSet<u32>) -> StatisticsApi {
        filter_map_for_keys(&mut stats.frame_size, &used_ports);
        filter_map_for_keys(&mut stats.frame_type_data, &used_ports);
        filter_map_for_keys(&mut stats.tx_rate_l1, &used_ports);
        filter_map_for_keys(&mut stats.tx_rate_l2, &used_ports);
        filter_map_for_keys(&mut stats.rx_rate_l1, &used_ports);
        filter_map_for_keys(&mut stats.rx_rate_l2, &used_ports);
        filter_map_for_keys(&mut stats.app_tx_l2, &used_ports);
        filter_map_for_keys(&mut stats.app_rx_l2, &used_ports);
        filter_map_for_keys(&mut stats.iats, &used_ports);
        filter_map_for_keys(&mut stats.rtts, &used_ports);
        filter_map_for_keys(&mut stats.packet_loss, &used_ports);
        filter_map_for_keys(&mut stats.out_of_order, &used_ports);
        filter_map_for_keys(&mut stats.rtt_histogram, &used_ports);
        filter_map_for_keys(&mut stats.iat_histogram, &used_ports);

        stats
    }
}

// Those statistics are communicated via the API.
// The structure is Port(u32)->Channel(u8)->Stats
// Ports are front panel numbers
#[derive(Serialize, Debug, Clone, ToSchema)]
pub struct TimeStatisticsApi {
    pub(crate) tx_rate_l1: HashMap<u32, HashMap<u8, BTreeMap<u32, f64>>>,
    pub(crate) rx_rate_l1: HashMap<u32, HashMap<u8, BTreeMap<u32, f64>>>,
    pub(crate) packet_loss: HashMap<u32, HashMap<u8, BTreeMap<u32, u64>>>,
    pub(crate) out_of_order: HashMap<u32, HashMap<u8, BTreeMap<u32, u64>>>,
    pub(crate) rtt: HashMap<u32, HashMap<u8, BTreeMap<u32, u64>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) name: Option<String>,
}

impl TimeStatisticsApi {
    fn to_api_time_statistics(
        core: &TimeStatistics,
        dev_to_fp: &HashMap<u32, u32>, // dev_port -> front_panel
        is_tofino2: bool,
    ) -> TimeStatisticsApi {
        let dev_to_fpch = derive_fpch(dev_to_fp, is_tofino2);

        TimeStatisticsApi {
            tx_rate_l1: remap_port_map(&core.tx_rate_l1, &dev_to_fpch),
            rx_rate_l1: remap_port_map(&core.rx_rate_l1, &dev_to_fpch),
            packet_loss: remap_port_map(&core.packet_loss, &dev_to_fpch),
            out_of_order: remap_port_map(&core.out_of_order, &dev_to_fpch),
            rtt: remap_port_map(&core.rtt, &dev_to_fpch),
            name: core.name.clone(),
        }
    }

    /// Removes all statistics of unused ports.
    /// Used ports are provided in `used_ports`.
    fn filter_inactive_ports(
        mut stats: TimeStatisticsApi,
        used_ports: HashSet<u32>,
    ) -> TimeStatisticsApi {
        filter_map_for_keys(&mut stats.tx_rate_l1, &used_ports);
        filter_map_for_keys(&mut stats.rx_rate_l1, &used_ports);
        filter_map_for_keys(&mut stats.packet_loss, &used_ports);
        filter_map_for_keys(&mut stats.out_of_order, &used_ports);
        filter_map_for_keys(&mut stats.rtt, &used_ports);

        stats
    }
}

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

pub async fn get_statistics(state: &Arc<AppState>) -> Vec<StatisticsApi> {
    let frame_size_monitor = &state.frame_size_monitor;
    let frame_type_monitor = &state.frame_type_monitor;
    let rate_monitor = &state.rate_monitor;
    let rtt_histogram_monitor = &state.rtt_histogram_monitor;
    let iat_histogram_monitor = &state.iat_histogram_monitor;

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
        iat_histogram: Default::default(),
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
        stats.iat_histogram = iat_histogram_monitor.lock().await.histogram.clone();
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

    let port_mapping = &state.port_mapping;

    if state.sample_mode {
        let mut iats = HashMap::new();
        let tx_stats = &mut state.rate_monitor.lock().await.tx_iat_storage.clone();
        let rx_stats = &mut state.rate_monitor.lock().await.rx_iat_storage.clone();

        for port in port_mapping.keys() {
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

    let dev_to_fp = generate_dev_port_to_front_panel_mappings(port_mapping);

    // We get dev-port <-> stats from core. Translate it to front_panel/channel <-> stats and give this to API
    let stats = StatisticsApi::to_api_statistics(&stats, &dev_to_fp, state.tofino2);

    // Filter for inactive ports
    let used_ports: HashSet<u32> = get_used_ports(state).await;
    let stats = StatisticsApi::filter_inactive_ports(stats, used_ports);

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

pub async fn get_time_statistics(state: &Arc<AppState>, params: Params) -> Vec<TimeStatisticsApi> {
    let rate_monitor = &state.rate_monitor;
    let stats = rate_monitor.lock().await.time_statistics.clone();

    let port_mapping = &state.port_mapping;

    let limit = params.limit.unwrap_or(usize::MAX);

    let elements = stats
        .tx_rate_l1
        .values()
        .map(|series| series.len())
        .max()
        .unwrap_or(0);

    let step = {
        if limit < elements {
            elements / limit
        } else {
            1
        }
    };

    // get every ratio-nth element
    let tx_rate_l1: HashMap<u32, BTreeMap<u32, f64>> = stats
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

    let rx_rate_l1: HashMap<u32, BTreeMap<u32, f64>> = stats
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

    let name = state.traffic_generator.lock().await.name.clone();
    let new_time_stats = TimeStatistics {
        tx_rate_l1,
        rx_rate_l1,
        packet_loss,
        out_of_order,
        rtt,
        name,
    };

    let dev_to_fp = generate_dev_port_to_front_panel_mappings(port_mapping);

    // Translate to API view (front_panel -> channel)
    // We get dev-port <-> stats from core. Translate it to front_panel/channel <-> stats and give this to API
    let new_time_stats =
        TimeStatisticsApi::to_api_time_statistics(&new_time_stats, &dev_to_fp, state.tofino2);

    // Filter for inactive ports
    let used_ports: HashSet<u32> = get_used_ports(state).await;
    let new_time_stats = TimeStatisticsApi::filter_inactive_ports(new_time_stats, used_ports);

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
