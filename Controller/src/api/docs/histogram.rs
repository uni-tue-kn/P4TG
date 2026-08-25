use lazy_static::lazy_static;
use serde_json::json;

lazy_static! {
    pub static ref EXAMPLE_GET_1: String = json!({
            "1": {
                "0": {
                    "min": 1024,
                    "max": 2048,
                    "num_bins": 16
                }
            },
            "2": {
                "0": {
                    "min": 1024,
                    "max": 2048,
                    "num_bins": 16
                },
                "1": {
                    "min": 1024,
                    "max": 2048,
                    "num_bins": 16
                }
            },
            "3": {
                "0": {
                    "min": 1024,
                    "max": 2048,
                    "num_bins": 16
                }
            }
    })
    .to_string();
}
