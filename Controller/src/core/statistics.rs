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
use std::collections::{BTreeMap, HashMap, HashSet};
use utoipa::ToSchema;

use crate::core::traffic_gen_core::helper::{filter_map_for_keys, translate_keys};

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

/// Common fields for time-based statistics
#[derive(Serialize, Debug, Clone, ToSchema)]
pub struct TimeStatistics {
    /// L1 send rates per test and port
    pub(crate) tx_rate_l1: HashMap<u32, BTreeMap<u32, f64>>,
    /// L1 receive rates per test and port
    pub(crate) rx_rate_l1: HashMap<u32, BTreeMap<u32, f64>>,
    /// Number of lost packets per test and port
    pub(crate) packet_loss: HashMap<u32, BTreeMap<u32, u64>>,
    /// Number of out-of-order packets per test and port
    pub(crate) out_of_order: HashMap<u32, BTreeMap<u32, u64>>,
    /// RTT values per test and port
    pub(crate) rtt: HashMap<u32, BTreeMap<u32, u64>>,
    /// Name of the test those stats belong to
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) name: Option<String>,
}

impl TimeStatistics {
    pub fn default() -> TimeStatistics {
        TimeStatistics {
            tx_rate_l1: Default::default(),
            rx_rate_l1: Default::default(),
            packet_loss: Default::default(),
            out_of_order: Default::default(),
            rtt: Default::default(),
            name: None,
        }
    }
}

#[derive(Serialize, Debug, Clone, ToSchema, Deserialize)]
pub struct RttHistogramConfig {
    // Number of bins for histogram.
    pub num_bins: u32,
    /// Minimum range for histogram.
    pub min: u32,
    /// Maximum range for histogram.
    pub max: u32,
    /// Percentiles to calculate from histogram data. Float values between 0 and 1.0
    pub percentiles: Option<Vec<f64>>,
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
            percentiles: Some(vec![0.25, 0.5, 0.75, 0.9]),
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

#[derive(Serialize, ToSchema, Clone)]
pub struct Statistics {
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

impl Statistics {
    /// Replaces the key (dev-ports) in all stored statistics with the front_panel port.
    /// The mapping from dev-port to front-panel port is provided in `dev_port_to_front_panel_port_mappings`
    fn translate_dev_port_to_front_panel_port_numbers(
        self,
        dev_port_to_front_panel_port_mappings: HashMap<u32, u32>,
    ) -> Statistics {
        Statistics {
            sample_mode: self.sample_mode,
            frame_size: translate_keys(&self.frame_size, &dev_port_to_front_panel_port_mappings),
            frame_type_data: translate_keys(
                &self.frame_type_data,
                &dev_port_to_front_panel_port_mappings,
            ),
            tx_rate_l1: translate_keys(&self.tx_rate_l1, &dev_port_to_front_panel_port_mappings),
            tx_rate_l2: translate_keys(&self.tx_rate_l2, &dev_port_to_front_panel_port_mappings),
            rx_rate_l1: translate_keys(&self.rx_rate_l1, &dev_port_to_front_panel_port_mappings),
            rx_rate_l2: translate_keys(&self.rx_rate_l2, &dev_port_to_front_panel_port_mappings),
            app_tx_l2: translate_keys(&self.app_tx_l2, &dev_port_to_front_panel_port_mappings),
            app_rx_l2: translate_keys(&self.app_rx_l2, &dev_port_to_front_panel_port_mappings),
            iats: translate_keys(&self.iats, &dev_port_to_front_panel_port_mappings),
            rtts: translate_keys(&self.rtts, &dev_port_to_front_panel_port_mappings),
            packet_loss: translate_keys(&self.packet_loss, &dev_port_to_front_panel_port_mappings),
            out_of_order: translate_keys(
                &self.out_of_order,
                &dev_port_to_front_panel_port_mappings,
            ),
            elapsed_time: self.elapsed_time,
            rtt_histogram: translate_keys(
                &self.rtt_histogram,
                &dev_port_to_front_panel_port_mappings,
            ),
            name: self.name,
        }
    }

