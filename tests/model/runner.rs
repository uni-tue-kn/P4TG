#[path = "../api/mod.rs"]
mod api;
#[path = "../regression/mod.rs"]
mod regression;

use api::{json_get, TestResult};
use p4tg_tests::{
    api::ApiClient,
    payload::{payload_for_profile, HeaderProfile, TrafficGenPayload},
};
use rbfrt::{table, SwitchConnection};
use serde_json::{json, Value};

fn packet_sum(value: &Value) -> u64 {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|bin| bin["packets"].as_u64())
        .sum()
}

fn all_numeric_leaves_are_zero(value: &Value) -> bool {
    match value {
        Value::Object(map) => map.values().all(all_numeric_leaves_are_zero),
        Value::Array(values) => values.iter().all(all_numeric_leaves_are_zero),
        Value::Number(number) => number.as_f64() == Some(0.0),
        _ => true,
    }
}

async fn assert_data_plane(api: &ApiClient) -> TestResult {
    let online = json_get(api, "/api/online").await?;
    if online["digests_alive"] != true {
        return Err(format!("digest pipeline is not alive: {online}").into());
    }

    let running = json_get(api, "/api/trafficgen").await?;
    let running_text = running.to_string();
    for field in ["n_packets", "timeout", "generation_accuracy", "n_pipes"] {
        if !running_text.contains(field) {
            return Err(format!("GET /api/trafficgen omitted computed field {field}").into());
        }
    }

    let statistics = json_get(api, "/api/statistics").await?;
    let latest = statistics
        .as_array()
        .and_then(|values| values.last())
        .ok_or("statistics did not contain a test result")?;
    let tx = packet_sum(&latest["frame_size"]["1"]["0"]["tx"]);
    let rx = packet_sum(&latest["frame_size"]["2"]["0"]["rx"]);
    if tx == 0 || rx == 0 {
        return Err(format!("loopback counters did not grow: tx={tx}, rx={rx}").into());
    }
    if !all_numeric_leaves_are_zero(&latest["packet_loss"])
        || !all_numeric_leaves_are_zero(&latest["out_of_order"])
    {
        return Err(format!(
            "loopback reported loss/order errors: loss={}, out_of_order={}",
            latest["packet_loss"], latest["out_of_order"]
        )
        .into());
    }
    if latest["rtt_histogram"].as_object().is_none()
        || latest["iat_histogram"].as_object().is_none()
    {
        return Err("histogram objects are absent from statistics".into());
    }

    let report = api.post_json("/api/report", &json!({})).await?;
    let report_status = report.status();
    let is_pdf = report
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.starts_with("application/pdf"));
    let report_bytes = report.bytes().await?;
    if !report_status.is_success() || !is_pdf || !report_bytes.starts_with(b"%PDF") {
        return Err(format!("report endpoint did not return a PDF: {report_status}").into());
    }
    println!("ok model::loopback tx={tx} rx={rx} loss=0 out_of_order=0");
    Ok(())
}

async fn start_stop(api: &ApiClient, name: &str, payload: &Value) -> TestResult {
    let response = api.post_json("/api/trafficgen", payload).await?;
    let status = response.status();
    let body = response.text().await?;
    if !status.is_success() {
        return Err(format!("{name}: start returned {status} {body}").into());
    }
    let started: Value = serde_json::from_str(&body)
        .map_err(|error| format!("{name}: start returned invalid JSON: {error}: {body}"))?;
    let expected_streams = payload["streams"].as_array().map_or(0, Vec::len);
    if started.as_array().map_or(usize::MAX, Vec::len) != expected_streams {
        return Err(format!(
            "{name}: start returned unexpected stream count: expected {expected_streams}, got {started}"
        )
        .into());
    }
    for stream in started.as_array().into_iter().flatten() {
        for field in ["n_packets", "timeout", "generation_accuracy", "n_pipes"] {
            if stream.get(field).is_none() {
                return Err(format!("{name}: start response omitted computed {field}").into());
            }
        }
    }
    let running = json_get(api, "/api/trafficgen").await?;
    if running["name"] != payload["name"] || running["source_name"] != payload["name"] {
        return Err(
            format!("{name}: GET did not expose the running configuration: {running}").into(),
        );
    }
    let stop = api.delete("/api/trafficgen?skip=true").await?;
    if !stop.status().is_success() {
        return Err(format!("{name}: stop returned {}", stop.status()).into());
    }
    let stopped = json_get(api, "/api/trafficgen").await?;
    if stopped["message"] != "Not running." {
        return Err(format!("{name}: traffic remained active after DELETE: {stopped}").into());
    }
    println!("ok model::{name}");
    Ok(())
}

