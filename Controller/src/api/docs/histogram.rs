use lazy_static::lazy_static;
use serde_json::json;

lazy_static! {
    pub static ref EXAMPLE_GET_1: String = json!({
            "136": {
                "min": 1500,
                "max": 2500,
                "num_bins": 50
            },
            "168": {
                "min": 1500,
                "max": 2500,
                "num_bins": 10
            },
            "160": {
                "min": 1500,
                "max": 2500,
                "num_bins": 10
            },
            "192": {
                "min": 1500,
                "max": 2500,
                "num_bins": 10
            },
            "176": {
                "min": 1500,
                "max": 2500,
                "num_bins": 10
            },
            "152": {
                "min": 1500,
                "max": 2500,
                "num_bins": 10
            },
            "312": {
                "min": 1500,
                "max": 2500,
                "num_bins": 10
            },
            "144": {
                "min": 1500,
                "max": 2500,
                "num_bins": 10
            },
            "184": {
                "min": 1500,
                "max": 2500,
                "num_bins": 10
            },
            "320": {
                "min": 1500,
                "max": 2500,
                "num_bins": 10
            }
    })
    .to_string();
}
