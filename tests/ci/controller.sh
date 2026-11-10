#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/../.." && pwd)
jobs=${P4TG_BUILD_JOBS:-8}

cargo build --manifest-path "$repo_root/Controller/Cargo.toml" -j "$jobs"
cargo test --manifest-path "$repo_root/Controller/Cargo.toml" -j "$jobs"
cargo build --manifest-path "$repo_root/tests/Cargo.toml" --all-targets -j "$jobs"
cargo test --manifest-path "$repo_root/tests/Cargo.toml" -j "$jobs"
cargo clippy --manifest-path "$repo_root/tests/Cargo.toml" --all-targets -j "$jobs" -- -D warnings
