/* Copyright 2022-present University of Tuebingen, Chair of Communication Networks
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/*
 * Fabian Ihle (fabian.ihle@uni-tuebingen.de)
 */

use crate::api::server::Error;
use axum::extract::Query;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json, Response};
use serde::{Deserialize, Serialize};
use std::env;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::{timeout, Instant};
use utoipa::{IntoParams, ToSchema};

const DEFAULT_BFSHELL_HOST: &str = "127.0.0.1";
const DEFAULT_BFSHELL_PORT: u16 = 9999;
const MAX_RESPONSE_BYTES: usize = 1024 * 1024;

#[derive(Deserialize, IntoParams)]
pub struct QsfpParams {
    /// Front-panel module number. If omitted, the module overview is returned.
    port: Option<u32>,
    /// Front-panel channel used by `module-show` (defaults to 0).
    channel: Option<u8>,
}

#[derive(Serialize, ToSchema)]
pub struct QsfpResponse {
    /// Command executed inside the platform QSFP uCLI node.
    command: String,
    /// Text produced by the platform-specific QSFP command.
    output: String,
}

/// Returns the hardware QSFP information reported by the platform module.
#[utoipa::path(
    get,
    path = "/api/qsfp",
    params(QsfpParams),
    responses(
        (status = 200, body = QsfpResponse, description = "Returns a QSFP module overview or detailed information for one module."),
        (status = 400, body = Error, description = "The requested front-panel port or channel is invalid."),
        (status = 503, body = Error, description = "The bf_switchd CLI or QSFP platform command is unavailable.")
    )
)]
pub async fn qsfp(Query(params): Query<QsfpParams>) -> Response {
    let command = match params.port {
        Some(port) if port == 0 || port > 256 => {
            return (
                StatusCode::BAD_REQUEST,
                Json(Error::new(
                    "QSFP front-panel port must be between 1 and 256.",
                )),
            )
                .into_response();
        }
        Some(port) => {
            let channel = params.channel.unwrap_or(0);
            if channel > 7 {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(Error::new("QSFP channel must be between 0 and 7.")),
                )
                    .into_response();
            }
            QsfpCommand::ModuleShow { port, channel }
        }
        None if params.channel.is_some() => {
            return (
                StatusCode::BAD_REQUEST,
                Json(Error::new(
                    "A QSFP channel can only be specified together with a port.",
                )),
            )
                .into_response();
        }
        None => QsfpCommand::Show,
    };

    match query_qsfp(&command).await {
        Ok(output) => Json(QsfpResponse {
            command: command.to_string(),
            output,
        })
        .into_response(),
        Err(err) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(Error::new(format!(
                "Unable to query QSFP information: {err}"
            ))),
        )
            .into_response(),
    }
}

enum QsfpCommand {
    Show,
    ModuleShow { port: u32, channel: u8 },
}

impl std::fmt::Display for QsfpCommand {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            QsfpCommand::Show => formatter.write_str("show"),
            QsfpCommand::ModuleShow { port, channel } => {
                write!(formatter, "dump-info {port} + module-show {port}/{channel}")
            }
        }
    }
}

