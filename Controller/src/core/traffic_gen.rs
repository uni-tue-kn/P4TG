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

use std::collections::{HashMap, HashSet};
use std::str::FromStr;
use std::cmp;

use log::info;
use macaddr::MacAddr;
use rbfrt::{SwitchConnection, table};
use rbfrt::error::RBFRTError;
use rbfrt::table::{MatchValue, Request};
use crate::core::traffic_gen_core::types::{Stream, StreamSetting};
use crate::core::{create_simple_multicast_group};
use crate::core::multicast::delete_simple_multicast_group;
use crate::{AppState, PortMapping};
use crate::core::traffic_gen_core::event::TrafficGenEvent;
use crate::error::P4TGError;

use crate::core::traffic_gen_core::const_definitions::*;
use crate::core::traffic_gen_core::helper::{calculate_overhead, create_packet};
use crate::core::traffic_gen_core::optimization::calculate_send_behaviour;
use crate::core::traffic_gen_core::types::*;

/// A Traffic Generator object.
/// The traffic generator controls the main configuration of P4TG.
/// It configures the internal traffic generator and triggers the insertion of appropriate forwarding rules.
pub struct TrafficGen {
    /// Minimal buffer offset that is required for stream packets.
    /// This value is set to the size of the monitoring packets that start at position 0.
    min_buffer_offset: u32,
    /// Indicates if the traffic generator is running.
    pub running: bool,
    /// Stored stream setting values.
    /// The stream settings are received by the REST API and stored to synchronize multiple configuration clients
    /// (e.g., multiple open web browsers) to the same settings.
    pub stream_settings: Vec<StreamSetting>,
    /// The streams are received by the REST API and stored to synchronize multiple configuration clients
    /// (e.g., multiple open web browsers) to the same settings.
    pub streams: Vec<Stream>,
    /// The generation mode is received by the REST API and stored to synchronize multiple configuration clients
    /// (e.g., multiple open web browsers) to the same settings.
    pub mode: GenerationMode,
    /// The port mapping is received by the REST API and stored to synchronize multiple configuration clients
    /// (e.g., multiple open web browsers) to the same settings.
    /// The port mapping indicates which ports are used for traffic generation and on which port the returning traffic
    /// is expected.
    pub port_mapping: HashMap<u32, u32>,
    /// Optional duration for the traffic generation.
    pub duration: Option<u64>, 
    /// Indicates if tofino2 is used
    pub is_tofino2: bool
}

impl TrafficGen {
    pub fn new(is_tofino2: bool) -> TrafficGen {
        TrafficGen {
            min_buffer_offset: 0,
            running: false,
            stream_settings: vec![],
            streams: vec![],
            mode: GenerationMode::Cbr,
            port_mapping: HashMap::new(),
            duration: None,
            is_tofino2
        }
    }

    /// Inits the monitoring packet.
    /// This will do multiple things:
    ///
    /// * Activate the internal traffic gen capability on ports [TG_PIPE_PORTS]
    /// * Create the multicast group [MONITORING_PACKET_MID] that is mapped to all TX recirculation ports
    /// * Create a monitoring packet and configure the internal TG to create it each [MONITORING_PACKET_INTERVAL] ns
    ///
    /// # Arguments
    ///
    /// * `switch`: Switch connection object
    /// * `port_mapping`: Mapping between front panel port and internal TX / RX recirculation ports
    ///
    /// # Returns
    ///
    /// Returns a mapping between an index and the corresponding (port, app_id)
    pub async fn init_monitoring_packet(&mut self, switch: &SwitchConnection, port_mapping: &HashMap<u32, PortMapping>) -> Result<HashMap<u32, MonitoringMapping>, RBFRTError> {
        // activate traffic gen capabilities on internal ports
        let req: Vec<Request> = if self.is_tofino2 {TG_PIPE_PORTS_TF2.to_vec()} else {TG_PIPE_PORTS.to_vec()}
            .into_iter().map(|x| {
            Request::new(if self.is_tofino2 {PORT_CFG_TF2} else {PORT_CFG})
                .match_key("dev_port", MatchValue::exact(x))
                .action_data("pktgen_enable", true)
        }).collect();

        switch.update_table_entries(req).await?;

        info!("Activated traffic gen capabilities.");

        // clear possibly activated pktgen for monitoring (app id 0)
        let update_request = Request::new(if self.is_tofino2 {APP_CFG_TF2} else {APP_CFG})
            .match_key("app_id", MatchValue::exact(0))
            .action("trigger_timer_periodic")
            .action_data("app_enable", false);

        switch.update_table_entry(update_request).await?;

        // clear multicast table
        // may fail if the group does not exist, therefore ignore error
        let _ = delete_simple_multicast_group(switch, MONITORING_PACKET_MID).await;

        // build the monitoring packet
        // monitoring packets are regular ethernet packets
        // with a special ether type
        let monitoring_packet = {
            let pkt = etherparse::Ethernet2Header {
                source: [0, 0, 0, 0, 0, 0], // we do not need mac src & dst
                destination: [0, 0, 0, 0, 0, 0],
                ether_type: 0xBB02, // Monitoring ether type
            };

            let mut result = Vec::<u8>::with_capacity(64);

            pkt.write(&mut result).unwrap();

            // fill with zeros
            let padding = vec![0u8; result.capacity() - result.len()];
            result.extend_from_slice(&padding);

            result
        };

        // configure send behaviour for monitoring packet
        let res = self.configure_traffic_gen_table(switch, vec![StreamPacket {
            app_id: 0,
            bytes: monitoring_packet,
            timer: MONITORING_PACKET_INTERVAL,
            buffer_offset: Some(0),
            n_packets: 1
        }]).await?;

        // Min buffer offset is equal to the size of the monitoring packet
        self.min_buffer_offset = res.get(&0).unwrap().bytes.len() as u32;

        // Activate traffic generation for the monitoring packet
        self.activate_traffic_gen_applications(switch, &res).await?;

        // create a multicast group for the monitoring packet
        // that replicates a generated monitoring packet to all TX recirculation ports
        // this results in "parallel" monitoring of each traffic generation port
        let multicast_ports = port_mapping.iter().map(|(_, p)| p.tx_recirculation).collect::<Vec<_>>();

        create_simple_multicast_group(switch, MONITORING_PACKET_MID, &multicast_ports).await?;

        // mapping from monitoring index to (port, app_id)
        // this index is used to monitor individual stream rates
        // the index is used in the data plane to access a register to store stream specific data
        let index_mapping = self.configure_monitoring_path(switch, port_mapping).await?;

        info!("Monitoring packets initialized.");

        Ok(index_mapping)

    }

