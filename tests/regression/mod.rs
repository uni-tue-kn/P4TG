use crate::api::TestResult;
use p4tg_tests::{
    api::ApiClient,
    payload::{payload_for_profile, HeaderProfile, TrafficGenPayload},
};
use reqwest::StatusCode;
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
/// Fixed API validation not catching missing `srv6_base_header` for SRv6 encapsulated streams.
const V2_7_1_MISSING_SRV6_BASE_HEADER: &str = "v2_7_1_missing_srv6_base_header";

async fn rejection(api: &ApiClient, name: &str, payload: Value, needle: &str) -> TestResult {
    let response = api.post_json("/api/trafficgen", &payload).await?;
    let status = response.status();
    let body = response.text().await?;
    if status != StatusCode::BAD_REQUEST || !body.to_lowercase().contains(&needle.to_lowercase()) {
        return Err(format!("{name}: expected {needle:?}, got {status} {body}").into());
    }
    println!("ok regression::{name}");
    Ok(())
}

async fn malformed(api: &ApiClient, name: &str, payload: Value, needle: &str) -> TestResult {
    let response = api.post_json("/api/trafficgen", &payload).await?;
    let status = response.status();
    let body = response.text().await?;
    if status != StatusCode::UNPROCESSABLE_ENTITY
        || !body.to_lowercase().contains(&needle.to_lowercase())
    {
        return Err(
            format!("{name}: expected 422 containing {needle:?}, got {status} {body}").into(),
        );
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

    let mut value = base.clone();
    value["streams"][0]["app_id"] = json!(if is_tofino2 { 16 } else { 8 });
    rejection(api, "app_id_above_asic_range", value, "app ids must be in").await?;

    let mut value = base.clone();
    let mut second_setting = value["stream_settings"][0].clone();
    second_setting["stream_id"] = json!(2);
    value["stream_settings"]
        .as_array_mut()
        .unwrap()
        .push(second_setting);
    let mut second_stream = value["streams"][0].clone();
    second_stream["stream_id"] = json!(2);
    value["streams"].as_array_mut().unwrap().push(second_stream);
    rejection(api, "duplicate_app_id", value, "used by multiple streams").await?;

    // v2.8.1: reject missing/out-of-range stream and mapping channels.
    let mut value = base.clone();
    value["stream_settings"][0]["channel"] = json!(7);
    rejection(api, V2_8_1_CHANNEL_RANGE, value, "channel 7").await?;

    let mut value = base.clone();
    value["port_tx_rx_mapping"] = json!({"99": {"0": {"port": 2, "channel": 0}}});
    rejection(
        api,
        "unknown_tx_mapping_port",
        value,
        "no mapping for front panel port",
    )
    .await?;

    let mut value = base.clone();
    value["port_tx_rx_mapping"] = json!({"1": {"7": {"port": 2, "channel": 0}}});
    rejection(api, "unknown_tx_mapping_channel", value, "channel 7").await?;

    let mut value = base.clone();
    value["port_tx_rx_mapping"] = json!({"1": {"0": {"port": 99, "channel": 0}}});
    rejection(
        api,
        "unknown_rx_mapping_port",
        value,
        "no mapping for front panel port",
    )
    .await?;

    let mut value = base.clone();
    value["rx_mapping_mode"] = json!("per_stream");
    value["port_tx_rx_mapping"] = json!({});
    rejection(
        api,
        "per_stream_missing_rx_target",
        value,
        "requires an rx target",
    )
    .await?;

    let mut value = base.clone();
    value["rx_mapping_mode"] = json!("per_stream");
    value["port_tx_rx_mapping"] = json!({});
    value["stream_settings"][0]["rx_target"] = json!({"port": 2, "channel": 7});
    rejection(api, "per_stream_invalid_rx_channel", value, "channel 7").await?;

    let mut value = base.clone();
    value["rx_mapping_mode"] = json!("per_stream");
    value["mode"] = json!(4);
    rejection(
        api,
        "per_stream_analyze_unsupported",
        value,
        "not supported in analyze",
    )
    .await?;

    // v2.8.1: validate the Ethernet minimum and avoid packet-builder underflow.
    let mut value = base.clone();
    value["streams"][0]["frame_size"] = json!(63);
    rejection(api, V2_8_1_MINIMUM_FRAME_SIZE, value, "64").await?;

    // v2.8.1: zero test repetitions are invalid.
    let mut value = base.clone();
    value["repetitions"] = json!(0);
    rejection(api, "v2_8_1_zero_repetitions", value, "greater than 0").await?;

    let mut value = base.clone();
    value["repetitions"] = json!(2);
    value["duration"] = json!(0);
    rejection(
        api,
        "repetitions_require_duration",
        value,
        "duration greater than 0",
    )
    .await?;

    let mut value = base.clone();
    value["drain_duration_secs"] = json!(61);
    rejection(api, "drain_duration_bounded", value, "must not exceed 60").await?;

    // v2.8.1: pattern sample rates are bounded and cannot be zero.
    let mut value = base.clone();
    value["streams"][0]["pattern"] = json!({
        "pattern_type": "Sine", "period": 1_000_000.0, "sample_rate": 0
    });
    rejection(api, V2_8_1_PATTERN_SAMPLE_RATE, value, "must be in [1").await?;

    let mut value = base.clone();
    value["streams"][0]["pattern"] = json!({
        "pattern_type": "Sine", "period": 0.0, "sample_rate": 10
    });
    rejection(
        api,
        "pattern_period_positive",
        value,
        "finite value greater than zero",
    )
    .await?;

    let mut value = base.clone();
    value["streams"][0]["pattern"] = json!({
        "pattern_type": "Sine", "period": 1_000_000.0, "sample_rate": 10,
        "burst_packets": 0
    });
    rejection(api, "pattern_burst_bounded", value, "must be in [1,").await?;

    let mut value = base.clone();
    value["streams"][0]["pattern"] = json!({
        "pattern_type": "Square", "period": 1_000_000.0, "sample_rate": 10,
        "square_low": 1.1
    });
    rejection(api, "square_low_bounded", value, "within [0, 1]").await?;

    let mut value = base.clone();
    value["streams"][0]["pattern"] = json!({
        "pattern_type": "Flashcrowd", "period": 1_000_000.0, "sample_rate": 10,
        "fc_quiet_until": 500_000.0, "fc_ramp_until": 400_000.0
    });
    rejection(
        api,
        "flashcrowd_phase_order",
        value,
        "larger than quiet until",
    )
    .await?;

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

    let mut value = base.clone();
    value["rtt_histogram_config"] = json!({
        "2": {"0": {"min": 0, "max": 10, "num_bins": 0}}
    });
    rejection(
        api,
        "histogram_positive_bins",
        value,
        "num_bins must be positive",
    )
    .await?;

    let mut value = base.clone();
    value["rtt_histogram_config"] = json!({
        "2": {"0": {"min": 0, "max": 2, "num_bins": 3}}
    });
    rejection(api, "histogram_bins_fit_range", value, "too many bins").await?;

    let mut value = base.clone();
    value["rtt_histogram_config"] = json!({
        "2": {"0": {"min": 0, "max": 10, "num_bins": 2, "percentiles": [1.1]}}
    });
    rejection(api, "histogram_percentile_range", value, "not in range").await?;

    let mut value = base.clone();
    value["rtt_histogram_config"] = json!({
        "2": {"0": {"min": 0, "max": 20, "num_bins": 2,
          "percentiles": [0.0,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1.0]}}
    });
    rejection(api, "histogram_percentile_count", value, "at most 10").await?;

    let mut value = base.clone();
    value["rtt_histogram_config"] = json!({
        "2": {"0": {"min": 0, "max": 20, "num_bins": 2,
          "stream_groups": {"aggregate": [1,1], "separate": []}}}
    });
    rejection(
        api,
        "histogram_duplicate_group_app",
        value,
        "must not contain duplicate",
    )
    .await?;

    let mut value = base.clone();
    value["rtt_histogram_config"] = json!({
        "2": {"0": {"min": 0, "max": 20, "num_bins": 2,
          "stream_groups": {"aggregate": [1], "separate": [1]}}}
    });
    rejection(
        api,
        "histogram_overlapping_groups",
        value,
        "cannot be both aggregated",
    )
    .await?;

    let mut value = base.clone();
    value["rtt_histogram_config"] = json!({
        "2": {"0": {"min": 0, "max": 20, "num_bins": 2,
          "stream_groups": {"aggregate": [2], "separate": []}}}
    });
    rejection(
        api,
        "histogram_unknown_group_app",
        value,
        "does not identify a configured stream",
    )
    .await?;

    let mut value = base.clone();
    value["streams"][0]["traffic_rate"] = json!(500.0);
    rejection(
        api,
        "aggregate_rate_bounded",
        value,
        "larger than maximal supported rate",
    )
    .await?;

    let mut value = base.clone();
    value["stream_settings"][0]["active"] = json!(false);
    rejection(api, "requires_active_stream", value, "no active streams").await?;

    let mut value = base.clone();
    value["streams"][0]["ip_version"] = json!(5);
    rejection(
        api,
        "unsupported_ip_version",
        value,
        "unsupported ip version",
    )
    .await?;

    let mut value = base.clone();
    value["streams"][0]["ip_version"] = json!(6);
    rejection(api, "missing_ipv6_settings", value, "missing ipv6 settings").await?;

    let mut value = base.clone();
    value["streams"][0]["encapsulation"] = json!(1);
    rejection(api, "missing_vlan_settings", value, "no vlan settings").await?;

    let mut value = base.clone();
    value["streams"][0]["encapsulation"] = json!(3);
    rejection(
        api,
        "mpls_requires_lse_count",
        value,
        "number_of_lse missing",
    )
    .await?;

    let mut value = base.clone();
    value["streams"][0]["encapsulation"] = json!(3);
    value["streams"][0]["number_of_lse"] = json!(1);
    rejection(api, "mpls_requires_stack", value, "no mpls stack").await?;

    let mut value = payload_for_profile(
        if is_tofino2 { 0.00001 } else { 0.001 },
        HeaderProfile::Mpls,
    );
    value["stream_settings"][0]["mpls_stack"]
        .as_array_mut()
        .unwrap()
        .pop();
    rejection(
        api,
        "mpls_stack_length_matches",
        value,
        "does not match length",
    )
    .await?;

    let mut value = base.clone();
    value["streams"][0]["vxlan"] = json!(true);
    rejection(api, "vxlan_requires_settings", value, "no vxlan settings").await?;

    let mut value = base.clone();
    value["streams"][0]["gtpu"] = json!(true);
    rejection(api, "gtpu_requires_settings", value, "no gtp-u settings").await?;

    let mut value = base.clone();
    value["streams"][0]["vxlan"] = json!(true);
    value["streams"][0]["gtpu"] = json!(true);
    rejection(
        api,
        "tunnels_mutually_exclusive",
        value,
        "mutually exclusive",
    )
    .await?;

    let mut value = payload_for_profile(
        if is_tofino2 { 0.00001 } else { 0.001 },
        HeaderProfile::Gtpu,
    );
    value["streams"][0]["encapsulation"] = json!(1);
    value["stream_settings"][0]["vlan"] = json!({
        "vlan_id": 100, "pcp": 0, "dei": 0,
        "inner_vlan_id": 200, "inner_pcp": 0, "inner_dei": 0
    });
    rejection(
        api,
        "gtpu_requires_plain_encapsulation",
        value,
        "only supported without encapsulation",
    )
    .await?;

    let mut value = base.clone();
    value["streams"][0]["encapsulation"] = json!(4);
    if is_tofino2 {
        rejection(
            api,
            "srv6_requires_sid_count",
            value,
            "number_of_srv6_sids missing",
        )
        .await?;
        let mut value = payload_for_profile(0.00001, HeaderProfile::Srv6);
        value["stream_settings"][0]
            .as_object_mut()
            .unwrap()
            .remove("srv6_base_header");
        rejection(
            api,
            V2_7_1_MISSING_SRV6_BASE_HEADER,
            value,
            "no srv6 base header",
        )
        .await?;
    } else {
        rejection(api, "srv6_tofino2_only", value, "only supported on tofino2").await?;
    }

    let mut value = base.clone();
    value["mode"] = json!(99);
    malformed(api, "unknown_generation_mode", value, "did not match").await?;

    let mut value = base.clone();
    value["rx_mapping_mode"] = json!("unknown");
    malformed(api, "unknown_rx_mapping_mode", value, "did not match").await?;

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

    let mut first = base.clone();
    first["name"] = json!("duplicate");
    let second = first.clone();
    rejection(
        api,
        "multiple_tests_require_unique_names",
        json!([first, second]),
        "duplicate name",
    )
    .await?;

    let mut unnamed = base.clone();
    unnamed.as_object_mut().unwrap().remove("name");
    rejection(
        api,
        "multiple_tests_require_names",
        json!([unnamed]),
        "has no name",
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
