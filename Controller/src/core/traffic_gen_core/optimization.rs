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

    let min_packets = if max_burst == 1 { 1 } else { 2 };
    let max_packets = if max_burst == 1 { 1 } else {((( d / accuracy) as u32) + 1).max(30)};

    // calc + num packets for objective
    let calculation = problem.add_column(1., 0..100);
    let num_packets = problem.add_integer_column(1., min_packets..max_packets);

    // Should be at least 30 ns for rate mode
    let timeout = if max_burst == 1 { problem.add_integer_column(0., 1..u32::MAX)} 
                                        else {
                                           problem.add_integer_column(1., 30..u32::MAX) }; // timeout in 32bit ns

    // 0 <= calc - timeout * rate + (num_packets * frame_size * 8) <= 1
    // Constraint is bound 0 <= ... <= 1 to overcome possible float problems.
    // Problems could arise if the float 'calculation' does not match the float of the calculated difference.
    // Therefore, 0 <= ... <= 1 should be suitable for a floating error after the comma.
    // This problem wasn't experienced yet and this solution is a safety measurement.
    problem.add_row(0..1, [(calculation, 1.), (timeout, (-1f32 * traffic_rate) as f64), (num_packets, (frame_size * 8) as f64)]); 
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

#[cfg(test)]
mod tests {
    use super::*;
    use test_case::test_matrix;

    #[test_matrix(
        [64, 128, 256, 512, 1024, 1280, 1518, 9000],
        [0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 80, 96],
        [1, 4, 10, 40, 100, 400],
        [1, 100],
        [2, 4]
    )]
    fn send_behavior_calculated_successful(
        frame_size: u32,
        encapsulation_size: u32,
        traffic_rate: u32,
        max_burst: u16,
        pipes_per_tofino: u16,
    ) {
        if pipes_per_tofino <= 4 && traffic_rate == 400 {
            return;
        }

        let final_size = frame_size + encapsulation_size + 20; // 20 byte L1 overhead
        let traffic_rate = traffic_rate as f32;
        let number_pipes = pipes_per_tofino;
        // let number_pipes = 1.0;

        let (n_packets, timeout) =
            calculate_send_behaviour(final_size, traffic_rate / number_pipes as f32, max_burst);
        assert_ne!(0, n_packets);

        let rate_l1 = (n_packets as u32 * final_size * 8) as f32 / timeout as f32 * number_pipes as f32;
        let accuracy = 1f32 - ((rate_l1 - traffic_rate).abs() / traffic_rate);
        println!("#Packets:{n_packets}, Timeout: {timeout}, Rate: {rate_l1}, Target: {traffic_rate}, Accuracy: {accuracy}");

        //match max_burst {
        //    1 => assert!(accuracy >= 0.88),
        //    _ => assert!(accuracy >= 0.98),
        //}
    }
}