    /// This method configures the monitoring path.
    /// It creates a mapping between different applications on all recirculation ports.
    /// This mapping is later used to monitor individual stream TX/RX rates and to remap
    /// the index to the correct (port, app).
    ///
    /// # Arguments
    ///
    /// * `port_mapping`: Mapping of front panel port to TX / RX recirculation port
    async fn configure_monitoring_path(&mut self,
                                           switch: &SwitchConnection,
                                           port_mapping: &HashMap<u32, PortMapping>) -> Result<HashMap<u32, MonitoringMapping>, RBFRTError> {
        // first clear all related tables
        switch.clear_tables(vec![MONITORING_INIT_TABLE, MONITORING_FORWARD_TABLE, MONITORING_EGRESS_TABLE]).await?;

        // create a mapping between index and (port, app id)
        // used to monitor L2 rates of individual streams
        let mut index = 1u32;
        let mut return_mapping = HashMap::new();
        let mut reverse_mapping = HashMap::new();

        for mapping in port_mapping.values() {
            for app_id in 1..9 {
                return_mapping.insert(index, MonitoringMapping {
                    index,
                    port: mapping.tx_recirculation,
                    app_id,
                });

                return_mapping.insert(index+1, MonitoringMapping {
                    index: index+1,
                    port: mapping.rx_recirculation,
                    app_id
                });

                // store the reverse mapping for easy access to the index for a given (port, app_id) combination
                reverse_mapping.insert((mapping.tx_recirculation, app_id),  index);
                reverse_mapping.insert((mapping.rx_recirculation, app_id),  index+1);

                index += 2;
            }
        }

        let mut init_requests = vec![];
        let mut forward_requests = vec![];
        let mut egress_monitoring_requests = vec![];

        forward_requests.push(table::Request::new(MONITORING_FORWARD_TABLE)
            .match_key("hdr.monitor.index", MatchValue::exact(0))
            .match_key("ig_intr_md.ingress_port", MatchValue::exact(if self.is_tofino2 {TG_PIPE_PORTS_TF2[0]} else {TG_PIPE_PORTS[0]}))
            .action("ingress.p4tg.mc_forward")
            .action_data("mcid", MONITORING_PACKET_MID));

        // create table entries for [MONITORING_INIT_TABLE]
        for mapping in port_mapping.values() {
            // initialize monitoring packets in egress
            let req = table::Request::new(MONITORING_INIT_TABLE)
                .match_key("eg_intr_md.egress_port", MatchValue::exact(mapping.tx_recirculation))
                .match_key("hdr.monitor.index", MatchValue::exact(0))
                .action("egress.init_monitor_header")
                // next index
                .action_data("index", *reverse_mapping.get(&(mapping.tx_recirculation, 1)).unwrap());

            init_requests.push(req);

            // configure forwarding in ingress
            for app_id in 1..8 {
                // Forward packets from ingress TX to next egress RX
                let req = table::Request::new(MONITORING_FORWARD_TABLE)
                    .match_key("ig_intr_md.ingress_port", MatchValue::exact(mapping.tx_recirculation))
                    .match_key("hdr.monitor.index",
                               MatchValue::exact(*reverse_mapping.get(&(mapping.tx_recirculation, app_id)).unwrap()))
                    .action("ingress.p4tg.make_digest_and_forward")
                    .action_data("e_port", mapping.rx_recirculation) // forward to RX path
                    .action_data("index", *reverse_mapping.get(&(mapping.rx_recirculation, app_id)).unwrap());

                forward_requests.push(req);

                // Forward packets from ingress RX to next egress TG
                let req = table::Request::new(MONITORING_FORWARD_TABLE)
                    .match_key("ig_intr_md.ingress_port", MatchValue::exact(mapping.rx_recirculation))
                    .match_key("hdr.monitor.index",
                               MatchValue::exact(*reverse_mapping.get(&(mapping.rx_recirculation, app_id)).unwrap()))
                    .action("ingress.p4tg.make_digest_and_forward")
                    .action_data("e_port", mapping.tx_recirculation) // forward to TX path
                    .action_data("index", *reverse_mapping.get(&(mapping.tx_recirculation, app_id + 1)).unwrap()); // next app id

                forward_requests.push(req);

                // create mapping for P4TG traffic in egress to correct
                // L2 index for individual stream monitoring
                let req = table::Request::new(MONITORING_EGRESS_TABLE)
                    .match_key("eg_intr_md.egress_port", MatchValue::exact(mapping.tx_recirculation))
                    .match_key("hdr.path.app_id", MatchValue::exact(app_id))
                    .match_key("hdr.path.dst_port", MatchValue::exact(P4TG_DST_PORT))
                    .action("egress.monitor_stream_rate")
                    .action_data("idx", *reverse_mapping.get(&(mapping.tx_recirculation, app_id)).unwrap());

                egress_monitoring_requests.push(req);

                // create mapping for P4TG traffic in egress to correct
                // L2 index for individual stream monitoring
                let req = table::Request::new(MONITORING_EGRESS_TABLE)
                    .match_key("eg_intr_md.egress_port", MatchValue::exact(mapping.rx_recirculation))
                    .match_key("hdr.path.app_id", MatchValue::exact(app_id))
                    .match_key("hdr.path.dst_port", MatchValue::exact(P4TG_DST_PORT))
                    .action("egress.monitor_stream_rate")
                    .action_data("idx", *reverse_mapping.get(&(mapping.rx_recirculation, app_id)).unwrap());

                egress_monitoring_requests.push(req);
            }
        }

        // write table entries
        init_requests.append(&mut forward_requests);
        init_requests.append(&mut egress_monitoring_requests);

        switch.write_table_entries(init_requests).await?;

        Ok(return_mapping)
    }

