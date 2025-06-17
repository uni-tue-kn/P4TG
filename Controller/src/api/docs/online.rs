use lazy_static::lazy_static;
use serde_json::json;

lazy_static!(
    pub static ref EXAMPLE_GET_1: String = json!([
        {
            "status": "online",
            "version": "2.4.0",
            "asic": "Tofino2",
            "loopback": false
        }
    ])
    .to_string();
);