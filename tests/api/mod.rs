use p4tg_tests::api::ApiClient;
use serde_json::Value;

pub type TestResult<T = ()> = Result<T, Box<dyn std::error::Error>>;

pub async fn json_get(api: &ApiClient, path: &str) -> TestResult<Value> {
    let response = api.get(path).await?;
    if !response.status().is_success() {
        return Err(format!("GET {path} returned {}", response.status()).into());
    }
    Ok(response.json().await?)
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
