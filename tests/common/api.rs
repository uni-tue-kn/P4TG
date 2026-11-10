use reqwest::{Client, Response};
use serde_json::Value;

pub struct ApiClient {
    base: String,
    client: Client,
}

impl ApiClient {
    pub fn new(base: impl Into<String>) -> Self {
        Self {
            base: base.into(),
            client: Client::new(),
        }
    }

    pub async fn get(&self, path: &str) -> Result<Response, reqwest::Error> {
        self.client
            .get(format!("{}{}", self.base, path))
            .send()
            .await
    }

    pub async fn post_json(&self, path: &str, body: &Value) -> Result<Response, reqwest::Error> {
        self.client
            .post(format!("{}{}", self.base, path))
            .json(body)
            .send()
            .await
    }

    pub async fn delete(&self, path: &str) -> Result<Response, reqwest::Error> {
        self.client
            .delete(format!("{}{}", self.base, path))
            .send()
            .await
    }
}