async fn query_qsfp(command: &QsfpCommand) -> Result<String, String> {
    let host = env::var("BFSHELL_HOST").unwrap_or_else(|_| DEFAULT_BFSHELL_HOST.to_owned());
    let port = env::var("BFSHELL_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(DEFAULT_BFSHELL_PORT);
    let address = format!("{host}:{port}");

    let mut stream = timeout(Duration::from_secs(3), TcpStream::connect(&address))
        .await
        .map_err(|_| format!("connection to {address} timed out"))?
        .map_err(|err| format!("cannot connect to {address}: {err}"))?;

    // bf_switchd's CLI server is a raw TCP terminal. Waiting for each prompt
    // keeps commands ordered and avoids bundling the SDE's bfshell executable
    // and shared libraries into the controller container.
    read_until_prompt(&mut stream, Duration::from_secs(5))
        .await
        .map_err(|err| format!("while waiting for the initial bfshell prompt: {err}"))?;

    stream
        .write_all(b"ucli\n")
        .await
        .map_err(|err| format!("cannot enter uCLI: {err}"))?;
    let ucli_output = read_until_prompt(&mut stream, Duration::from_secs(5))
        .await
        .map_err(|err| format!("while entering uCLI: {err}"))?;
    let mut prompt = terminal_prompt(&ucli_output).unwrap_or_default();

    // Platform BSPs do not all start uCLI at the same depth. Some enter the
    // QSFP node automatically, while others start at the bf-sde root.
    if !is_ucli_node_or_descendant(&prompt, "bf_pltfm") {
        prompt = enter_ucli_node(&mut stream, "bf_pltfm", Duration::from_secs(5)).await?;
    }
    if !is_ucli_node_or_descendant(&prompt, "bf_pltfm.qsfp") {
        prompt = enter_ucli_node(&mut stream, "qsfp", Duration::from_secs(5)).await?;
    }
    if !is_ucli_node_or_descendant(&prompt, "bf_pltfm.qsfp") {
        return Err(format!(
            "the `bf_pltfm.qsfp` uCLI node is unavailable (received prompt `{prompt}`)"
        ));
    }

    let output = match command {
        QsfpCommand::Show => run_qsfp_command(&mut stream, "show").await?,
        QsfpCommand::ModuleShow { port, channel } => {
            let summary_command = format!("dump-info {port}");
            let summary = run_qsfp_command(&mut stream, &summary_command).await?;
            let details_command = format!("module-show {port}/{channel}");
            let details = run_qsfp_command(&mut stream, &details_command).await?;

            match decoded_module_line(&summary) {
                Some(module) => format!("## DECODED MODULE\n{module}\n\n{details}"),
                None => details,
            }
        }
    };

    // Leave the nested uCLI and bfshell sessions cleanly. The response has
    // already been captured, so shutdown errors do not invalidate it.
    let _ = stream.write_all(b"exit\nexit\nexit\nexit\n").await;
    let _ = stream.shutdown().await;

    if output.is_empty() {
        Err("the platform returned no QSFP data".to_owned())
    } else {
        Ok(output)
    }
}

async fn run_qsfp_command(stream: &mut TcpStream, command: &str) -> Result<String, String> {
    stream
        .write_all(format!("{command}\n").as_bytes())
        .await
        .map_err(|err| format!("cannot run `{command}`: {err}"))?;
    let output = read_until_prompt(stream, Duration::from_secs(20))
        .await
        .map_err(|err| format!("while running `{command}`: {err}"))?;

    Ok(clean_command_output(&output, command))
}

fn decoded_module_line(output: &str) -> Option<&str> {
    output.lines().find(|line| {
        line.split_once('=')
            .is_some_and(|(label, _)| label.trim() == "Module")
    })
}

async fn enter_ucli_node(
    stream: &mut TcpStream,
    node: &str,
    maximum_wait: Duration,
) -> Result<String, String> {
    stream
        .write_all(format!("{node}\n").as_bytes())
        .await
        .map_err(|err| format!("cannot enter the `{node}` uCLI node: {err}"))?;
    let output = read_until_prompt(stream, maximum_wait)
        .await
        .map_err(|err| format!("while entering the `{node}` uCLI node: {err}"))?;
    terminal_prompt(&output)
        .ok_or_else(|| format!("the `{node}` uCLI node returned no recognizable prompt"))
}

async fn read_until_prompt(
    stream: &mut TcpStream,
    maximum_wait: Duration,
) -> Result<Vec<u8>, String> {
    let deadline = Instant::now() + maximum_wait;
    let mut output = Vec::new();
    let mut buffer = [0_u8; 4096];

    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err("timed out waiting for the bf_switchd CLI prompt".to_owned());
        }

        let bytes_read = timeout(remaining, stream.read(&mut buffer))
            .await
            .map_err(|_| "timed out waiting for the bf_switchd CLI prompt".to_owned())?
            .map_err(|err| format!("cannot read from the bf_switchd CLI: {err}"))?;

        if bytes_read == 0 {
            return Err("the bf_switchd CLI closed the connection".to_owned());
        }

        if output.len() + bytes_read > MAX_RESPONSE_BYTES {
            return Err("the bf_switchd CLI response exceeded 1 MiB".to_owned());
        }

        output.extend_from_slice(&buffer[..bytes_read]);
        if ends_with_prompt(&output) {
            return Ok(output);
        }
    }
}

fn ends_with_prompt(output: &[u8]) -> bool {
    terminal_prompt(output).is_some()
}

fn terminal_prompt(output: &[u8]) -> Option<String> {
    let cleaned = strip_terminal_control_sequences(&String::from_utf8_lossy(output));
    cleaned.lines().next_back().and_then(|line| {
        let line = line.trim();
        if line == "bfshell>" || (line.starts_with("bf-sde") && line.ends_with('>')) {
            Some(line.to_owned())
        } else {
            None
        }
    })
}

fn is_ucli_node_or_descendant(prompt: &str, node: &str) -> bool {
    let Some(path) = prompt
        .strip_prefix("bf-sde.")
        .and_then(|prompt| prompt.strip_suffix('>'))
    else {
        return false;
    };

    path == node || path.starts_with(&format!("{node}."))
}

fn clean_command_output(output: &[u8], command: &str) -> String {
    let cleaned = strip_terminal_control_sequences(&String::from_utf8_lossy(output));
    let mut lines: Vec<&str> = cleaned.lines().collect();

    if lines.first().is_some_and(|line| line.trim() == command) {
        lines.remove(0);
    }
    if lines
        .last()
        .is_some_and(|line| ends_with_prompt(line.as_bytes()))
    {
        lines.pop();
    }

    lines.join("\n").trim().to_owned()
}

fn strip_terminal_control_sequences(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut characters = input.chars().peekable();

    while let Some(character) = characters.next() {
        if character == '\u{1b}' && characters.peek() == Some(&'[') {
            characters.next();
            for sequence_character in characters.by_ref() {
                if ('@'..='~').contains(&sequence_character) {
                    break;
                }
            }
            continue;
        }

        if character == '\r' {
            continue;
        }
        if character == '\n' || character == '\t' || !character.is_control() {
            output.push(character);
        }
    }

    output
}
