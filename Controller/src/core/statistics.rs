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

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use utoipa::ToSchema;

#[derive(Serialize, Clone, ToSchema)]
pub struct FrameSizeStatistics {
    pub(crate) frame_size: HashMap<u32, RangeCount>,
}

#[derive(Serialize, Clone, ToSchema)]
pub struct RangeCount {
    // lower, upper, count
    pub(crate) tx: Vec<RangeCountValue>,
    pub(crate) rx: Vec<RangeCountValue>,
}

impl RangeCount {
    pub fn default() -> RangeCount {
        RangeCount {
            tx: vec![],
            rx: vec![],
        }
    }
}

/// Stores the number of packets that have been received with frame size
/// in a given range
#[derive(Serialize, Clone, ToSchema)]
pub struct RangeCountValue {
    /// lower bound on the frame size
    pub(crate) low: u32,
    /// upper bound on the frame size
    pub(crate) high: u32,
    /// number of packets with lower bound <= packet size <= upper bound
    pub(crate) packets: u128,
}

impl RangeCountValue {
    pub fn new(low: u32, high: u32, packets: u128) -> RangeCountValue {
        RangeCountValue { low, high, packets }
    }
}

impl FrameSizeStatistics {
    pub fn default() -> FrameSizeStatistics {
        FrameSizeStatistics {
            frame_size: HashMap::new(),
        }
    }
}

#[derive(Serialize, Clone, ToSchema)]
pub struct FrameTypeStatistics {
    pub(crate) frame_type_data: HashMap<u32, TypeCount>,
}

/// Stores the number of packet types that have been sent / received.
#[derive(Serialize, Debug, Clone, ToSchema)]
pub struct TypeCount {
    /// TX path
    pub(crate) tx: HashMap<String, u128>,
    /// RX path
    pub(crate) rx: HashMap<String, u128>,
}

impl FrameTypeStatistics {
    pub fn default() -> FrameTypeStatistics {
        FrameTypeStatistics {
            frame_type_data: HashMap::new(),
        }
    }
}

impl TypeCount {
    pub fn default() -> TypeCount {
        TypeCount {
            tx: HashMap::new(),
            rx: HashMap::new(),
        }
    }
}

#[derive(Serialize, Debug, Clone, ToSchema)]
pub struct RateMonitorStatistics {
    pub(crate) iats: HashMap<u32, IATStatistics>,
    pub(crate) rtts: HashMap<u32, RTTStatistics>,
    pub(crate) tx_rate_l1: HashMap<u32, f64>,
    pub(crate) tx_rate_l2: HashMap<u32, f64>,
    pub(crate) rx_rate_l1: HashMap<u32, f64>,
    pub(crate) rx_rate_l2: HashMap<u32, f64>,
    pub(crate) app_tx_l2: HashMap<u32, HashMap<u32, f64>>,
    pub(crate) app_rx_l2: HashMap<u32, HashMap<u32, f64>>,
    pub(crate) packet_loss: HashMap<u32, u64>,
    pub(crate) out_of_order: HashMap<u32, u64>,
}

impl RateMonitorStatistics {
    pub fn default() -> RateMonitorStatistics {
        RateMonitorStatistics {
            iats: Default::default(),
            rtts: Default::default(),
            tx_rate_l1: Default::default(),
            tx_rate_l2: Default::default(),
            rx_rate_l1: Default::default(),
            rx_rate_l2: Default::default(),
            app_tx_l2: Default::default(),
            app_rx_l2: Default::default(),
            packet_loss: Default::default(),
            out_of_order: Default::default(),
        }
    }
}

#[derive(Serialize, Debug, Clone, ToSchema)]
pub struct IATStatistics {
    /// TX path
    pub(crate) tx: IATValues,
    /// RX path
    pub(crate) rx: IATValues,
}

