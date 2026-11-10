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
use reqwest::StatusCode;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;
use tokio::time::{sleep, Instant};

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

async fn traffic_state(api: &ApiClient) -> TestResult<(StatusCode, Value)> {
    let response = api.get("/api/trafficgen").await?;
    let status = response.status();
    let body = response.text().await?;
    let value = serde_json::from_str(&body)
        .map_err(|error| format!("trafficgen returned invalid JSON: {error}: {body}"))?;
    Ok((status, value))
}

async fn wait_for_traffic_state<F>(
    api: &ApiClient,
    label: &str,
    timeout: Duration,
    predicate: F,
) -> TestResult<Value>
where
    F: Fn(StatusCode, &Value) -> bool,
{
    let deadline = Instant::now() + timeout;
    loop {
        let (status, value) = traffic_state(api).await?;
        if predicate(status, &value) {
            return Ok(value);
        }
        if Instant::now() >= deadline {
            return Err(
                format!("timed out waiting for {label}; last state was {status} {value}").into(),
            );
        }
        sleep(Duration::from_millis(100)).await;
    }
}

async fn start_payload(api: &ApiClient, label: &str, payload: &Value) -> TestResult<Value> {
    let response = api.post_json("/api/trafficgen", payload).await?;
    let status = response.status();
    let body = response.text().await?;
    if !status.is_success() {
        return Err(format!("{label}: start returned {status} {body}").into());
    }
    serde_json::from_str(&body)
        .map_err(|error| format!("{label}: start returned invalid JSON: {error}: {body}").into())
}

fn named_payload(rate: f64, name: &str, duration: u64, repetitions: u32) -> Value {
    let mut payload = TrafficGenPayload::valid(rate).json();
    payload["name"] = json!(name);
    payload["duration"] = json!(duration);
    payload["repetitions"] = json!(repetitions);
    payload
}

fn result_names(results: &Value) -> Vec<&str> {
    results
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|result| result["name"].as_str())
        .collect()
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

fn startup_port_config(
    speed: &str,
    fec: &str,
    channel_count: u8,
    first_recirculation: (u32, u32),
    second_recirculation: (u32, u32),
) -> Value {
    json!({
        "tg_ports": [
            {
                "port": 1,
                "mac": "02:00:00:00:00:01",
                "speed": speed,
                "fec": fec,
                "auto_negotiation": "PM_AN_DEFAULT",
                "channel_count": channel_count,
                "recirculation_ports": {
                    "tx_port": first_recirculation.0,
                    "rx_port": first_recirculation.1
                }
            },
            {
                "port": 2,
                "mac": "02:00:00:00:00:11",
                "speed": speed,
                "fec": fec,
                "auto_negotiation": "PM_AN_DEFAULT",
                "channel_count": channel_count,
                "recirculation_ports": {
                    "tx_port": second_recirculation.0,
                    "rx_port": second_recirculation.1
                }
            }
        ]
    })
}

fn controller_command(workdir: &PathBuf, port: u16) -> Command {
    let mut command = Command::new("/app/p4tg-controller");
    command
        .current_dir(workdir)
        .env("P4_NAME", "traffic_gen")
        .env("NUM_PORTS", "6")
        .env("P4TG_PORT", port.to_string())
        .env("P4TG_EXTERNAL_RECIRCULATION", "1")
        .env("RUST_LOG", "warn,p4tg_controller=info")
        .kill_on_drop(true);
    command
}

