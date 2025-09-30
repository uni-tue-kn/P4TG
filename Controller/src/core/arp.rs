/* Copyright 2024-present University of Tuebingen, Chair of Communication Networks
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

use log::info;
use std::collections::HashMap;

use crate::PortMapping;
use rbfrt::error::RBFRTError;
use rbfrt::table::MatchValue;
use rbfrt::{table, SwitchConnection};

const ARP_REPLY_TABLE: &str = "ingress.arp.arp_reply";

const ACTION_PREFIX: &str = "ingress.arp";

/// This module handles the initialization of the `ingress.arp.arp_reply` table
/// that decides if arp requests are answered
pub struct Arp;

impl Arp {
    pub fn new() -> Arp {
        Arp {}
    }

    pub async fn init(
        &self,
        switch: &SwitchConnection,
        port_mapping: &HashMap<u32, PortMapping>,
    ) -> Result<(), RBFRTError> {
        switch.clear_table(ARP_REPLY_TABLE).await?;

        let mut reqs = vec![];

        for mapping in port_mapping.values() {
            let req = table::Request::new(ARP_REPLY_TABLE)
                .match_key(
                    "ig_intr_md.ingress_port",
                    MatchValue::exact(mapping.rx_recirculation),
                )
                .action(&format!("{ACTION_PREFIX}.answer_arp"))
                .action_data("e_port", mapping.tx_recirculation)
                .action_data("src_addr", mapping.mac.as_bytes().to_vec())
                .action_data("valid", false);

            reqs.push(req);
        }

        switch.write_table_entries(reqs).await?;

        info!("Initialized ARP reply table.");

        Ok(())
    }

    pub async fn modify_arp(
        &self,
        switch: &SwitchConnection,
        port: &PortMapping,
        active: bool,
        breakout_mode: Option<bool>,
    ) -> Result<(), RBFRTError> {
        let channels = if let Some(true) = breakout_mode {
            (0..=3).collect()
        } else {
            vec![0]
        };

        let mut requests = vec![];
        for c in channels {
            let req = table::Request::new(ARP_REPLY_TABLE)
                .match_key(
                    "ig_intr_md.ingress_port",
                    MatchValue::exact(port.rx_recirculation + c),
                )
                .action(&format!("{ACTION_PREFIX}.answer_arp"))
                .action_data("e_port", port.tx_recirculation + c)
                .action_data("src_addr", port.mac.as_bytes().to_vec())
                .action_data("valid", active);
            requests.push(req);
            info!(
                "ARP reply rule for rx port {} change to {}.",
                port.rx_recirculation + c,
                active
            );
        }

        switch.update_table_entries(requests).await?;

        Ok(())
    }
}
