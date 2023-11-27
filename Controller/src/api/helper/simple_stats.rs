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

use std::cmp::max;
use std::collections::VecDeque;

pub fn average(numbers: &VecDeque<u64>) -> f64 {
    numbers.iter().sum::<u64>() as f64 / max(1, numbers.len()) as f64
}

pub fn std(numbers: &VecDeque<u64>) -> f64 {
    let mean = numbers.iter().sum::<u64>() as f64 / max(1, numbers.len()) as f64;
    let sum_of_squared_diff: f64 = numbers.iter().map(|x| f64::powf(mean - (*x as f64), 2f64)).sum();

    if numbers.len() < 2 {
        return 0f64;
    }

    // sample standard deviation
    (sum_of_squared_diff / max(1, numbers.len() - 1) as f64).sqrt()
}