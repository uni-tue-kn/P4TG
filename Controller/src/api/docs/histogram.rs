use lazy_static::lazy_static;
use serde_json::json;

lazy_static! {
    pub static ref EXAMPLE_GET_1: String = json!({
            "1": {
                "0": {
                    "min": 1500,
                    "max": 2500,
                    "num_bins": 50
                }
            },
            "2": {
                "0": {
                    "min": 1500,
                    "max": 2500,
                    "num_bins": 10
                },
                "1": {
                    "min": 1500,
                    "max": 2500,
                    "num_bins": 10
                }
            },
            "3": {
                "0": {
                    "min": 1500,
                    "max": 2500,
                    "num_bins": 10
                }
            }
    })
    .to_string();
}
