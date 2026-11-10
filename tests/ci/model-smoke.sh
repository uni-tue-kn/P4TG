#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/../.." && pwd)
target=${1:?usage: model-smoke.sh <tofino|tofino2> [bundle-directory]}
bundle=${2:-}
traffic_rate=${P4TG_SMOKE_RATE:-}
netsim_image='unituekn/unicornp4-netsim@sha256:b9ef8d75d7639808226340e51a79120a4752a43e082237eec9d78677d2d9dd07'
container="p4tg-ci-model-${target}-$$"
controller_container="p4tg-ci-controller-${target}-$$"
runtime=$(mktemp -d "/tmp/p4tg-ci-${target}-XXXXXX")

cleanup() {
  docker logs "$controller_container" > "$runtime/controller.log" 2>&1 || true
  docker rm -f "$controller_container" >/dev/null 2>&1 || true
  docker logs "$container" > "$runtime/container.log" 2>&1 || true
  docker rm -f "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if ! docker image inspect p4tg-ci-controller:local >/dev/null 2>&1; then
  "$repo_root/tests/ci/build-controller-image.sh"
fi

if [[ -z "$bundle" ]]; then
  bundle="$runtime/bundle"
  mkdir -p "$bundle"
  "$repo_root/tests/ci/compile-p4.sh" "$target" "$bundle"
fi
bundle=$(cd "$bundle" && pwd)

case "$target" in
  tofino)
    ingress_port=0
    egress_port=4
    recirc_ports=8,12,16,20
    port_map='{"PortToIf":[{"device_port":0,"if":"p0"},{"device_port":4,"if":"p4"},{"device_port":8,"if":"p8"},{"device_port":12,"if":"p12"},{"device_port":16,"if":"p16"},{"device_port":20,"if":"p20"}]}'
    probe_wait=12
    traffic_rate=${traffic_rate:-0.001}
    ;;
  tofino2)
    ingress_port=8
    egress_port=16
    recirc_ports=24,32,40,48
    port_map='{"PortToIf":[{"device_port":8,"if":"p8"},{"device_port":16,"if":"p16"},{"device_port":24,"if":"p24"},{"device_port":32,"if":"p32"},{"device_port":40,"if":"p40"},{"device_port":48,"if":"p48"}]}'
    probe_wait=25
    traffic_rate=${traffic_rate:-0.00001}
    ;;
  *)
    echo "unsupported target: $target" >&2
    exit 2
    ;;
esac
if [[ -n "${P4TG_SMOKE_WAIT:-}" ]]; then
  probe_wait=$P4TG_SMOKE_WAIT
fi

mkdir -p "$runtime/run"
chmod 0777 "$runtime" "$runtime/run"
printf '%s\n' \
  '{' \
  '  "tg_ports": [' \
  '    {"port": 1, "mac": "02:00:00:00:00:01", "recirculation_ports": {"tx_port": 3, "rx_port": 4}},' \
  '    {"port": 2, "mac": "02:00:00:00:00:02", "recirculation_ports": {"tx_port": 5, "rx_port": 6}}' \
  '  ]' \
  '}' > "$runtime/config.json"
printf '%s\n' \
  '{' \
  '  "name": "model feasibility",' \
  '  "mode": 1,' \
  '  "stream_settings": [{' \
  '    "port": 1, "channel": 0, "stream_id": 1, "active": true,' \
  '    "ethernet": {"eth_src": "02:00:00:00:00:01", "eth_dst": "02:00:00:00:00:02"},' \
  '    "ip": {"ip_src": "192.0.2.1", "ip_dst": "198.51.100.1", "ip_tos": 0, "ip_src_mask": "0.0.0.0", "ip_dst_mask": "0.0.0.0"}' \
  '  }],' \
  '  "streams": [{' \
  '    "stream_id": 1, "app_id": 1, "frame_size": 128, "encapsulation": 0,' \
  "    \"traffic_rate\": $traffic_rate, \"burst\": 1, \"batches\": false," \
  '    "vxlan": false, "gtpu": false, "ip_version": 4, "unit": 0' \
  '  }],' \
  '  "rx_mapping_mode": "per_tx_port",' \
  '  "port_tx_rx_mapping": {"1": {"0": {"port": 2, "channel": 0}}},' \
  '  "duration": 30, "repetitions": 1, "drain_duration_secs": 0,' \
  '  "rtt_histogram_config": {}, "iat_histogram_config": {}' \
  '}' > "$runtime/traffic.json"
printf '%s\n' "$port_map" > "$runtime/ports.json"

