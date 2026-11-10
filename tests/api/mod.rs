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
    for path in [
        "/api/statistics",
        "/api/time_statistics",
        "/api/time_statistics?limit=0",
        "/api/trafficgen",
        "/api/ports",
        "/api/tables",
        "/api/config",
        "/api/histogram",
        "/api/reset",
    ] {
        json_get(api, path).await?;
        println!("ok endpoint::{path}");
    }

    let schema = json_get(api, "/api-docs/openapi.json").await?;
    for path in [
        "/api/online",
        "/api/trafficgen",
        "/api/ports",
        "/api/statistics",
        "/api/report",
        "/api/reset",
    ] {
        let pointer = format!("/paths/{}", path.replace('~', "~0").replace('/', "~1"));
        if schema.pointer(&pointer).is_none() {
            return Err(format!("OpenAPI schema is missing {path}").into());
        }
    }
    if schema
        .pointer("/components/schemas/TrafficGenData")
        .is_none()
    {
        return Err("OpenAPI schema is missing TrafficGenData".into());
    }
    println!("ok schema::public_paths_and_payload");
    Ok(())
}
