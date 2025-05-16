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

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use std::time::Duration;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{Json, IntoResponse, Response};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use crate::AppState;
use crate::core::statistics::{HistoryTimeStatistic, IATStatistics, IATValues, RTTStatistics, RangeCount, RttHistogram, TimeStatistic, CommonTimeStatistic, TypeCount};

use crate::api::{docs, helper};

#[derive(Serialize, ToSchema, Clone)]
pub struct CommonStatistics {
    /// Indicates whether the sample mode is used or not.
    /// In sampling mode, IATs are sampled and not calculated in the data plane.
    /// It is recommended to don't use the sample mode to get more precise values
    pub(crate) sample_mode: bool,
    /// Frame size statistics that are divided in (lower, upper) sections.
    pub(crate) frame_size: HashMap<u32, RangeCount>,
    /// L1 send rates per port.
    pub(crate) tx_rate_l1: HashMap<u32, f64>,
    /// L2 send rates per port.
    pub(crate) tx_rate_l2: HashMap<u32, f64>,
    /// L1 receive rates per port.
    pub(crate) rx_rate_l1: HashMap<u32, f64>,
    /// L2 receive rates per port.
    pub(crate) rx_rate_l2: HashMap<u32, f64>,
    /// L2 send rate per stream and port.
    /// The number corresponds to the app_id in the Stream description.
    pub(crate) app_tx_l2: HashMap<u32, HashMap<u32, f64>>,
    /// L2 receive rate per stream and port.
    /// The number corresponds to the app_id in the Stream description.
    pub(crate) app_rx_l2: HashMap<u32, HashMap<u32, f64>>,
    /// Statistics what kind of packets have been received per port
    pub(crate) frame_type_data: HashMap<u32, TypeCount>,
    /// Statistics of the inter arrival times per port.
    pub(crate) iats: HashMap<u32, IATStatistics>,
    /// Statistics of the round trip times per port.
    pub(crate) rtts: HashMap<u32, RTTStatistics>,
    /// Number of lost packets per port.
    pub(crate) packet_loss: HashMap<u32, u64>,
    /// Number of out of order packets per port.
    pub(crate) out_of_order: HashMap<u32, u64>,
    /// Elapsed time since the traffic generation has started in seconds.
    pub(crate) elapsed_time: u32,
    /// RTT histogram data per port and per bin.
    pub(crate) rtt_histogram: HashMap<u32, RttHistogram>,
    // Name of the test for the statistics
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) name: Option<String>,

}


#[derive(Serialize, ToSchema, Clone)]
pub struct Statistics {
    #[serde(flatten)]
    pub(crate) inner: CommonStatistics,

    /// Save previous statistics, where the key is the test number of the statistics. 
    /// Skip serializing if there are no previous statistics.
    // If this is Statistics instead of HistoryStatistics, we have a recursive stack overflow
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) previous_statistics: Option<BTreeMap<u32, HistoryStatistics>>,    
}

#[derive(Serialize, ToSchema, Clone)]
pub struct HistoryStatistics {
    #[serde(flatten)]
    pub(crate) inner: CommonStatistics
}

impl From<Statistics> for HistoryStatistics {
    fn from(stats: Statistics) -> Self {
        HistoryStatistics {
            inner: stats.inner,
        }
    }
}

#[derive(Serialize, ToSchema, Clone)]
pub struct TimeStatistics {
    /// L1 send rates per port.
    pub(crate) tx_rate_l1: HashMap<u32, HashMap<u32, f64>>,
    /// L2 send rates per port.
    pub(crate) tx_rate_l2: HashMap<u32, f64>,
    /// L1 receive rates per port.
    pub(crate) rx_rate_l1: HashMap<u32, HashMap<u32, f64>>,
    /// L2 receive rates per port.
    pub(crate) rx_rate_l2: HashMap<u32, f64>,
    /// Statistics of the round trip times per port.
    pub(crate) rtts: HashMap<u32, HashMap<u32, f64>>,
    /// Number of lost packets per port.
    pub(crate) packet_loss: HashMap<u32, HashMap<u32, f64>>,
    /// Number of out of order packets per port.
    pub(crate) out_of_order: HashMap<u32, HashMap<u32, f64>>, 
}

#[utoipa::path(
    get,
    path = "/api/statistics",
    responses(
        (status = 200,
        description = "Returns the statistics.",
        body = Statistics,
        example = json!(*docs::statistics::EXAMPLE_GET_1)
        ))
)]
/// Returns the current statistics such as traffic rates, frame types, etc.
pub async fn statistics(State(state): State<Arc<AppState>>) -> Response {
    let stats = get_statistics(&state).await;

    (StatusCode::OK, Json(stats)).into_response()
}

