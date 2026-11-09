#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/../.." && pwd)
target=${1:?usage: compile-p4.sh <tofino|tofino2> <output-directory>}
output=${2:?usage: compile-p4.sh <tofino|tofino2> <output-directory>}
sdk_image='unituekn/unicornp4-tofino-sdk@sha256:b6a4c770c9c483a2b125e4de4c3d32eb7d046a6e69648c534707ac7a655904a3'

case "$target" in
  tofino)
    arch=tna
    define=1
    binary=tofino.bin
    ;;
  tofino2)
    arch=t2na
    define=2
    binary=tofino2.bin
    ;;
  *)
    echo "unsupported target: $target" >&2
    exit 2
    ;;
esac

mkdir -p "$output"
output=$(cd "$output" && pwd)
if find "$output" -mindepth 1 -print -quit | grep -q .; then
  echo "output directory is not empty: $output" >&2
  exit 2
fi

docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$repo_root/P4-Implementation:/w:ro" -v "$output:/out" \
  --entrypoint bash "$sdk_image" -ec \
  "cd /w && bf-p4c -g --target $target --arch $arch \
    -D__TARGET_TOFINO__=$define --bf-rt-schema /out/bf-rt.json \
    -o /out traffic_gen.p4"

mv "$output/manifest.json" "$output/compiler-manifest.json"
printf '%s\n' \
  '{' \
  '  "target": "tofino",' \
  "  \"architecture\": \"$target\"," \
  '  "program_name": "traffic_gen",' \
  '  "bfrt_json": "bf-rt.json",' \
  '  "profiles": [' \
  '    {' \
  '      "profile_name": "pipe",' \
  '      "context": "pipe/context.json",' \
  "      \"binary\": \"pipe/$binary\"," \
  '      "pipe_scope": [0]' \
  '    }' \
  '  ]' \
  '}' > "$output/manifest.json"
