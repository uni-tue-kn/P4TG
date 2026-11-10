use crate::api::TestResult;
use p4tg_tests::{api::ApiClient, payload::TrafficGenPayload};
use serde_json::{json, Value};

/// Fixed a monitoring-thread crash when app ID 0 was posted through the API.
const V2_8_1_APP_ID_ZERO: &str = "v2_8_1_app_id_zero";
/// Added missing channel-range validation for stream and TX/RX mappings.
const V2_8_1_CHANNEL_RANGE: &str = "v2_8_1_channel_range";
/// Added minimum 64-byte frame validation and avoided packet-builder underflow.
const V2_8_1_MINIMUM_FRAME_SIZE: &str = "v2_8_1_minimum_frame_size";
/// Bounded invalid pattern sample rates and periods.
const V2_8_1_PATTERN_SAMPLE_RATE: &str = "v2_8_1_pattern_sample_rate";
/// Fixed crashes for invalid histogram ranges.
const V2_8_1_HISTOGRAM_RANGE: &str = "v2_8_1_histogram_range";
/// Fixed crashes when no TX/RX mapping was configured.
const V2_5_0_MISSING_TX_RX_MAPPING: &str = "v2_5_0_missing_tx_rx_mapping";
/// Validation errors are propagated for a list of test definitions.
const V2_5_0_MULTIPLE_TEST_VALIDATION: &str = "v2_5_0_multiple_test_validation";
/// Missing IPv4 settings are rejected even when ip_version is omitted.
const V2_7_1_MISSING_IPV4: &str = "v2_7_1_missing_ipv4";

async fn rejection(api: &ApiClient, name: &str, payload: Value, needle: &str) -> TestResult {
    let response = api.post_json("/api/trafficgen", &payload).await?;
    let status = response.status();
    let body = response.text().await?;
    if status.is_success() || !body.to_lowercase().contains(&needle.to_lowercase()) {
        return Err(format!("{name}: expected {needle:?}, got {status} {body}").into());
    }
    println!("ok regression::{name}");
    Ok(())
}

async fn no_server_error(api: &ApiClient, name: &str, payload: Value) -> TestResult {
    let response = api.post_json("/api/trafficgen", &payload).await?;
    let status = response.status();
    let body = response.text().await?;
    if status.is_server_error() {
        return Err(format!("{name}: request crashed/failed internally: {status} {body}").into());
    }
    if status.is_success() {
        let stop = api.delete("/api/trafficgen?skip=true").await?;
        if !stop.status().is_success() {
            return Err(format!("{name}: accepted test could not be stopped").into());
        }
    }
    println!("ok regression::{name}");
    Ok(())
}

pub async fn validation(
    api: &ApiClient,
    is_tofino2: bool,
    allow_accepted_request: bool,
) -> TestResult {
    let base = TrafficGenPayload::valid(if is_tofino2 { 0.00001 } else { 0.001 }).json();

    // v2.8.1: reject app ID 0 instead of crashing the monitoring thread.
    let mut value = base.clone();
    value["streams"][0]["app_id"] = json!(0);
    rejection(
        api,
        V2_8_1_APP_ID_ZERO,
        value,
        "reserved for the monitoring packets",
    )
    .await?;

    // v2.8.1: reject missing/out-of-range stream and mapping channels.
    let mut value = base.clone();
    value["stream_settings"][0]["channel"] = json!(7);
    rejection(api, V2_8_1_CHANNEL_RANGE, value, "channel 7").await?;

    // v2.8.1: validate the Ethernet minimum and avoid packet-builder underflow.
    let mut value = base.clone();
    value["streams"][0]["frame_size"] = json!(63);
    rejection(api, V2_8_1_MINIMUM_FRAME_SIZE, value, "64").await?;

    // v2.8.1: zero test repetitions are invalid.
    let mut value = base.clone();
    value["repetitions"] = json!(0);
    rejection(api, "v2_8_1_zero_repetitions", value, "greater than 0").await?;

    // v2.8.1: pattern sample rates are bounded and cannot be zero.
    let mut value = base.clone();
    value["streams"][0]["pattern"] = json!({
        "pattern_type": "Sine", "period": 1_000_000.0, "sample_rate": 0
    });
    rejection(api, V2_8_1_PATTERN_SAMPLE_RATE, value, "must be in [1").await?;

    // v2.8.1: histogram bins must form a finite, non-empty range.
    let mut value = base.clone();
    value["rtt_histogram_config"] = json!({
        "2": {"0": {"min": 10, "max": 10, "num_bins": 1}}
    });
    rejection(
        api,
        V2_8_1_HISTOGRAM_RANGE,
        value,
        "minimum value must be less",
    )
    .await?;

    // Poisson generation supports exactly one active stream.
    let mut value = base.clone();
    value["mode"] = json!(3);
    let mut second_setting = value["stream_settings"][0].clone();
    second_setting["stream_id"] = json!(2);
    value["stream_settings"]
        .as_array_mut()
        .unwrap()
        .push(second_setting);
    let mut second_stream = value["streams"][0].clone();
    second_stream["stream_id"] = json!(2);
    second_stream["app_id"] = json!(2);
    value["streams"].as_array_mut().unwrap().push(second_stream);
    rejection(
        api,
        "poisson_single_stream",
        value,
        "only allows for one stream",
    )
    .await?;

    // Analyze mode has no generated streams.
    let mut value = base.clone();
    value["mode"] = json!(4);
    rejection(api, "analyze_rejects_streams", value, "analyze mode").await?;

    // v2.5.0: an empty test list and a missing TX/RX mapping are errors, not panics.
    rejection(
        api,
        "v2_5_0_empty_test_list",
        json!([]),
        "no tests provided",
    )
    .await?;
    if allow_accepted_request {
        let mut value = base.clone();
        value["port_tx_rx_mapping"] = json!({});
        no_server_error(api, V2_5_0_MISSING_TX_RX_MAPPING, value).await?;
    }

    // v2.5.0: validation errors in a multi-test request identify the bad test.
    let mut bad = base.clone();
    bad["name"] = json!("invalid app id");
    bad["streams"][0]["app_id"] = json!(0);
    let mut good = base.clone();
    good["name"] = json!("valid");
    rejection(
        api,
        V2_5_0_MULTIPLE_TEST_VALIDATION,
        json!([good, bad]),
        "invalid app id",
    )
    .await?;

    // v2.7.1: omitted optional protocol settings deserialize, but IPv4 remains required.
    let mut value = base;
    value["stream_settings"][0]
        .as_object_mut()
        .unwrap()
        .remove("ip");
    rejection(api, V2_7_1_MISSING_IPV4, value, "missing ipv4 settings").await?;
    Ok(())
}