async fn exercise_headers(api: &ApiClient, rate: f64, is_tofino2: bool) -> TestResult {
    let mut profiles = vec![
        HeaderProfile::Ipv4,
        HeaderProfile::Ipv6,
        HeaderProfile::Vlan,
        HeaderProfile::QinQ,
        HeaderProfile::Mpls,
        HeaderProfile::Vxlan,
        HeaderProfile::Gtpu,
    ];
    if is_tofino2 {
        profiles.push(HeaderProfile::Srv6);
    }
    for profile in profiles {
        let payload = payload_for_profile(rate, profile);
        start_stop(api, &format!("header_{}", profile.name()), &payload).await?;
    }
    Ok(())
}

async fn assert_bfrt_table_read() -> TestResult {
    let switch = SwitchConnection::builder("127.0.0.1", 50052)
        .device_id(0)
        .client_id(99)
        .p4_name("traffic_gen")
        .connect()
        .await?;
    const TABLE: &str = "ingress.p4tg.frame_type.frame_type_monitor";
    if !switch.has_table(TABLE) {
        return Err(format!("BfRt schema is missing {TABLE}").into());
    }
    switch.get_table_entries(table::Request::new(TABLE)).await?;
    println!("ok model::direct_bfrt_table_read");
    Ok(())
}

async fn exercise_modes(api: &ApiClient, rate: f64) -> TestResult {
    let base = TrafficGenPayload::valid(rate).json();

    let mut mpps = base.clone();
    mpps["mode"] = json!(2);
    mpps["streams"][0]["unit"] = json!(1);
    mpps["streams"][0]["traffic_rate"] = json!(0.00001);
    start_stop(api, "legacy_mpps", &mpps).await?;

    let mut poisson = base.clone();
    poisson["mode"] = json!(3);
    start_stop(api, "poisson", &poisson).await?;

    let mut per_stream = base.clone();
    per_stream["rx_mapping_mode"] = json!("per_stream");
    per_stream["port_tx_rx_mapping"] = json!({});
    per_stream["stream_settings"][0]["rx_target"] = json!({"port": 2, "channel": 0});
    start_stop(api, "per_stream_rx_mapping", &per_stream).await?;

    let mut multiple = base.clone();
    let mut setting = multiple["stream_settings"][0].clone();
    setting["stream_id"] = json!(2);
    multiple["stream_settings"]
        .as_array_mut()
        .unwrap()
        .push(setting);
    let mut stream = multiple["streams"][0].clone();
    stream["stream_id"] = json!(2);
    stream["app_id"] = json!(2);
    multiple["streams"].as_array_mut().unwrap().push(stream);
    start_stop(api, "multiple_streams", &multiple).await?;

    let mut analyze = base;
    analyze["mode"] = json!(4);
    analyze["streams"] = json!([]);
    analyze["stream_settings"] = json!([]);
    start_stop(api, "analyze", &analyze).await?;
    Ok(())
}

#[tokio::main]
async fn main() -> TestResult {
    let base_url =
        std::env::var("P4TG_BASE_URL").unwrap_or_else(|_| "http://127.0.0.1:18080".into());
    let api = ApiClient::new(base_url);
    if std::env::var_os("P4TG_DIRECT_BFRT").is_some() {
        assert_bfrt_table_read().await?;
        return Ok(());
    }
    let online = json_get(&api, "/api/online").await?;
    let is_tofino2 = online["asic"] == "Tofino2";

    if std::env::var_os("P4TG_ASSERT_DATA_PLANE").is_some() {
        assert_data_plane(&api).await?;
        regression::validation(&api, is_tofino2, false).await?;
        // v2.8.1: rejected requests must not cancel the already running test.
        assert_data_plane(&api).await?;
    } else {
        api::endpoints_and_schema(&api).await?;
        regression::validation(&api, is_tofino2, true).await?;
        let rate = if is_tofino2 { 0.00001 } else { 0.001 };
        exercise_modes(&api, rate).await?;
        exercise_headers(&api, rate, is_tofino2).await?;
    }

    api.delete("/api/trafficgen?skip=true").await?;
    println!("all Rust black-box model tests passed");
    Ok(())
}