#[derive(Serialize, Debug, Clone, ToSchema)]
pub struct RTTStatistics {
    pub(crate) mean: f64,
    pub(crate) min: u32,
    pub(crate) max: u32,
    pub(crate) current: u32,
    pub(crate) jitter: f64,
    pub(crate) n: u32,
}

impl IATStatistics {
    pub fn default() -> IATStatistics {
        IATStatistics {
            tx: IATValues::default(),
            rx: IATValues::default(),
        }
    }
}

#[derive(Serialize, Debug, Clone, ToSchema)]
pub struct IATValues {
    /// Mean value. Either based on samples or computed in the data plane.
    /// See sample mode.
    pub(crate) mean: f32,
    /// Standard deviation. Only calculated if sample mode is true.
    pub(crate) std: Option<f32>,
    /// Mean absolute error. Only calculated if sample mode is false.
    /// This value is directly calculated in the data plane.
    pub(crate) mae: f32,
    /// Number of IAT samples. Only valid if sample mode is true.
    pub(crate) n: u32,
}

impl IATValues {
    pub fn default() -> IATValues {
        IATValues {
            mean: 0f32,
            mae: 0f32,
            std: None,
            n: 1,
        }
    }
}

/// Represents the time-based statistics
/// for visualisation
#[derive(Serialize, Debug, Clone, ToSchema)]
pub struct TimeStatistic {
    pub(crate) tx_rate_l1: BTreeMap<u32, BTreeMap<u32, f64>>,
    pub(crate) rx_rate_l1: BTreeMap<u32, BTreeMap<u32, f64>>,
    pub(crate) packet_loss: BTreeMap<u32, BTreeMap<u32, u64>>,
    pub(crate) out_of_order: BTreeMap<u32, BTreeMap<u32, u64>>,
    pub(crate) rtt: BTreeMap<u32, BTreeMap<u32, u64>>,
}

impl TimeStatistic {
    pub fn default() -> TimeStatistic {
        TimeStatistic {
            tx_rate_l1: Default::default(),
            rx_rate_l1: Default::default(),
            packet_loss: Default::default(),
            out_of_order: Default::default(),
            rtt: Default::default(),
        }
    }
}

#[derive(Serialize, Debug, Clone, ToSchema, Deserialize)]
pub struct RttHistogramConfig {
    /// Minimum range for histogram.
    pub min: u32,
    /// Maximum range for histogram.
    pub max: u32,
    // Number of bins for histogram.
    pub num_bins: u32,
}

impl RttHistogramConfig {
    pub fn get_bin_width(&self) -> u32 {
        (self.max - self.min) / self.num_bins
    }
}

impl Default for RttHistogramConfig {
    fn default() -> Self {
        RttHistogramConfig {
            min: 1500,
            max: 2500,
            num_bins: 10,
        }
    }
}

#[derive(Serialize, Debug, Clone, ToSchema, Default)]
pub struct RttHistogramData {
    /// HashMap with bin index as key and bin count with probability as value.
    pub data_bins: HashMap<u32, RttHistogramBinEntry>,
    /// HashMap with percentiles and their values.
    pub percentiles: HashMap<u32, f64>,
    /// Mean RTT calculated from the histogram data.
    pub mean_rtt: f64,
    /// Standard deviation calculated from the histogram data.
    pub std_dev_rtt: f64,
    /// Total number of packets matched to bins.
    pub total_pkt_count: u128,
    /// Number of packets not matched to any bin.
    pub missed_bin_count: u128,
}

#[derive(Serialize, Debug, Clone, ToSchema, Default)]
pub struct RttHistogramBinEntry {
    /// Number of packets in this bin.
    pub count: u128,
    /// Probability for this bin based on total_pkt_count.
    pub probability: f64,
}

#[derive(Serialize, Debug, Clone, ToSchema)]
pub struct RttHistogram {
    pub config: RttHistogramConfig,
    pub data: RttHistogramData,
}

impl RttHistogram {
    pub fn default() -> RttHistogram {
        RttHistogram {
            data: Default::default(),
            config: Default::default(),
        }
    }
}
