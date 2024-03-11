use lazy_static::lazy_static;
use serde_json::json;

lazy_static!(
  pub static ref EXAMPLE_GET_1: String = json!([
    {
        "port": 1,
        "channel": 0,
        "pid": 128,
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
        "speed": "BF_SPEED_100G",
        "auto_neg": "PM_AN_DEFAULT",
        "fec": "BF_FEC_TYP_NONE",
        "loopback": "BF_LPBK_NONE",
        "enable": true,
        "status": true
    }
]).to_string();
);