use std::time::Duration;

use crate::api::traffic_gen::stop_traffic_gen;
use crate::AppState;
use axum::extract::State;
use log::info;
use std::sync::Arc;

/// Monitors the duration of a test and regularly checks if the test has been aborted.
pub async fn monitor_test_duration(state: Arc<AppState>, duration: f64) -> bool {
    let duration = Duration::from_secs_f64(duration);

    // Wait for the duration or until the experiment stops
    tokio::select! {
        _ = tokio::time::sleep(duration) => {}
        _ = async {
            while state.experiment.lock().await.running {
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        } => {
            return true;
        }
    }

    // If the test is still running, stop it
    if state.experiment.lock().await.running {
        stop_traffic_gen(State(state.clone())).await;
    }
    
    info!("Test duration reached. Stopping monitor.");
    true
}