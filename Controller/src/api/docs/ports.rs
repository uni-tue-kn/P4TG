use lazy_static::lazy_static;
use serde_json::json;
use serde_json::Value;

lazy_static! {
    pub static ref EXAMPLE_GET_1: Value = json!([
        {
            "port": 1,
            "channel": 0,
            "pid": 128,
            "n_lanes": 4,
            "speed": "BF_SPEED_100G",
            "auto_neg": "PM_AN_DEFAULT",
            "fec": "BF_FEC_TYP_NONE",
            "loopback": "BF_LPBK_NONE",
            "enable": true,
            "status": true
        },
        {
            "port": 2,
            "channel": 0,
            "pid": 136,
            "n_lanes": 4,
            "speed": "BF_SPEED_100G",
            "auto_neg": "PM_AN_DEFAULT",
            "fec": "BF_FEC_TYP_NONE",
            "loopback": "BF_LPBK_NONE",
            "enable": true,
            "status": true
        }
    ]);
    pub static ref EXAMPLE_POST_1_REQUEST: Value = json!({
        "front_panel_port": 2,
        "channel": 0,
        "speed": "BF_SPEED_100G",
        "fec": "BF_FEC_TYP_NONE",
        "auto_neg": "PM_AN_DEFAULT"
    });
}
