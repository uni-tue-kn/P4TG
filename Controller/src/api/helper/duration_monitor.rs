use std::time::Duration;

use crate::api::traffic_gen::stop_traffic_gen;
use crate::AppState;
use log::info;
use std::sync::Arc;
use tokio::time::Instant;


/// Monitors the duration of a test and regularly checks if the test has been aborted.
pub async fn monitor_test_duration(state: Arc<AppState>, duration_secs: f64) -> bool {

    let deadline = Instant::now() + Duration::from_secs_f64(duration_secs);
    let mut interval = tokio::time::interval(Duration::from_millis(100));

    loop {
        interval.tick().await;

        let running = {
            let experiment = state.experiment.lock().await;
            experiment.running
        };

        if !running {
            info!("Traffic generation manually stopped.");
            return true;
        }

        if Instant::now() >= deadline {
            info!("Duration elapsed. Stopping traffic generation...");
            break;
        }
    }

    // Perform the shutdown
    {
        let tg = &state.traffic_generator;
        let switch = &state.switch;

        match tg.lock().await.stop(switch).await {
            Ok(_) => {
                info!("Traffic generation stopped after duration.");
                state.experiment.lock().await.running = false;
            }
            Err(e) => {
                log::error!("Error while stopping traffic generation: {:?}", e);
                return false;
            }
        }
    }

    true
}