    /// This method configures the default forwarding paths.
    /// Packets received on a front panel port are first forwarded to its respective RX recirculation port.
    /// Packets received on a TX recirculation port are forwarded to the respective front panel port to "leave" the switch.
    ///
    /// # Arguments
    ///
    /// * `port_mapping`: Mapping of front panel port to TX / RX recirculation port
    pub async fn configure_default_forwarding_path(&self, switch: &SwitchConnection,
                                              port_mapping: &HashMap<u32, PortMapping>) -> Result<(), RBFRTError> {
        // clear previous state
        switch.clear_table(DEFAULT_FORWARD_TABLE).await?;

        let mut forwarding_req = vec![];

        for (port, mapping) in port_mapping {
            // received packets from front panel ports are sent to RX recirculation port
            // this is done to collect statistics in the data plane
            let req = table::Request::new(DEFAULT_FORWARD_TABLE)
                .match_key("ig_intr_md.ingress_port", MatchValue::exact(*port))
                .action("ingress.p4tg.port_forward")
                .action_data("e_port", mapping.rx_recirculation);

            forwarding_req.push(req);

            // received packets on TX recirculation are sent to out port
            // the packet "leaves" the switch that way
            // when the traffic generation is configured, packets are sent to the TX recirculation port for statistic collection
            // and will finally leave the switch due to this rule
            let req = table::Request::new(DEFAULT_FORWARD_TABLE)
                .match_key("ig_intr_md.ingress_port", MatchValue::exact(mapping.tx_recirculation))
                .action("ingress.p4tg.port_forward")
                .action_data("e_port", *port);

            forwarding_req.push(req);
        }

        switch.write_table_entries(forwarding_req).await?;

        Ok(())
    }

