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

//! Tracks concurrent GUI web sessions so the frontend can warn when
//! multiple users work on the same P4TG instance. A "session" is a client
//! that recently polled `/api/online` (every open GUI tab does so every
//! 5 s), identified by its `X-Session-Id` header.

use std::collections::HashMap;
use tokio::sync::Mutex;

use crate::core::unix_secs;

/// A client counts as connected while its last `/api/online` poll is at most
/// this old.
const CLIENT_TIMEOUT_SECS: u64 = 15;

/// Last-seen unix timestamps of GUI clients, keyed by the per-tab session id
/// (`X-Session-Id` header) so multiple windows behind the same IP still
/// count as separate sessions.
#[derive(Default)]
pub struct SessionTracker {
    clients: Mutex<HashMap<String, u64>>,
}

impl SessionTracker {
    /// Records a poll from `session_id` and returns the number of *other*
    /// sessions seen within the last [`CLIENT_TIMEOUT_SECS`].
    pub async fn track_and_count_others(&self, session_id: &str) -> usize {
        let now = unix_secs();
        let mut clients = self.clients.lock().await;
        clients.insert(session_id.to_owned(), now);
        clients.retain(|_, last_seen| now.saturating_sub(*last_seen) <= CLIENT_TIMEOUT_SECS);
        // The requester's own session was just inserted, so len >= 1
        clients.len().saturating_sub(1)
    }
}
