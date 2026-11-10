#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/../.." && pwd)
target=${1:?usage: model-smoke.sh <tofino|tofino2> [bundle-directory]}
bundle=${2:-}
traffic_rate=${P4TG_SMOKE_RATE:-}
netsim_image='unituekn/unicornp4-netsim@sha256:b9ef8d75d7639808226340e51a79120a4752a43e082237eec9d78677d2d9dd07'
container="p4tg-ci-model-${target}-$$"
controller_container="p4tg-ci-controller-${target}-$$"
test_container="p4tg-ci-tests-${target}-$$"
runtime=$(mktemp -d "/tmp/p4tg-ci-${target}-XXXXXX")

cleanup() {
  docker logs "$controller_container" > "$runtime/controller.log" 2>&1 || true
  docker rm -f "$controller_container" >/dev/null 2>&1 || true
  docker rm -f "$test_container" >/dev/null 2>&1 || true
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
    front_pairs='0:4 1:5 2:6 3:7'
    recirc_ports=8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23
    model_ports='0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23'
    port_speed=BF_SPEED_25G
    port_fec=BF_FEC_TYP_NONE
    channel_mac_1='{"0":"02:00:00:00:00:01","1":"02:00:00:00:00:02","2":"02:00:00:00:00:03","3":"02:00:00:00:00:04"}'
    channel_mac_2='{"0":"02:00:00:00:00:11","1":"02:00:00:00:00:12","2":"02:00:00:00:00:13","3":"02:00:00:00:00:14"}'
    probe_wait=12
    traffic_rate=${traffic_rate:-0.001}
    ;;
  tofino2)
    ingress_port=8
    egress_port=16
    front_pairs='8:16 9:17 10:18 11:19 12:20 13:21 14:22 15:23'
    recirc_ports=24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55
    model_ports='8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 43 44 45 46 47 48 49 50 51 52 53 54 55'
    port_speed=BF_SPEED_100G
    port_fec=BF_FEC_TYP_REED_SOLOMON
    channel_mac_1='{"0":"02:00:00:00:00:01","2":"02:00:00:00:00:03","4":"02:00:00:00:00:05","6":"02:00:00:00:00:07"}'
    channel_mac_2='{"0":"02:00:00:00:00:11","2":"02:00:00:00:00:13","4":"02:00:00:00:00:15","6":"02:00:00:00:00:17"}'
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

port_map='{"PortToIf":['
separator=
for port in $model_ports; do
  port_map+="${separator}{\"device_port\":${port},\"if\":\"p${port}\"}"
  separator=,
done
port_map+=']}'

mkdir -p "$runtime/run"
chmod 0777 "$runtime" "$runtime/run"
printf '%s\n' \
  '{' \
  '  "tg_ports": [' \
  "    {\"port\": 1, \"mac\": \"02:00:00:00:00:01\", \"speed\": \"$port_speed\", \"fec\": \"$port_fec\", \"auto_negotiation\": \"PM_AN_DEFAULT\", \"channel_count\": 4, \"arp_reply\": false, \"channel_mac\": $channel_mac_1, \"recirculation_ports\": {\"tx_port\": 3, \"rx_port\": 4}}," \
  "    {\"port\": 2, \"mac\": \"02:00:00:00:00:11\", \"speed\": \"$port_speed\", \"fec\": \"$port_fec\", \"auto_negotiation\": \"PM_AN_DEFAULT\", \"channel_count\": 4, \"arp_reply\": false, \"channel_mac\": $channel_mac_2, \"recirculation_ports\": {\"tx_port\": 5, \"rx_port\": 6}}" \
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
  -e P4TG_EGRESS_PORT="$egress_port" -e P4TG_FRONT_PAIRS="$front_pairs" \
  -e P4TG_RECIRC_PORTS="$recirc_ports" \
  --entrypoint bash "$netsim_image" -ec '
    for pair in $P4TG_FRONT_PAIRS; do
      ingress=${pair%%:*}
      egress=${pair##*:}
      ip link add "p$ingress" type veth peer name "p$egress"
      ip link set dev "p$ingress" addrgenmode none
      ip link set dev "p$egress" addrgenmode none
      ip link set "p$ingress" up
      ip link set "p$egress" up
    done
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

docker run --rm --name "$test_container" --network "container:$container" \
  --cap-drop ALL --security-opt no-new-privileges:true \
  --entrypoint /app/p4tg-model-tests p4tg-ci-controller:local

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
docker run --rm --name "$test_container" --network "container:$container" \
  --cap-drop ALL --security-opt no-new-privileges:true \
  -e P4TG_ASSERT_DATA_PLANE=1 \
  --entrypoint /app/p4tg-model-tests p4tg-ci-controller:local
docker exec "$container" curl --fail --silent -X DELETE \
  'http://127.0.0.1:18080/api/trafficgen?skip=true' >/dev/null
printf 'traffic=%s\n' "$(cat "$runtime/traffic-response.json")"
printf 'online_after_traffic=%s\n' "$(cat "$runtime/online-after-traffic.json")"
printf 'statistics_file=%s/statistics.json\n' "$runtime"

if grep -q '"digests_alive":false' "$runtime/online-after-traffic.json"; then
  echo "$target digest pipeline did not become live during the feasibility window" >&2
  exit 1
fi

# bf_switchd allows one P4 owner. Exercise rbfrt directly only after all REST
# assertions are complete and the controller has released its ownership.
docker stop "$controller_container" >/dev/null
docker run --rm --name "$test_container" --network "container:$container" \
  --cap-drop ALL --security-opt no-new-privileges:true \
  -e P4TG_TARGET="$target" -e P4TG_ASSERT_CONFIG_VALIDATION=1 \
  --entrypoint /app/p4tg-model-tests p4tg-ci-controller:local
docker run --rm --name "$test_container" --network "container:$container" \
  --cap-drop ALL --security-opt no-new-privileges:true \
  -e P4TG_DIRECT_BFRT=1 \
  --entrypoint /app/p4tg-model-tests p4tg-ci-controller:local