    /// Configures the egress rules of the switch.
    ///
    /// # Arguments
    ///
    /// * `port_mapping`: Mapping of front panel port to TX / RX recirculation port
    pub async fn configure_egress_rules(&self, switch: &SwitchConnection, port_mapping: &HashMap<u32, PortMapping>) -> Result<(), RBFRTError> {
        let mut is_egress_requests = vec![];
        let mut is_tx_recirc_requests = vec![];

        for (port, mapping) in port_mapping {
            // this table is used to detect if we are on the "final" TX port that leaves the switch, i.e., a front panel port
            // that is used for traffic generation.
            // In that case we set the TX timestamp to get most accurate RTTs
            let req = Request::new(IS_EGRESS_TABLE)
                .match_key("eg_intr_md.egress_port", MatchValue::exact(*port))
                .action("egress.set_tx");

            is_egress_requests.push(req);

            // this table is used to detect if we are on a TX recirculation port
            // this is the case for recent generated packets
            // these packets are "larger" than regular packets because they contain a packet generation header
            // we need to remove the bytes of the generation header in the statistic collection
            let req = table::Request::new(IS_TX_EGRESS_TABLE)
                .match_key("eg_intr_md.egress_port", MatchValue::exact(mapping.tx_recirculation))
                .action("egress.no_action");

            is_tx_recirc_requests.push(req);
        }

        switch.write_table_entries(is_egress_requests).await?;
        switch.write_table_entries(is_tx_recirc_requests).await?;

        Ok(())
    }


    /// Deactivates all traffic gen applications except for the monitoring.
    pub async fn stop(&mut self, switch: &SwitchConnection) -> Result<(), RBFRTError> {
        self.deactivate_traffic_gen_applications(switch).await?;
        self.reset_tables(switch).await?;
        self.running = false;

        Ok(())
    }

    /// Deactivates all traffic gen applications except for the monitoring.
    async fn deactivate_traffic_gen_applications(&self, switch: &SwitchConnection) -> Result<(), RBFRTError> {
        // app id 0 is monitoring packet
        // keep monitoring running
        let app_ids: Vec<u8> = (1..8).collect();

        let update_requests: Vec<Request> = app_ids.iter().map(|x| table::Request::new(if self.is_tofino2 {APP_CFG_TF2} else {APP_CFG})
            .match_key("app_id", MatchValue::exact(*x))
            .action("trigger_timer_periodic")
            .action_data("app_enable", false))
            .collect();

        switch.update_table_entries(update_requests).await?;

        Ok(())
    }

    /// Activate the traffic generation for the given packets.
    ///
    /// # Arguments
    ///
    /// * `packets`: List of packets that should be generated. Index is the application id.
    pub async fn activate_traffic_gen_applications(&self, switch: &SwitchConnection, packets: &HashMap<u8, StreamPacket>) -> Result<(), RBFRTError> {
        let mut update_requests: Vec<Request> = packets.iter()
            .map(|(_, packet)| table::Request::new(if self.is_tofino2 {APP_CFG_TF2} else {APP_CFG})
            .match_key("app_id", MatchValue::exact(packet.app_id))
            .action("trigger_timer_periodic")
            .action_data("app_enable", true)
            .action_data("pkt_len", packet.bytes.len() as u32)
            .action_data("timer_nanosec", packet.timer)
            .action_data("packets_per_batch_cfg", packet.n_packets - 1)
            .action_data("pipe_local_source_port", if self.is_tofino2 {TG_PIPE_PORTS_TF2[0]} else {TG_PIPE_PORTS[0]}) // traffic gen port
            .action_data("pkt_buffer_offset", packet.buffer_offset.unwrap())).collect();

        if self.is_tofino2 {
            update_requests = update_requests.into_iter().map(|req|
                req.action_data("assigned_chnl_id", TG_PIPE_PORTS_TF2[0])
            ).collect();
        }

        switch.update_table_entries(update_requests).await?;

        Ok(())
    }