    /// Removes all statistics of unused ports.
    /// Used ports are provided in `used_ports`.
    fn filter_inactive_ports(mut self, used_ports: HashSet<u32>) -> Statistics {
        filter_map_for_keys(&mut self.frame_size, &used_ports);
        filter_map_for_keys(&mut self.frame_type_data, &used_ports);
        filter_map_for_keys(&mut self.tx_rate_l1, &used_ports);
        filter_map_for_keys(&mut self.tx_rate_l2, &used_ports);
        filter_map_for_keys(&mut self.rx_rate_l1, &used_ports);
        filter_map_for_keys(&mut self.rx_rate_l2, &used_ports);
        filter_map_for_keys(&mut self.app_tx_l2, &used_ports);
        filter_map_for_keys(&mut self.app_rx_l2, &used_ports);
        filter_map_for_keys(&mut self.iats, &used_ports);
        filter_map_for_keys(&mut self.rtts, &used_ports);
        filter_map_for_keys(&mut self.packet_loss, &used_ports);
        filter_map_for_keys(&mut self.out_of_order, &used_ports);
        filter_map_for_keys(&mut self.rtt_histogram, &used_ports);

        self
    }

    /// Replaces the key (dev-ports) in all stored statistics with the front_panel port.
    /// The mapping from dev-port to front-panel port is provided in `dev_port_to_front_panel_port_mappings`  
    /// Removes all statistics of unused ports.
    /// Used ports are provided in `used_ports`.    
    pub fn translate_and_filter_ports(
        self,
        dev_port_to_front_panel_port_mappings: HashMap<u32, u32>,
        used_ports: HashSet<u32>,
    ) -> Statistics {
        let stats = self
            .translate_dev_port_to_front_panel_port_numbers(dev_port_to_front_panel_port_mappings);
        stats.filter_inactive_ports(used_ports)
    }
}

impl TimeStatistics {
    /// Replaces the key (dev-ports) in all stored statistics with the front_panel port.
    /// The mapping from dev-port to front-panel port is provided in `dev_port_to_front_panel_port_mappings`    
    fn translate_dev_port_to_front_panel_port_numbers(
        self,
        dev_port_to_front_panel_port_mappings: HashMap<u32, u32>,
    ) -> TimeStatistics {
        TimeStatistics {
            tx_rate_l1: translate_keys(&self.tx_rate_l1, &dev_port_to_front_panel_port_mappings),
            rx_rate_l1: translate_keys(&self.rx_rate_l1, &dev_port_to_front_panel_port_mappings),
            packet_loss: translate_keys(&self.packet_loss, &dev_port_to_front_panel_port_mappings),
            out_of_order: translate_keys(
                &self.out_of_order,
                &dev_port_to_front_panel_port_mappings,
            ),
            rtt: translate_keys(&self.rtt, &dev_port_to_front_panel_port_mappings),
            name: self.name,
        }
    }

    /// Removes all statistics of unused ports.
    /// Used ports are provided in `used_ports`.
    fn filter_inactive_ports(mut self, used_ports: HashSet<u32>) -> TimeStatistics {
        filter_map_for_keys(&mut self.tx_rate_l1, &used_ports);
        filter_map_for_keys(&mut self.rx_rate_l1, &used_ports);
        filter_map_for_keys(&mut self.packet_loss, &used_ports);
        filter_map_for_keys(&mut self.out_of_order, &used_ports);
        filter_map_for_keys(&mut self.rtt, &used_ports);

        self
    }

    /// Replaces the key (dev-ports) in all stored statistics with the front_panel port.
    /// The mapping from dev-port to front-panel port is provided in `dev_port_to_front_panel_port_mappings`  
    /// Removes all statistics of unused ports.
    /// Used ports are provided in `used_ports`.
    pub fn translate_and_filter_ports(
        self,
        dev_port_to_front_panel_port_mappings: HashMap<u32, u32>,
        used_ports: HashSet<u32>,
    ) -> TimeStatistics {
        let stats = self
            .translate_dev_port_to_front_panel_port_numbers(dev_port_to_front_panel_port_mappings);
        stats.filter_inactive_ports(used_ports)
    }
}