async fn assert_valid_breakout_startup(
    label: &str,
    config: Value,
    expected_channels: &[u64],
) -> TestResult {
    let workdir = PathBuf::from(format!(
        "/tmp/p4tg-ci-breakout-{}-{label}",
        std::process::id(),
    ));
    std::fs::create_dir_all(&workdir)?;
    std::fs::write(workdir.join("config.json"), serde_json::to_vec(&config)?)?;

    let mut child = controller_command(&workdir, 18081)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    let api = ApiClient::new("http://127.0.0.1:18081");
    let deadline = Instant::now() + Duration::from_secs(20);
    let ports = loop {
        if child.try_wait()?.is_some() {
            let _ = std::fs::remove_dir_all(&workdir);
            return Err(format!("{label}: controller exited before becoming ready").into());
        }
        if let Ok(response) = api.get("/api/ports").await {
            if response.status().is_success() {
                break response.json::<Value>().await?;
            }
        }
        if Instant::now() >= deadline {
            let _ = child.kill().await;
            let _ = child.wait().await;
            let _ = std::fs::remove_dir_all(&workdir);
            return Err(format!("{label}: controller did not become ready").into());
        }
        sleep(Duration::from_millis(100)).await;
    };
    child.kill().await?;
    child.wait().await?;
    std::fs::remove_dir_all(&workdir)?;

    let expected: std::collections::BTreeSet<u64> = expected_channels.iter().copied().collect();
    for port_number in 1..=6 {
        let actual: std::collections::BTreeSet<u64> = ports
            .as_array()
            .into_iter()
            .flatten()
            .filter(|port| port["port"] == port_number)
            .filter_map(|port| port["channel"].as_u64())
            .collect();
        if actual != expected {
            return Err(format!(
                "{label}: port {port_number} channels were {actual:?}, expected {expected:?}"
            )
            .into());
        }
    }
    println!("ok startup_config::{label}");
    Ok(())
}

async fn assert_invalid_startup(label: &str, config: Value, needle: &str) -> TestResult {
    let workdir = PathBuf::from(format!(
        "/tmp/p4tg-ci-invalid-config-{}-{label}",
        std::process::id(),
    ));
    std::fs::create_dir_all(&workdir)?;
    std::fs::write(workdir.join("config.json"), serde_json::to_vec(&config)?)?;

    let child = controller_command(&workdir, 18081)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let output = match tokio::time::timeout(Duration::from_secs(15), child.wait_with_output()).await
    {
        Ok(output) => output?,
        Err(_) => {
            let _ = std::fs::remove_dir_all(&workdir);
            return Err(format!("{label}: controller did not reject invalid config").into());
        }
    };
    std::fs::remove_dir_all(&workdir)?;
    if output.status.success() {
        return Err(format!("{label}: fatal controller startup error exited successfully").into());
    }
    let logs = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    if !logs.contains(needle) {
        return Err(format!("{label}: expected {needle:?} in controller logs: {logs}").into());
    }
    println!("ok startup_config::{label}");
    Ok(())
}