    /// This method is called by the REST API and completes the whole setup for the traffic generation.
    ///
    /// # Arguments
    ///
    /// * `state`: App state that contains various other objects that configure parts of the switch
    /// * `streams`: List of streams that should be configured
    /// * `mode`: Generation mode that should be used.
    /// * `stream_settings`: List of stream settings that should be applied
    /// * `tx_rx_mapping`: Mapping of TX port to expected RX port from the REST API. This is only relevant for the ANALYZE mode.
    pub async fn start_traffic_generation(&mut self,
                                          state: &AppState,
                                          streams: Vec<Stream>,
                                          mode: GenerationMode,
                                          stream_settings: Vec<StreamSetting>,
                                          tx_rx_mapping: &HashMap<u32, u32>) -> Result<Vec<Stream>, RBFRTError> {
        let switch = &state.switch;
        let port_mapping = &state.port_mapping;

        // first stop possible existing generation
        self.stop(switch).await?;
        self.reset_tables(switch).await?;

        // first reset all stats
        state.frame_size_monitor.lock().await.on_reset(switch).await?;
        state.frame_type_monitor.lock().await.on_reset(switch).await?;
        state.rate_monitor.lock().await.on_reset(switch).await?;

        // call the on_start routine on all relevant parts
        state.frame_size_monitor.lock().await.on_start(switch, &mode).await?;
        state.frame_type_monitor.lock().await.on_start(switch, &mode).await?;
        state.rate_monitor.lock().await.on_start(switch, &mode).await?;

        // configure tg mode
        self.configure_traffic_gen_mode_table(switch, &mode).await?;

        // configure default forwarding
        // this pushes rules for RX -> RX Recirc and TX Recirc -> TX
        self.configure_default_forwarding_path(switch, &state.port_mapping).await?;

        // if rate is higher than [TWO_PIPE_GENERATION_THRESHOLD] we generate on multiple pipes
        let total_rate: f32 = streams.iter().map(|x| x.traffic_rate).sum();
        let timeout_factor: u32 = if total_rate >= TWO_PIPE_GENERATION_THRESHOLD {
            if self.is_tofino2 {TG_PIPE_PORTS_TF2.to_vec()} else {TG_PIPE_PORTS.to_vec()}.len() as u32
        } else { 1 };

        // calculate sending behaviour via ILP optimization
        // further adds number of packets per time to the stream
        let mut active_streams: Vec<Stream> = streams.into_iter().map(|mut s| {
            let encapsulation_overhead = calculate_overhead(&s);

            // preamble + inter frame gap (IFG) = 20 bytes
            let encapsulation_overhead = encapsulation_overhead + 20;

            // traffic rate has MPPS semantics
            // rewrite traffic rate to reflect MPPS in Gbps
            if mode == GenerationMode::Mpps {
                // recompute "correct" traffic rate in Gbps
                s.traffic_rate = (s.frame_size + encapsulation_overhead) as f32 * 8f32 * s.traffic_rate / 1000f32;
            }

            // call solver
            let (n_packets, timeout) = calculate_send_behaviour(s.frame_size + encapsulation_overhead, s.traffic_rate, s.burst);
            let rate = ((n_packets as u32) * (s.frame_size + encapsulation_overhead) * 8) as f64 / timeout as f64;
            let rate_accuracy = 100f32 * (1f32 - ((s.traffic_rate - (rate as f32)).abs() / s.traffic_rate));

            info!("Calculated traffic generation for stream #{}. #{} packets per {} ns. Rate: {} Gbps. Accuracy: {:.2}%.", s.app_id, n_packets, timeout, rate, rate_accuracy);

            // add calculated values to the stream
            s.n_packets = Some(n_packets);
            s.timeout = Some(timeout * timeout_factor);
            s.generation_accuracy = Some(rate_accuracy);
            s.n_pipes = Some(timeout_factor as u8);

            s
        }).collect();

        // poisson mode
        // send with full capacity and then randomly drop in data plane to get geometric IAT distribution
        if mode == GenerationMode::Poisson {
            // send with full capacity
            let stream = active_streams.get_mut(0).ok_or(P4TGError::Error {message: "Configuration error.".to_owned()})?;
            let encap_overhead = 20 + calculate_overhead(stream);

            let (n_packets, timeout) = calculate_send_behaviour(stream.frame_size + encap_overhead, if self.is_tofino2 {TG_MAX_RATE_TF2} else {TG_MAX_RATE}, 25);
            active_streams.get_mut(0).ok_or(P4TGError::Error {message: "Configuration error.".to_owned()})?.n_packets = Some(n_packets);
            active_streams.get_mut(0).ok_or(P4TGError::Error {message: "Configuration error.".to_owned()})?.timeout = Some(timeout * timeout_factor);
        }

        // calculate the required multicast ports for a stream
        // this mapping will contain StreamId -> Set of egress ports
        let mut stream_to_ports: HashMap<u8, HashSet<u32>> = HashMap::new();

        for stream in &stream_settings {
            let out_port = port_mapping.get(&stream.port).unwrap().tx_recirculation;
            stream_to_ports.entry(stream.stream_id).or_default().insert(out_port);
        }

        // delete and create simple multicast group for each stream
        for stream in &active_streams {
            let _ = delete_simple_multicast_group(switch, stream.app_id as u16).await;
            let ports = stream_to_ports.get(&stream.stream_id).unwrap().clone().into_iter().collect::<Vec<_>>();

            create_simple_multicast_group(switch, stream.app_id as u16, &ports).await?;
        }

        let packet_bytes: Vec<StreamPacket> = active_streams.iter().map(|s| {
            let packet = create_packet(s);
            StreamPacket { app_id: s.app_id, bytes: packet, buffer_offset: None, timer: s.timeout.unwrap(), n_packets: s.n_packets.unwrap() }
        }).collect();

        // configure egress table rules
        // we dont want to rewrite tx seq and timestamp of potential
        // other P4TG traffic when we are in analyze mode
        if mode != GenerationMode::Analyze {
            // write packet content to traffic gen table
            let packet_mapping: HashMap<u8, StreamPacket> = self.configure_traffic_gen_table(switch, packet_bytes.clone()).await?;

            // write forwarding entries for newly generated stream traffic
            self.configure_traffic_gen_forwarding_table(switch, &active_streams, mode).await?;
            self.configure_egress_rules(switch, port_mapping).await?;

            // configure packet header rewrite table rules
            self.configure_packet_header_rewrite(switch, &active_streams, &stream_settings, port_mapping).await?;
            self.activate_traffic_gen_applications(switch, &packet_mapping).await?;
        }
        else {
            // configure analyze forwarding rules
            // this installs the rules RX recirc -> TX recirc s.t. packets are forwarded
            self.configure_analyze_forwarding(switch, port_mapping, tx_rx_mapping).await?;
        }

        self.running = true;

        Ok(active_streams)
    }


