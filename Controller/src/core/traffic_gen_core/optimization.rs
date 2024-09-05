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

use highs::{HighsModelStatus, Sense};
use log::warn;
use crate::core::traffic_gen_core::const_definitions::SOLVER_TIME_LIMIT_IN_SECONDS;

/// Calculates the number of packets (n) that should be sent per timeout ns limited by `max_burst`.
/// Optimized for traffic rate accuracy and burst minimization.
/// Uses highs ILP solver.
///
/// It solves the ILP
///
/// min c + n
/// s.t.
/// 0 <= c - timeout * `traffic_rate` + (n * `frame_size` * 8) <= 0
///
/// Returns (number of packets, timeout)
pub fn calculate_send_behaviour(frame_size: u32, traffic_rate: f32, max_burst: u16) -> (u16, u32) {
    let mut problem = highs::RowProblem::default();

    let accuracy = 0.001;
    let real_iat = frame_size as f32 * 8f32 / traffic_rate;
    let d = (real_iat - real_iat.floor()) / real_iat;

    let max_packets = if max_burst == 1 { 1 } else { (( d / accuracy) as u32) + 1};

    // calc + num packets for objective
    let calculation = problem.add_column(1., 0..100);
    let num_packets = problem.add_integer_column(1., 1..max_packets);

    // not part of objective, therefore factor 0
    let timeout = problem.add_integer_column(0., 1..u32::MAX); // timeout in 32bit ns

    // c1: calc - timeout * rate + (num_packets * frame_size * 8) == 0
    problem.add_row(0..1, [(calculation, 1.), (timeout, (-1f32 * traffic_rate) as f64), (num_packets, (frame_size * 8) as f64)]);
    problem.add_row(0..u32::MAX, [(calculation, 1.)]);

    let mut solver = problem.optimise(Sense::Minimise);
    solver.set_option("time_limit", SOLVER_TIME_LIMIT_IN_SECONDS);

    let solved = solver.solve();

    match solved.status() {
        HighsModelStatus::Infeasible => {
            warn!("No solution available. Requested rate {} with frame size {}", traffic_rate, frame_size);
            (0, 100)
        }
        _ => {
            let solution = solved.get_solution().columns().to_vec();
            (solution.get(1).unwrap().round() as u16, solution.get(2).unwrap().round() as u32)
        }
    }
}