pub async fn get_statistics(state: &Arc<AppState>) -> Statistics {
    let frame_size_monitor = &state.frame_size_monitor;
    let frame_type_monitor = &state.frame_type_monitor;
    let rate_monitor = &state.rate_monitor;
    let rtt_histogram_monitor = &state.rtt_histogram_monitor;

    let collected_statistics = state.multiple_tests.collected_statistics.lock().await;

    let previous_statistics_map = (!collected_statistics.is_empty()).then(|| {
        collected_statistics
            .iter()
            .enumerate()
            .map(|(i, stats)| ((i + 1) as u32, HistoryStatistics::from(stats.clone())))
            .collect::<BTreeMap<u32, HistoryStatistics>>()
    });

    let mut stats = Statistics { inner: CommonStatistics {
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
        name: None},
        previous_statistics: previous_statistics_map,
    };


    stats.inner.frame_size = frame_size_monitor.lock().await.statistics.frame_size.clone();
    stats.inner.frame_type_data = frame_type_monitor.lock().await.statistics.frame_type_data.clone();
    stats.inner.rtt_histogram = rtt_histogram_monitor.lock().await.histogram.clone();
    stats.inner.name = state.traffic_generator.lock().await.name.clone();

    let monitor_statistics =  rate_monitor.lock().await.statistics.clone();

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

        stats.inner.iats = iats;

    }
    else {
        stats.inner.iats = monitor_statistics.iats.clone();
    }

    stats.inner.rtts = rtt_stats;
    stats.inner.tx_rate_l1 = monitor_statistics.tx_rate_l1.clone();
    stats.inner.rx_rate_l1 = monitor_statistics.rx_rate_l1.clone();
    stats.inner.tx_rate_l2 = monitor_statistics.tx_rate_l2.clone();
    stats.inner.rx_rate_l2 = monitor_statistics.rx_rate_l2.clone();
    stats.inner.app_tx_l2 = monitor_statistics.app_tx_l2.clone();
    stats.inner.app_rx_l2 = monitor_statistics.app_rx_l2.clone();
    stats.inner.packet_loss = monitor_statistics.packet_loss.clone();
    stats.inner.out_of_order = monitor_statistics.out_of_order.clone();
    stats.inner.elapsed_time = {
        let experiment = state.experiment.lock().await;
        if experiment.running {
            experiment.start.elapsed().unwrap_or(Duration::from_secs(0)).as_secs() as u32
        }
        else {
            0
        }
    };

    stats

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
        body = TimeStatistics,
        example = json!(*docs::statistics::EXAMPLE_GET_2)
        ))
)]
/// Returns the current statistics over time with one data point per second.
pub async fn time_statistics(State(state): State<Arc<AppState>>, Query(params): Query<Params>) -> Response {
    let stats = get_time_statistics(&state, params).await;
    (StatusCode::OK, Json(stats)).into_response()
}

pub async fn get_time_statistics(state: &Arc<AppState>, params: Params) -> TimeStatistic {
    let rate_monitor = &state.rate_monitor;
    let stats = rate_monitor.lock().await.time_statistics.clone();
    let collected_time_statistics = state.multiple_tests.collected_time_statistics.lock().await.clone();
    let name = state.traffic_generator.lock().await.name.clone();

    // Convert collected_time_statistics into BTreeMap
    let previous_time_statistics_map = (!collected_time_statistics.is_empty()).then(|| {
        collected_time_statistics
            .iter()
            .enumerate()
            .map(|(i, stats)| ((i + 1) as u32, HistoryTimeStatistic::from(stats.clone())))
            .collect::<BTreeMap<u32, HistoryTimeStatistic>>()
    });    

    let limit = params.limit.unwrap_or(usize::MAX);

    // we typically have as many elements as elapsed seconds
    let elements =  state.experiment.lock().await.start.elapsed().unwrap_or(Duration::from_secs(0)).as_secs() as usize;

    let step = {
        if limit < elements {
            elements / limit
        }
        else {
            1
        }
    };

    // get every ratio-nth element
    let tx: BTreeMap<u32, BTreeMap<u32, f64>> = stats.inner.tx_rate_l1.clone()
        .into_iter()
        .map(|v|
            (v.0, v.1.into_iter().filter(|elem| elem.0 % (step as u32) == 0).collect())).collect();

    let rx: BTreeMap<u32, BTreeMap<u32, f64>> = stats.inner.rx_rate_l1.clone()
        .into_iter()
        .map(|v|
            (v.0, v.1.into_iter().filter(|elem| elem.0 % (step as u32) == 0).collect())).collect();

    let packet_loss: BTreeMap<u32, BTreeMap<u32, u64>> = stats.inner.packet_loss.clone()
        .into_iter()
        .map(|v|
            (v.0, v.1.into_iter().filter(|elem| elem.0 % (step as u32) == 0).collect())).collect();

    let out_of_order: BTreeMap<u32, BTreeMap<u32, u64>> = stats.inner.out_of_order.clone()
        .into_iter()
        .map(|v|
            (v.0, v.1.into_iter().filter(|elem| elem.0 % (step as u32) == 0).collect())).collect();

    let rtt: BTreeMap<u32, BTreeMap<u32, u64>> = stats.inner.rtt.clone()
        .into_iter()
        .map(|v|
            (v.0, v.1.into_iter().filter(|elem| elem.0 % (step as u32) == 0).collect())).collect();            

    TimeStatistic { inner: CommonTimeStatistic {
        tx_rate_l1: tx,
        rx_rate_l1: rx,
        packet_loss,
        out_of_order,
        rtt,
        name
        },
        previous_statistics: previous_time_statistics_map
    }

}