    /// This method configures the forwarding rules in the case of [GenerationMode::Analyze].
    /// It installs the rules for RX recirc -> TX recirc according to the `tx_rx_mapping`
    ///
    /// # Arguments
    ///
    /// * `tx_rx_mapping`: Mapping of TX port to expected RX port from the REST API. This is only relevant for the ANALYZE mode.
    /// * `port_mapping`: Mapping of front panel port to TX / RX recirculation port
    async fn configure_analyze_forwarding(&self, switch: &SwitchConnection, port_mapping: &HashMap<u32, PortMapping>, tx_rx_mapping: &HashMap<u32, u32>) -> Result<(), RBFRTError> {
        let mut reqs = vec![];

        for (tx, rx) in tx_rx_mapping {
            let rx_recirc = port_mapping.get(rx).ok_or(P4TGError::Error {message: "Incorrect configuration.".to_owned()})?.rx_recirculation;
            let tx_recirc = port_mapping.get(tx).ok_or(P4TGError::Error {message: "Incorrect configuration.".to_owned()})?.tx_recirculation;

            // received packets from front panel RX recirc ports are sent to TX recirc ports for outgoing port
            let req = table::Request::new(DEFAULT_FORWARD_TABLE)
                .match_key("ig_intr_md.ingress_port", MatchValue::exact(rx_recirc))
                .action("ingress.p4tg.port_forward")
                .action_data("e_port", tx_recirc);

            reqs.push(req);
        }

        switch.write_table_entries(reqs).await?;

        Ok(())
    }

    /// Configures the forwarding table for generated traffic.
    /// For [GenerationMode::Poisson], it also calculates the drop probability.
    async fn configure_traffic_gen_forwarding_table(&self, switch: &SwitchConnection, streams: &Vec<Stream>, mode: GenerationMode) -> Result<(), RBFRTError> {
        // first clear table
        switch.clear_table(STREAM_FORWARD_TABLE).await?;

        let mut forward_entries = vec![];

        let overall_traffic_rate: f32 = streams.iter().map(|x| x.traffic_rate).sum();

        // we generate on both pipes if the overall rate is larger than the threshold or if we do poisson traffic
        let generation_ports = if overall_traffic_rate < TWO_PIPE_GENERATION_THRESHOLD && mode != GenerationMode::Poisson {
            vec![if self.is_tofino2 {TG_PIPE_PORTS_TF2[0]} else {TG_PIPE_PORTS[0]}]
        }
        else if self.is_tofino2 {TG_PIPE_PORTS_TF2.to_vec()} else {TG_PIPE_PORTS.to_vec()};

        for s in streams {
            for port in &generation_ports {
                let rand_value = {
                    // compute drop probability for poisson traffic
                    if mode != GenerationMode::Poisson { // no poisson, dont drop
                        MatchValue::range(0, u16::MAX)
                    }
                    else {
                        let addition = 20 + calculate_overhead(s);

                        let const_iat = (s.frame_size + addition) as f32 / if self.is_tofino2 {TG_MAX_RATE_TF2} else {TG_MAX_RATE};
                        let target_iat = (s.frame_size + addition) as f32 / s.traffic_rate;

                        // that's the drop probability
                        let p = const_iat / target_iat;

                        MatchValue::range(0, (p * (u16::MAX as f32)).round() as u32)
                    }
                };

                let req = table::Request::new(STREAM_FORWARD_TABLE)
                    .match_key("ig_intr_md.ingress_port", MatchValue::exact(*port))
                    .match_key("hdr.pkt_gen.app_id", MatchValue::exact(s.app_id))
                    .match_key("ig_md.rand_value", rand_value)
                    .action("ingress.p4tg.mc_forward")
                    .action_data("mcid", s.app_id);

                forward_entries.push(req);
            }
        }

        switch.write_table_entries(forward_entries).await?;

        Ok(())
    }