async fn assert_breakout_and_manual_recirculation_startup() -> TestResult {
    let is_tofino2 = std::env::var("P4TG_TARGET").as_deref() == Ok("tofino2");
    if is_tofino2 {
        assert_valid_breakout_startup(
            "tofino2_two_way_breakout",
            startup_port_config(
                "BF_SPEED_200G",
                "BF_FEC_TYP_REED_SOLOMON",
                2,
                (3, 4),
                (5, 6),
            ),
            &[0, 4],
        )
        .await?;
        assert_valid_breakout_startup(
            "tofino2_eight_way_breakout",
            startup_port_config("BF_SPEED_50G", "BF_FEC_TYP_REED_SOLOMON", 8, (3, 4), (5, 6)),
            &[0, 1, 2, 3, 4, 5, 6, 7],
        )
        .await?;
    } else {
        assert_valid_breakout_startup(
            "tofino_two_way_breakout",
            startup_port_config("BF_SPEED_50G", "BF_FEC_TYP_NONE", 2, (3, 4), (5, 6)),
            &[0, 2],
        )
        .await?;
    }

    let (speed, fec) = if is_tofino2 {
        ("BF_SPEED_100G", "BF_FEC_TYP_REED_SOLOMON")
    } else {
        ("BF_SPEED_25G", "BF_FEC_TYP_NONE")
    };
    assert_invalid_startup(
        "duplicate_manual_recirculation_rejected",
        startup_port_config(speed, fec, 4, (3, 4), (3, 4)),
        "Recirculation port 3 is used more than once",
    )
    .await?;
    assert_invalid_startup(
        "traffic_port_recirculation_overlap_rejected",
        startup_port_config(speed, fec, 4, (2, 4), (5, 6)),
        "Recirculation port 2 is also configured as a traffic-generation port",
    )
    .await?;
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

async fn duration_and_drain_lifecycle(api: &ApiClient, rate: f64) -> TestResult {
    let mut payload = named_payload(rate, "duration drain", 1, 1);
    payload["drain_duration_secs"] = json!(1);
    start_payload(api, "duration drain", &payload).await?;

    wait_for_traffic_state(
        api,
        "duration monitor to enter drain",
        Duration::from_secs(10),
        |status, value| status == StatusCode::OK && value["draining"] == true,
    )
    .await?;
    wait_for_traffic_state(
        api,
        "duration monitor to terminate",
        Duration::from_secs(10),
        |status, value| status == StatusCode::ACCEPTED && value["message"] == "Not running.",
    )
    .await?;

    let statistics = json_get(api, "/api/statistics").await?;
    if !result_names(&statistics).contains(&"duration drain") {
        return Err(format!("duration-completed result was not retained: {statistics}").into());
    }
    println!("ok lifecycle::duration_auto_stop_and_drain");
    Ok(())
}

async fn duration_monitor_replacement(api: &ApiClient, rate: f64) -> TestResult {
    let no_deadline = named_payload(rate, "no duration deadline", 0, 1);
    start_payload(api, "no duration deadline", &no_deadline).await?;
    sleep(Duration::from_millis(1200)).await;
    let (status, state) = traffic_state(api).await?;
    if status != StatusCode::OK || state["name"] != "no duration deadline" {
        return Err(format!("duration=0 stopped unexpectedly: {status} {state}").into());
    }
    let stop = api.delete("/api/trafficgen").await?;
    if !stop.status().is_success() {
        return Err(format!("explicit stop for duration=0 returned {}", stop.status()).into());
    }

    let old = named_payload(rate, "replaced duration", 1, 1);
    start_payload(api, "replaced duration", &old).await?;
    sleep(Duration::from_millis(300)).await;
    let replacement = named_payload(rate, "replacement survives", 10, 1);
    start_payload(api, "replacement survives", &replacement).await?;
    sleep(Duration::from_millis(1200)).await;
    let (status, state) = traffic_state(api).await?;
    if status != StatusCode::OK || state["name"] != "replacement survives" {
        return Err(format!("stale duration monitor stopped replacement: {status} {state}").into());
    }
    let stop = api.delete("/api/trafficgen").await?;
    if !stop.status().is_success() {
        return Err(format!("replacement stop returned {}", stop.status()).into());
    }
    println!("ok lifecycle::duration_zero_and_monitor_replacement");
    Ok(())
}

async fn multiple_test_lifecycle(api: &ApiClient, rate: f64) -> TestResult {
    let first = named_payload(rate, "multi first", 1, 2);
    let second = named_payload(rate, "multi second", 1, 1);
    let started = start_payload(api, "multiple tests", &json!([first, second])).await?;
    if started.as_array().map_or(0, Vec::len) != 2 {
        return Err(format!("multiple-test POST returned unexpected payload: {started}").into());
    }

    for (expected_name, expected_source) in [
        ("multi first [1/2]", "multi first"),
        ("multi first [2/2]", "multi first"),
        ("multi second", "multi second"),
    ] {
        let state = wait_for_traffic_state(
            api,
            expected_name,
            Duration::from_secs(12),
            |status, value| status == StatusCode::OK && value["name"] == expected_name,
        )
        .await?;
        if state["source_name"] != expected_source {
            return Err(format!(
                "{expected_name}: source_name was {}, expected {expected_source}",
                state["source_name"]
            )
            .into());
        }
        if expected_name != "multi second" {
            wait_for_traffic_state(
                api,
                &format!("cooldown after {expected_name}"),
                Duration::from_secs(12),
                |status, value| status == StatusCode::OK && value["cooldown"] == true,
            )
            .await?;
        }
    }

    wait_for_traffic_state(
        api,
        "multiple-test completion",
        Duration::from_secs(12),
        |status, value| status == StatusCode::ACCEPTED && value["message"] == "Not running.",
    )
    .await?;

    for path in ["/api/statistics", "/api/time_statistics"] {
        let results = json_get(api, path).await?;
        let names = result_names(&results);
        for expected in ["multi first [1/2]", "multi first [2/2]", "multi second"] {
            if !names.contains(&expected) {
                return Err(format!("{path} omitted {expected}: {names:?}").into());
            }
        }
        if names.len() != 3 {
            return Err(format!("{path} duplicated or lost multi-test results: {names:?}").into());
        }
    }
    println!("ok lifecycle::multiple_tests_and_repetitions");
    Ok(())
}

async fn skip_and_cancel_lifecycle(api: &ApiClient, rate: f64) -> TestResult {
    let first = named_payload(rate, "skip first", 10, 1);
    let second = named_payload(rate, "skip second", 10, 1);
    start_payload(api, "skip sequence", &json!([first, second])).await?;
    wait_for_traffic_state(
        api,
        "first skippable run",
        Duration::from_secs(10),
        |status, value| status == StatusCode::OK && value["name"] == "skip first",
    )
    .await?;

    let mut invalid = named_payload(rate, "invalid during sequence", 1, 1);
    invalid["streams"][0]["app_id"] = json!(0);
    let rejected = api.post_json("/api/trafficgen", &invalid).await?;
    if rejected.status() != StatusCode::BAD_REQUEST {
        return Err(format!(
            "invalid request during sequence returned {}",
            rejected.status()
        )
        .into());
    }
    let (status, state) = traffic_state(api).await?;
    if status != StatusCode::OK || state["name"] != "skip first" {
        return Err(
            format!("rejected request cancelled multi-test sequence: {status} {state}").into(),
        );
    }

    let skip = api.delete("/api/trafficgen?skip=true").await?;
    if !skip.status().is_success() {
        return Err(format!("skip current test returned {}", skip.status()).into());
    }
    wait_for_traffic_state(
        api,
        "second run after skip",
        Duration::from_secs(12),
        |status, value| status == StatusCode::OK && value["name"] == "skip second",
    )
    .await?;

    let stop = api.delete("/api/trafficgen").await?;
    if !stop.status().is_success() {
        return Err(format!("stop sequence returned {}", stop.status()).into());
    }
    wait_for_traffic_state(
        api,
        "sequence cancellation",
        Duration::from_secs(5),
        |status, value| status == StatusCode::ACCEPTED && value["message"] == "Not running.",
    )
    .await?;
    sleep(Duration::from_millis(500)).await;
    let (status, state) = traffic_state(api).await?;
    if status != StatusCode::ACCEPTED || state["message"] != "Not running." {
        return Err(format!("cancelled sequence restarted unexpectedly: {status} {state}").into());
    }
    let repeated_stop = api.delete("/api/trafficgen").await?;
    if !repeated_stop.status().is_success() {
        return Err(format!("repeated idle stop returned {}", repeated_stop.status()).into());
    }
    println!("ok lifecycle::skip_advances_and_stop_cancels");
    Ok(())
}

async fn cancel_during_cooldown(api: &ApiClient, rate: f64) -> TestResult {
    let first = named_payload(rate, "cooldown first", 1, 1);
    let second = named_payload(rate, "cooldown must not start", 10, 1);
    start_payload(api, "cooldown cancellation", &json!([first, second])).await?;
    wait_for_traffic_state(
        api,
        "multi-test cooldown",
        Duration::from_secs(12),
        |status, value| status == StatusCode::OK && value["cooldown"] == true,
    )
    .await?;

    let stop = api.delete("/api/trafficgen").await?;
    if !stop.status().is_success() {
        return Err(format!("stop during cooldown returned {}", stop.status()).into());
    }
    sleep(Duration::from_millis(3500)).await;
    let (status, state) = traffic_state(api).await?;
    if status != StatusCode::ACCEPTED || state["message"] != "Not running." {
        return Err(format!("test advanced after cooldown cancellation: {status} {state}").into());
    }
    let statistics = json_get(api, "/api/statistics").await?;
    let names = result_names(&statistics);
    if names.contains(&"cooldown must not start") {
        return Err(format!("cancelled cooldown started the next test: {names:?}").into());
    }
    println!("ok lifecycle::cancel_during_cooldown");
    Ok(())
}

async fn restart_lifecycle(api: &ApiClient, rate: f64) -> TestResult {
    let response = api.get("/api/restart").await?;
    let status = response.status();
    let body = response.text().await?;
    if status != StatusCode::BAD_REQUEST || !body.contains("Nothing to restart") {
        return Err(format!("idle restart returned {status} {body}").into());
    }
    println!("ok lifecycle::restart_rejects_idle_controller");

    let payload = named_payload(rate, "restart duration", 2, 1);
    start_payload(api, "restart duration", &payload).await?;
    sleep(Duration::from_millis(1200)).await;
    let response = api.get("/api/restart").await?;
    let status = response.status();
    let body = response.text().await?;
    if status != StatusCode::OK {
        return Err(format!("active restart returned {status} {body}").into());
    }
    let restarted: Value = serde_json::from_str(&body)
        .map_err(|error| format!("active restart returned invalid JSON: {error}: {body}"))?;
    if restarted.as_array().map_or(0, Vec::len) != 1 {
        return Err(format!("active restart returned unexpected streams: {restarted}").into());
    }

    // The original deadline expires during this wait. The restarted duration
    // monitor must own a fresh deadline and keep the replacement run alive.
    sleep(Duration::from_millis(1100)).await;
    let (status, state) = traffic_state(api).await?;
    if status != StatusCode::OK || state["name"] != "restart duration" {
        return Err(format!("old deadline stopped restarted traffic: {status} {state}").into());
    }
    wait_for_traffic_state(
        api,
        "restarted duration monitor completion",
        Duration::from_secs(5),
        |status, value| status == StatusCode::ACCEPTED && value["message"] == "Not running.",
    )
    .await?;
    println!("ok lifecycle::restart_resets_duration_deadline");

    let first = named_payload(rate, "restart multi first", 2, 1);
    let second = named_payload(rate, "restart multi second", 1, 1);
    start_payload(api, "restart multi sequence", &json!([first, second])).await?;
    wait_for_traffic_state(
        api,
        "restartable multi-test run",
        Duration::from_secs(8),
        |status, value| status == StatusCode::OK && value["name"] == "restart multi first",
    )
    .await?;
    let response = api.get("/api/restart").await?;
    if response.status() != StatusCode::OK {
        let status = response.status();
        let body = response.text().await?;
        return Err(format!("multi-test restart returned {status} {body}").into());
    }
    wait_for_traffic_state(
        api,
        "second run after multi-test restart",
        Duration::from_secs(12),
        |status, value| status == StatusCode::OK && value["name"] == "restart multi second",
    )
    .await?;
    wait_for_traffic_state(
        api,
        "restarted multi-test completion",
        Duration::from_secs(8),
        |status, value| status == StatusCode::ACCEPTED && value["message"] == "Not running.",
    )
    .await?;
    for path in ["/api/statistics", "/api/time_statistics"] {
        let results = json_get(api, path).await?;
        let names = result_names(&results);
        if names.len() != 2
            || names
                .iter()
                .filter(|name| **name == "restart multi first")
                .count()
                != 1
            || names
                .iter()
                .filter(|name| **name == "restart multi second")
                .count()
                != 1
        {
            return Err(format!("{path} lost or duplicated restarted runs: {names:?}").into());
        }
    }
    println!("ok lifecycle::restart_preserves_multi_test_sequence");
    Ok(())
}

async fn assert_result_names(api: &ApiClient, expected: &[&str], context: &str) -> TestResult {
    for path in ["/api/statistics", "/api/time_statistics"] {
        let results = json_get(api, path).await?;
        let names = result_names(&results);
        if names.len() != expected.len()
            || expected.iter().any(|expected_name| {
                names.iter().filter(|name| *name == expected_name).count() != 1
            })
        {
            return Err(format!("{context}: {path} returned unexpected results: {names:?}").into());
        }
    }
    Ok(())
}

/// Unreleased: reset keeps post-reset active-run results without restoring pre-reset cooldown history.
async fn reset_history_boundary(api: &ApiClient, rate: f64) -> TestResult {
    let active_before = named_payload(rate, "active reset before", 1, 1);
    let active_current = named_payload(rate, "active reset current", 3, 1);
    let active_after = named_payload(rate, "active reset after", 1, 1);
    start_payload(
        api,
        "active reset sequence",
        &json!([active_before, active_current, active_after]),
    )
    .await?;
    wait_for_traffic_state(
        api,
        "active run before reset",
        Duration::from_secs(15),
        |status, value| status == StatusCode::OK && value["name"] == "active reset current",
    )
    .await?;
    let reset = api.get("/api/reset").await?;
    if reset.status() != StatusCode::OK {
        return Err(format!("reset during active run returned {}", reset.status()).into());
    }
    wait_for_traffic_state(
        api,
        "successor run after active reset",
        Duration::from_secs(15),
        |status, value| status == StatusCode::OK && value["name"] == "active reset after",
    )
    .await?;
    wait_for_traffic_state(
        api,
        "active-reset sequence completion",
        Duration::from_secs(8),
        |status, value| status == StatusCode::ACCEPTED && value["message"] == "Not running.",
    )
    .await?;
    assert_result_names(
        api,
        &["active reset current", "active reset after"],
        "active reset",
    )
    .await?;
    println!("ok lifecycle::reset_active_run_preserves_post_reset_result");

    let cooldown_first = named_payload(rate, "cooldown reset old", 1, 1);
    let cooldown_second = named_payload(rate, "cooldown reset new", 1, 1);
    start_payload(
        api,
        "cooldown reset sequence",
        &json!([cooldown_first, cooldown_second]),
    )
    .await?;
    // A newly spawned multi-test task briefly reports the stopped previous
    // configuration as a cooldown. First observe this sequence's initial run
    // so the following cooldown is unambiguously the boundary after it.
    wait_for_traffic_state(
        api,
        "first run before cooldown reset",
        Duration::from_secs(8),
        |status, value| {
            status == StatusCode::OK
                && value["name"] == "cooldown reset old"
                && value["cooldown"] == false
        },
    )
    .await?;
    wait_for_traffic_state(
        api,
        "cooldown before reset",
        Duration::from_secs(10),
        |status, value| status == StatusCode::OK && value["cooldown"] == true,
    )
    .await?;
    let reset = api.get("/api/reset").await?;
    if reset.status() != StatusCode::OK {
        return Err(format!("reset during cooldown returned {}", reset.status()).into());
    }
    wait_for_traffic_state(
        api,
        "post-reset run after cooldown",
        Duration::from_secs(10),
        |status, value| status == StatusCode::OK && value["name"] == "cooldown reset new",
    )
    .await?;
    wait_for_traffic_state(
        api,
        "cooldown-reset sequence completion",
        Duration::from_secs(8),
        |status, value| status == StatusCode::ACCEPTED && value["message"] == "Not running.",
    )
    .await?;
    assert_result_names(api, &["cooldown reset new"], "cooldown reset").await?;
    println!("ok lifecycle::reset_cooldown_discards_only_pre_reset_result");
    Ok(())
}

async fn exercise_orchestration(api: &ApiClient, rate: f64) -> TestResult {
    duration_and_drain_lifecycle(api, rate).await?;
    duration_monitor_replacement(api, rate).await?;
    multiple_test_lifecycle(api, rate).await?;
    skip_and_cancel_lifecycle(api, rate).await?;
    cancel_during_cooldown(api, rate).await?;
    restart_lifecycle(api, rate).await?;
    reset_history_boundary(api, rate).await?;
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
    if std::env::var_os("P4TG_ASSERT_CONFIG_VALIDATION").is_some() {
        assert_breakout_and_manual_recirculation_startup().await?;
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
        exercise_orchestration(&api, rate).await?;
    }

    api.delete("/api/trafficgen?skip=true").await?;
    println!("all Rust black-box model tests passed");
    Ok(())
}
