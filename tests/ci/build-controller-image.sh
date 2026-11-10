#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/../.." && pwd)
docker build --file "$repo_root/tests/ci/controller.Dockerfile" \
  --tag p4tg-ci-controller:local "$repo_root"