    /// Configures the egress tables that rewrite the packet headers
    /// * `streams`: List of streams that should be configured
    /// * `stream_settings`: List of stream settings that should be applied
    /// * `port_mapping`: Mapping of front panel port to TX / RX recirculation port
    async fn configure_packet_header_rewrite(&self, switch: &SwitchConnection, streams: &Vec<Stream>, stream_settings: &Vec<StreamSetting>, port_mapping: &HashMap<u32, PortMapping>) -> Result<(), RBFRTError> {
        let mut reqs = vec![];

        for s in streams {
            for setting in stream_settings { // find the "correct" stream for a stream setting
                if setting.stream_id != s.stream_id || !setting.active {
                    continue;
                }

                let port = port_mapping.get(&setting.port).ok_or(P4TGError::Error { message: String::from("Port in stream settings does not exist on device.")})?;
                let src_mac = MacAddr::from_str(&setting.ethernet.eth_src).map_err(|_| P4TGError::Error { message: String::from("Source mac in stream settings not valid.")})?;
                let dst_mac = MacAddr::from_str(&setting.ethernet.eth_dst).map_err(|_| P4TGError::Error { message: String::from("Destination mac in stream settings not valid.")})?;

                let req = if s.vxlan { // we need to rewrite two Ethernet & IP headers
                    // validation method in API makes sure that setting.vxlan exists if s.vxlan is set
                    let vxlan = setting.vxlan.as_ref().unwrap();
                    let outer_src_mac = MacAddr::from_str(&vxlan.eth_src).map_err(|_| P4TGError::Error { message: String::from("VxLAN source mac in stream settings not valid.")})?;
                    let outer_dst_mac = MacAddr::from_str(&vxlan.eth_dst).map_err(|_| P4TGError::Error { message: String::from("VxLAN destination mac in stream settings not valid.")})?;

                    Request::new(ETHERNET_IP_HEADER_REPLACE_TABLE)
                        .match_key("eg_intr_md.egress_port", MatchValue::exact(port.tx_recirculation))
                        .match_key("hdr.path.app_id", MatchValue::exact(s.app_id))
                        .action("egress.header_replace.rewrite_vxlan")
                        .action_data("inner_src_mac", src_mac.as_bytes().to_vec())
                        .action_data("inner_dst_mac", dst_mac.as_bytes().to_vec())
                        .action_data("s_mask", setting.ip.ip_src_mask)
                        .action_data("d_mask", setting.ip.ip_dst_mask)
                        .action_data("inner_s_ip", setting.ip.ip_src)
                        .action_data("inner_d_ip", setting.ip.ip_dst)
                        .action_data("inner_tos", setting.ip.ip_tos)
                        .action_data("outer_src_mac", outer_src_mac.as_bytes().to_vec())
                        .action_data("outer_dst_mac", outer_dst_mac.as_bytes().to_vec())
                        .action_data("outer_s_ip", vxlan.ip_src)
                        .action_data("outer_d_ip", vxlan.ip_dst)
                        .action_data("outer_tos", vxlan.ip_tos)
                        .action_data("udp_source", vxlan.udp_source)
                        .action_data("vni", vxlan.vni)
                }
                else {
                    Request::new(ETHERNET_IP_HEADER_REPLACE_TABLE)
                        .match_key("eg_intr_md.egress_port", MatchValue::exact(port.tx_recirculation))
                        .match_key("hdr.path.app_id", MatchValue::exact(s.app_id))
                        .action("egress.header_replace.rewrite")
                        .action_data("src_mac", src_mac.as_bytes().to_vec())
                        .action_data("dst_mac", dst_mac.as_bytes().to_vec())
                        .action_data("s_mask", setting.ip.ip_src_mask)
                        .action_data("d_mask", setting.ip.ip_dst_mask)
                        .action_data("s_ip", setting.ip.ip_src)
                        .action_data("d_ip", setting.ip.ip_dst)
                        .action_data("tos", setting.ip.ip_tos)
                };

                reqs.push(req);

                if s.encapsulation == Encapsulation::QinQ {
                    // we checked in validation that vlan exists
                    let vlan = setting.vlan.clone().unwrap();

                    let req = Request::new(VLAN_HEADER_REPLACE_TABLE)
                        .match_key("eg_intr_md.egress_port", MatchValue::exact(port.tx_recirculation))
                        .match_key("hdr.path.app_id", MatchValue::exact(s.app_id))
                        .action("egress.header_replace.rewrite_q_in_q")
                        .action_data("outer_pcp", vlan.pcp)
                        .action_data("outer_dei", vlan.dei)
                        .action_data("outer_vlan_id", vlan.vlan_id)
                        .action_data("inner_pcp", vlan.inner_pcp)
                        .action_data("inner_dei", vlan.inner_dei)
                        .action_data("inner_vlan_id", vlan.inner_vlan_id);

                    reqs.push(req);
                }
                else if s.encapsulation == Encapsulation::Vlan {
                    // we checked in validation that vlan exists
                    let vlan = setting.vlan.clone().unwrap();

                    let req = Request::new(VLAN_HEADER_REPLACE_TABLE)
                        .match_key("eg_intr_md.egress_port", MatchValue::exact(port.tx_recirculation))
                        .match_key("hdr.path.app_id", MatchValue::exact(s.app_id))
                        .action("egress.header_replace.rewrite_vlan")
                        .action_data("pcp", vlan.pcp)
                        .action_data("dei", vlan.dei)
                        .action_data("vlan_id", vlan.vlan_id);

                    reqs.push(req);
                }
                else if s.encapsulation == Encapsulation::Mpls {
                    // we checked that mpls stack exists
                    let mpls_stack = setting.mpls_stack.as_ref().unwrap();
                    let action_name: String = format!("egress.header_replace.mpls_rewrite_c.rewrite_mpls_{}", cmp::min(s.number_of_lse.unwrap(), MAX_NUM_MPLS_LABEL));

                    let mut req = Request::new(MPLS_HEADER_REPLACE_TABLE)
                        .match_key("eg_intr_md.egress_port", MatchValue::exact(port.tx_recirculation))
                        .match_key("hdr.path.app_id", MatchValue::exact(s.app_id))
                        .action(&action_name);

                    // build generic action data
                    for j in 1..cmp::min(s.number_of_lse.unwrap()+1, MAX_NUM_MPLS_LABEL+1) {
                        let lse = &mpls_stack[(j-1) as usize];

                        let label_param = format!("label{}", j);
                        let ttl_param = format!("ttl{}", j);
                        let tc_param = format!("tc{}", j);
                        req = req.action_data(&label_param, lse.label)
                                .action_data(&ttl_param, lse.ttl)
                                .action_data(&tc_param, lse.tc);
                    }

                    reqs.push(req.clone());
                }
            }
        }

        info!("Configure table {}, {}, & {}.", ETHERNET_IP_HEADER_REPLACE_TABLE, VLAN_HEADER_REPLACE_TABLE, MPLS_HEADER_REPLACE_TABLE);
        switch.write_table_entries(reqs).await?;

        Ok(())
    }