docker run -d --name "$container" --network none \
  --cap-drop ALL --cap-add NET_ADMIN --cap-add NET_RAW \
  --security-opt no-new-privileges:true \
  -v "$bundle:/p4tg/bundle:ro" \
  -v "$runtime:/p4tg/runtime" \
  -e P4TG_TARGET="$target" -e P4TG_INGRESS_PORT="$ingress_port" \
  -e P4TG_EGRESS_PORT="$egress_port" -e P4TG_RECIRC_PORTS="$recirc_ports" \
  --entrypoint bash "$netsim_image" -ec '
    ip link add "p$P4TG_INGRESS_PORT" type veth peer name "p$P4TG_EGRESS_PORT"
    ip link set dev "p$P4TG_INGRESS_PORT" addrgenmode none
    ip link set dev "p$P4TG_EGRESS_PORT" addrgenmode none
    ip link set "p$P4TG_INGRESS_PORT" up
    ip link set "p$P4TG_EGRESS_PORT" up
    for port in ${P4TG_RECIRC_PORTS//,/ }; do
      ip link add "p$port" type veth peer name "q$port"
      ip link add "b$port" type bridge
      ip link set "q$port" master "b$port"
      bridge link set dev "q$port" hairpin on
      ip link set "p$port" up
      ip link set "q$port" up
      ip link set "b$port" up
    done
    exec python3 -m runtime.tofino.supervisor --name "p4tg-ci-$P4TG_TARGET" \
      --bundle /p4tg/bundle --architecture "$P4TG_TARGET" \
      --work-dir /p4tg/runtime/run --port-map /p4tg/runtime/ports.json \
      --bfrt-port 50052 --model-port-base 18001 --status-port 17777
  ' >/dev/null

ready=false
for _ in $(seq 1 120); do
  if docker exec "$container" grep -q '"status": "ready"' /p4tg/runtime/run/state.json 2>/dev/null; then
    ready=true
    break
  fi
  if [[ $(docker inspect --format '{{.State.Running}}' "$container") == false ]]; then
    echo "model container exited before becoming ready" >&2
    docker logs "$container" >&2
    exit 1
  fi
  sleep 2
done
if [[ "$ready" != true ]]; then
  echo "model did not become ready" >&2
  exit 1
fi

docker run -d --name "$controller_container" --network "container:$container" \
  --cap-drop ALL --security-opt no-new-privileges:true \
  -v "$runtime/config.json:/app/config.json:ro" \
  -e P4_NAME=traffic_gen -e NUM_PORTS=6 -e P4TG_PORT=18080 \
  -e P4TG_EXTERNAL_RECIRCULATION=1 \
  -e RUST_LOG=none,p4tg_controller=debug,rbfrt=info \
  p4tg-ci-controller:local >/dev/null

online=false
for _ in $(seq 1 90); do
  if docker exec "$container" curl --fail --silent http://127.0.0.1:18080/api/online \
      > "$runtime/online.json" 2>/dev/null; then
    online=true
    break
  fi
  sleep 2
done
if [[ "$online" != true ]]; then
  echo "controller did not become ready" >&2
  docker logs "$controller_container" >&2 || true
  exit 1
fi

printf 'runtime=%s\n' "$runtime"
printf 'online=%s\n' "$(cat "$runtime/online.json")"
printf 'ports=%s\n' "$(docker exec "$container" curl --fail --silent http://127.0.0.1:18080/api/ports)"

docker exec "$container" curl --fail --silent \
  -H 'content-type: application/json' --data-binary @/p4tg/runtime/traffic.json \
  http://127.0.0.1:18080/api/trafficgen > "$runtime/traffic-response.json"
sleep "$probe_wait"
docker exec "$container" curl --fail --silent http://127.0.0.1:18080/api/statistics \
  > "$runtime/statistics.json"
docker exec "$container" curl --fail --silent http://127.0.0.1:18080/api/online \
  > "$runtime/online-after-traffic.json"
docker exec "$container" curl --fail --silent -X DELETE \
  'http://127.0.0.1:18080/api/trafficgen?skip=true' >/dev/null
printf 'traffic=%s\n' "$(cat "$runtime/traffic-response.json")"
printf 'online_after_traffic=%s\n' "$(cat "$runtime/online-after-traffic.json")"
printf 'statistics=%s\n' "$(cat "$runtime/statistics.json")"

if grep -q '"digests_alive":false' "$runtime/online-after-traffic.json"; then
  echo "$target digest pipeline did not become live during the feasibility window" >&2
  exit 1
fi
