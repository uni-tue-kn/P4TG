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

use rbfrt::error::RBFRTError;
use rbfrt::SwitchConnection;

use crate::core::traffic_gen_core::types::GenerationMode;
use async_trait::async_trait;

#[async_trait]
pub trait TrafficGenEvent {
    async fn on_start(
        &mut self,
        switch: &SwitchConnection,
        mode: &GenerationMode,
    ) -> Result<(), RBFRTError>;
    async fn on_stop(&self, switch: &SwitchConnection) -> Result<(), RBFRTError>;
    async fn on_reset(&mut self, switch: &SwitchConnection) -> Result<(), RBFRTError>;
}