    /// Stores the byte representation of the packets in the Tofino internal table
    /// Returns a mapping of app_id to offset in internal byte table
    ///
    /// # Arguments
    ///
    /// * `packets`: List of packets that should be configured.
    async fn configure_traffic_gen_table(&self, switch: &SwitchConnection, packets: Vec<StreamPacket>) -> Result<HashMap<u8, StreamPacket>, RBFRTError> {
        let mut requests = vec![];
        let mut buffer_offset = self.min_buffer_offset;

        let mut app_to_offset = HashMap::new();

        for mut p in packets {
            let pkt_len = p.bytes.len() as u32;

            // 16B alignment for buffer_offset
            if buffer_offset % 16 != 0 {
                buffer_offset += 16 - (buffer_offset % 16);
            }

            let req = table::Request::new(if self.is_tofino2 {APP_BUFFER_CFG_TF2} else {APP_BUFFER_CFG})
                .match_key("pkt_buffer_offset", MatchValue::exact(buffer_offset))
                .match_key("pkt_buffer_size", MatchValue::exact(pkt_len))
                .action_data_repeated("buffer", vec![p.bytes.to_vec()]);

            p.buffer_offset = Some(buffer_offset);

            app_to_offset.insert(p.app_id, p);

            buffer_offset += pkt_len;

            requests.push(req);
        }

        switch.update_table_entries(requests).await?;

        Ok(app_to_offset)
    }

    /// Configures the traffic gen mode table in the data plane
    /// that is used to detect the generation mode
    async fn configure_traffic_gen_mode_table(&self, switch: &SwitchConnection, mode: &GenerationMode) -> Result<(), RBFRTError> {
        let req = Request::new(TRAFFIC_GEN_MODE)
            .match_key("ig_intr_md.ingress_port", MatchValue::lpm(0, 0))
            .action("ingress.set_mode")
            .action_data("mode", *mode as u8);

        switch.write_table_entry(req).await?;

        Ok(())
    }

    /// Clears various tables that are refilled during traffic gen setup
    async fn reset_tables(&self, switch: &SwitchConnection) -> Result<(), RBFRTError> {
        switch.clear_tables(vec![TRAFFIC_GEN_MODE, IS_EGRESS_TABLE, IS_TX_EGRESS_TABLE, VLAN_HEADER_REPLACE_TABLE, MPLS_HEADER_REPLACE_TABLE,  ETHERNET_IP_HEADER_REPLACE_TABLE, DEFAULT_FORWARD_TABLE]).await?;

        Ok(())
    }
}