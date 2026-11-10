#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/../.." && pwd)
runtime=$(mktemp -d /tmp/p4tg-ci-all-XXXXXX)

printf 'test artifacts: %s\n' "$runtime"
"$repo_root/tests/ci/controller.sh"
"$repo_root/tests/ci/gui.sh"
"$repo_root/tests/ci/test-release.sh"
"$repo_root/tests/ci/build-controller-image.sh"

for target in tofino tofino2; do
  bundle="$runtime/$target"
  mkdir -p "$bundle"
  "$repo_root/tests/ci/compile-p4.sh" "$target" "$bundle"
  "$repo_root/tests/ci/model-smoke.sh" "$target" "$bundle"
done
