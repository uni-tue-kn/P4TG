use p4tg_tests::api::ApiClient;
use serde_json::Value;
use std::collections::BTreeSet;

pub type TestResult<T = ()> = Result<T, Box<dyn std::error::Error>>;

pub async fn json_get(api: &ApiClient, path: &str) -> TestResult<Value> {
    let response = api.get(path).await?;
    if !response.status().is_success() {
        return Err(format!("GET {path} returned {}", response.status()).into());
    }
    Ok(response.json().await?)
}

async fn expect_port_rejection(
    api: &ApiClient,
    name: &str,
    payload: Value,
    expected_status: reqwest::StatusCode,
    needle: &str,
) -> TestResult {
    let response = api.post_json("/api/ports", &payload).await?;
    let status = response.status();
    let body = response.text().await?;
    if status != expected_status || !body.to_lowercase().contains(&needle.to_lowercase()) {
        return Err(format!(
            "{name}: expected {expected_status} containing {needle:?}, got {status} {body}"
        )
        .into());
    }
    println!("ok endpoint_semantics::{name}");
    Ok(())
}

pub async fn endpoints_and_schema(api: &ApiClient) -> TestResult {
    let online = json_get(api, "/api/online").await?;
    if online["status"] != "online"
        || !matches!(online["asic"].as_str(), Some("Tofino1" | "Tofino2"))
        || online["version"].as_str().is_none()
        || online["digests_alive"].as_bool().is_none()
        || online["connected_clients"].as_u64().is_none()
    {
        return Err(format!("online returned an incomplete status: {online}").into());
    }
    let is_tofino2 = online["asic"] == "Tofino2";
    println!("ok endpoint_shape::/api/online");

    for path in ["/api/statistics", "/api/time_statistics"] {
        let value = json_get(api, path).await?;
        if !value.is_array() {
            return Err(format!("{path} must return an array, got {value}").into());
        }
        println!("ok endpoint_shape::{path}");
    }
    let limited = json_get(api, "/api/time_statistics?limit=0").await?;
    if !limited.is_array() {
        return Err("time_statistics?limit=0 must return an array".into());
    }
    println!("ok endpoint_shape::/api/time_statistics?limit=0");

    let traffic = json_get(api, "/api/trafficgen").await?;
    if traffic["message"] != "Not running." {
        return Err(format!("idle trafficgen GET returned unexpected state: {traffic}").into());
    }
    println!("ok endpoint_shape::/api/trafficgen");

    let ports = json_get(api, "/api/ports").await?;
    let first_port = ports
        .as_array()
        .and_then(|items| items.first())
        .ok_or("ports must return at least one configured model port")?;
    for field in ["port", "channel", "pid", "speed", "fec", "status"] {
        if first_port.get(field).is_none() {
            return Err(format!("port response omitted {field}").into());
        }
    }
    println!("ok endpoint_shape::/api/ports");

    let config = json_get(api, "/api/config").await?;
    let configured_port = config["tg_ports"]
        .as_array()
        .and_then(|items| items.first())
        .ok_or("config must contain at least one traffic-generator port")?;
    let front_panel_port = configured_port["port"]
        .as_u64()
        .ok_or("configured traffic-generator port has no numeric port")?;
    let configured_mac = configured_port["mac"]
        .as_str()
        .ok_or("configured traffic-generator port has no MAC address")?;
    let expected_channels: BTreeSet<u64> = if is_tofino2 {
        [0, 2, 4, 6].into_iter().collect()
    } else {
        [0, 1, 2, 3].into_iter().collect()
    };
    for (index, expected_recirculation) in [(0, (3, 4)), (1, (5, 6))] {
        let port = &config["tg_ports"][index];
        if port["channel_count"] != 4
            || port["auto_negotiation"] != "PM_AN_DEFAULT"
            || port["arp_reply"] != false
            || port["recirculation_ports"]["tx_port"] != expected_recirculation.0
            || port["recirculation_ports"]["rx_port"] != expected_recirculation.1
        {
            return Err(format!("manual port configuration was not retained: {port}").into());
        }
        let channel_mac_keys: BTreeSet<u64> = port["channel_mac"]
            .as_object()
            .into_iter()
            .flat_map(|entries| entries.keys())
            .filter_map(|channel| channel.parse().ok())
            .collect();
        if channel_mac_keys != expected_channels {
            return Err(format!(
                "manual channel MAC mappings were not materialized: expected {expected_channels:?}, got {channel_mac_keys:?}"
            )
            .into());
        }
        let port_number = port["port"]
            .as_u64()
            .ok_or("configured traffic-generator port has no numeric port")?;
        let live_channels: BTreeSet<u64> = ports
            .as_array()
            .into_iter()
            .flatten()
            .filter(|entry| entry["port"].as_u64() == Some(port_number))
            .filter_map(|entry| entry["channel"].as_u64())
            .collect();
        if live_channels != expected_channels {
            return Err(format!(
                "breakout mapping for port {port_number} was {live_channels:?}, expected {expected_channels:?}"
            )
            .into());
        }
    }
    println!("ok endpoint_semantics::manual_breakout_and_recirculation_mapping");
    let live_port = ports
        .as_array()
        .into_iter()
        .flatten()
        .find(|port| port["port"].as_u64() == Some(front_panel_port) && port["channel"] == 0)
        .ok_or("GET /api/ports omitted the configured traffic-generator port")?;
    let port_update = serde_json::json!({
        "front_panel_port": front_panel_port,
        "speed": live_port["speed"],
        "fec": live_port["fec"],
        "auto_neg": live_port["auto_neg"],
        "channel": live_port["channel"],
    });
    let response = api.post_json("/api/ports", &port_update).await?;
    if response.status() != reqwest::StatusCode::CREATED {
        let status = response.status();
        let body = response.text().await?;
        return Err(format!("reapplying a live port returned {status} {body}").into());
    }
    println!("ok endpoint_semantics::/api/ports_update");

    let mut unavailable_port = port_update.clone();
    unavailable_port["front_panel_port"] = serde_json::json!(u32::MAX);
    let response = api.post_json("/api/ports", &unavailable_port).await?;
    let status = response.status();
    let body = response.text().await?;
    if status != reqwest::StatusCode::BAD_REQUEST || !body.contains("Port not available") {
        return Err(format!("unavailable port returned {status} {body}").into());
    }
    println!("ok endpoint_semantics::/api/ports_rejects_unavailable_port");

    let mut changed_layout = port_update.clone();
    changed_layout["channel_count"] = serde_json::json!(2);
    expect_port_rejection(
        api,
        "ports_reject_runtime_layout_change",
        changed_layout,
        reqwest::StatusCode::BAD_REQUEST,
        "cannot switch",
    )
    .await?;

    let mut unsupported_speed = port_update.clone();
    unsupported_speed["channel_count"] = serde_json::json!(4);
    unsupported_speed["speed"] = serde_json::json!(if is_tofino2 {
        "BF_SPEED_400G"
    } else {
        "BF_SPEED_100G"
    });
    expect_port_rejection(
        api,
        "ports_reject_speed_that_does_not_fit_breakout",
        unsupported_speed,
        reqwest::StatusCode::BAD_REQUEST,
        "does not support",
    )
    .await?;

    let mut invalid_channel = port_update.clone();
    invalid_channel["channel_count"] = serde_json::json!(4);
    invalid_channel["channel"] = serde_json::json!(if is_tofino2 { 1 } else { 4 });
    expect_port_rejection(
        api,
        "ports_reject_channel_outside_layout",
        invalid_channel,
        reqwest::StatusCode::BAD_REQUEST,
        "not available",
    )
    .await?;

    let mut invalid_fec = port_update.clone();
    invalid_fec["channel_count"] = serde_json::json!(4);
    invalid_fec["speed"] = serde_json::json!(if is_tofino2 {
        "BF_SPEED_100G"
    } else {
        "BF_SPEED_10G"
    });
    invalid_fec["fec"] = serde_json::json!(if is_tofino2 {
        "BF_FEC_TYP_NONE"
    } else {
        "BF_FEC_TYP_REED_SOLOMON"
    });
    expect_port_rejection(
        api,
        "ports_reject_incompatible_fec",
        invalid_fec,
        reqwest::StatusCode::BAD_REQUEST,
        "fec",
    )
    .await?;

    let mut invalid_count = port_update.clone();
    invalid_count["channel_count"] = serde_json::json!(3);
    expect_port_rejection(
        api,
        "ports_reject_invalid_channel_count",
        invalid_count,
        reqwest::StatusCode::BAD_REQUEST,
        "does not support",
    )
    .await?;

    let mut asic_specific_invalid = port_update.clone();
    asic_specific_invalid["channel_count"] = serde_json::json!(if is_tofino2 { 2 } else { 8 });
    asic_specific_invalid["speed"] = serde_json::json!(if is_tofino2 {
        "BF_SPEED_400G"
    } else {
        "BF_SPEED_25G"
    });
    expect_port_rejection(
        api,
        "ports_reject_asic_specific_invalid_layout",
        asic_specific_invalid,
        reqwest::StatusCode::BAD_REQUEST,
        "does not support",
    )
    .await?;

    let mut malformed_speed = port_update.clone();
    malformed_speed["speed"] = serde_json::json!("BF_SPEED_IMPOSSIBLE");
    expect_port_rejection(
        api,
        "ports_reject_unknown_speed",
        malformed_speed,
        reqwest::StatusCode::UNPROCESSABLE_ENTITY,
        "unknown variant",
    )
    .await?;

    let mut malformed_auto_negotiation = port_update.clone();
    malformed_auto_negotiation["auto_neg"] = serde_json::json!("PM_AN_IMPOSSIBLE");
    expect_port_rejection(
        api,
        "ports_reject_unknown_auto_negotiation",
        malformed_auto_negotiation,
        reqwest::StatusCode::UNPROCESSABLE_ENTITY,
        "unknown variant",
    )
    .await?;

    let invalid_arp = serde_json::json!({
        "front_panel_port": front_panel_port,
        "channel": 0,
        "arp_reply": true,
        "mac": "not-a-mac",
    });
    let response = api.post_json("/api/ports/arp", &invalid_arp).await?;
    let status = response.status();
    let body = response.text().await?;
    if status != reqwest::StatusCode::BAD_REQUEST || !body.contains("not valid") {
        return Err(format!("invalid ARP MAC returned {status} {body}").into());
    }
    println!("ok endpoint_semantics::/api/ports/arp_rejects_invalid_mac");

    for enabled in [true, false] {
        let arp_update = serde_json::json!({
            "front_panel_port": front_panel_port,
            "channel": 0,
            "arp_reply": enabled,
            "mac": configured_mac,
        });
        let response = api.post_json("/api/ports/arp", &arp_update).await?;
        if response.status() != reqwest::StatusCode::CREATED {
            let status = response.status();
            let body = response.text().await?;
            return Err(format!("ARP toggle {enabled} returned {status} {body}").into());
        }
        let updated_config = json_get(api, "/api/config").await?;
        let arp_state = &updated_config["tg_ports"][0]["channel_arp_reply"]["0"];
        if arp_state.as_bool() != Some(enabled) {
            return Err(format!(
                "ARP toggle {enabled} was not reflected by /api/config: {updated_config}"
            )
            .into());
        }
    }
    println!("ok endpoint_semantics::/api/ports/arp_toggle");

    for path in ["/api/tables", "/api/config", "/api/histogram"] {
        let value = json_get(api, path).await?;
        if !value.is_object() {
            return Err(format!("{path} must return an object, got {value}").into());
        }
        println!("ok endpoint_shape::{path}");
    }

    let reset = json_get(api, "/api/reset").await?;
    if reset["message"] != "Reset complete" {
        return Err(format!("reset returned unexpected response: {reset}").into());
    }
    println!("ok endpoint_semantics::/api/reset");

    let schema = json_get(api, "/api-docs/openapi.json").await?;
    for (path, methods) in [
        ("/api/online", &["get"][..]),
        ("/api/statistics", &["get"][..]),
        ("/api/time_statistics", &["get"][..]),
        ("/api/report", &["post"][..]),
        ("/api/trafficgen", &["get", "post", "delete"][..]),
        ("/api/reset", &["get"][..]),
        ("/api/restart", &["get"][..]),
        ("/api/ports", &["get", "post"][..]),
        ("/api/ports/arp", &["post"][..]),
        ("/api/qsfp", &["get"][..]),
        ("/api/tables", &["get"][..]),
        ("/api/histogram", &["get"][..]),
    ] {
        let pointer = format!("/paths/{}", path.replace('~', "~0").replace('/', "~1"));
        let path_schema = schema
            .pointer(&pointer)
            .ok_or_else(|| format!("OpenAPI schema is missing {path}"))?;
        for method in methods {
            if path_schema.get(method).is_none() {
                return Err(format!("OpenAPI schema is missing {method} {path}").into());
            }
        }
    }
    let traffic_schema = schema
        .pointer("/components/schemas/TrafficGenData")
        .ok_or("OpenAPI schema is missing TrafficGenData")?;
    for property in [
        "mode",
        "stream_settings",
        "streams",
        "rx_mapping_mode",
        "port_tx_rx_mapping",
        "duration",
        "repetitions",
        "drain_duration_secs",
        "rtt_histogram_config",
        "iat_histogram_config",
        "name",
    ] {
        if traffic_schema["properties"].get(property).is_none() {
            return Err(format!("TrafficGenData schema omitted {property}").into());
        }
    }
    for required in ["mode", "stream_settings", "streams", "port_tx_rx_mapping"] {
        if !traffic_schema["required"]
            .as_array()
            .is_some_and(|items| items.iter().any(|item| item == required))
        {
            return Err(format!("TrafficGenData no longer requires {required}").into());
        }
    }
    for component in ["Stream", "StreamSetting", "P4tgReportRequest"] {
        let pointer = format!("/components/schemas/{component}");
        if schema.pointer(&pointer).is_none() {
            return Err(format!("OpenAPI schema is missing component {component}").into());
        }
    }
    if schema["openapi"].as_str().is_none() || schema["info"]["version"].as_str().is_none() {
        return Err("OpenAPI metadata is incomplete".into());
    }
    println!("ok schema::all_public_methods_payload_and_components");
    Ok(())
}
