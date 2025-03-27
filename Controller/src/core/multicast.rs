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

use rbfrt::{SwitchConnection, table};
use rbfrt::error::RBFRTError;
use rbfrt::table::MatchValue;


/// Table for multicast groups
const MULTICAST_TABLE: &str = "$pre.mgid";

/// Table for multicast nodes
const MULTICAST_NODE_TABLE: &str = "$pre.node";

/// Creates a simple multicast group.
///
/// # Arguments
///
/// * `switch`: Switch connection.
/// * `mid`: Multicast group identifier.
///     This is used as identifier in the data plane.
/// * `ports`: List of dev ports for the multicast group
pub async fn create_simple_multicast_group(switch: &SwitchConnection,
                                     mid: u16,
                                     ports: &[u32]) -> Result<(), RBFRTError> {
    // create node id
    let req = table::Request::new("$pre.node")
        .match_key("$MULTICAST_NODE_ID", MatchValue::exact(mid))
        .action_data("$MULTICAST_RID", 1)
        .action_data_repeated("$MULTICAST_LAG_ID", vec![0])
        .action_data_repeated("$DEV_PORT", ports.to_vec());

    switch.write_table_entry(req).await?;

    let req = table::Request::new("$pre.mgid")
        .match_key("$MGID", MatchValue::exact(mid))
        .action_data_repeated("$MULTICAST_NODE_ID", vec![mid])
        .action_data_repeated("$MULTICAST_NODE_L1_XID_VALID", vec![false])
        .action_data_repeated("$MULTICAST_NODE_L1_XID", vec![0]);

    switch.write_table_entry(req).await?;

    Ok(())
}

/// Deletes a simple multicast group.
///
/// # Arguments
///
/// * `switch`: Switch connection.
/// * `mid`: Multicast group identifier.
///     This is used as identifier in the data plane.
pub async fn delete_simple_multicast_group(switch: &SwitchConnection,
                                           mid: u16) -> Result<(), RBFRTError> {
    let req = table::Request::new(MULTICAST_TABLE)
        .match_key("$MGID", MatchValue::exact(mid));

    let _ = switch.delete_table_entry(req).await;

    let req = table::Request::new(MULTICAST_NODE_TABLE)
        .match_key("$MULTICAST_NODE_ID", MatchValue::exact(mid));

    let _ = switch.delete_table_entry(req).await;

    Ok(())
}