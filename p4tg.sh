#!/usr/bin/env bash
# Copyright 2025-present University of Tuebingen, Chair of Communication Networks
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
#
# Fabian Ihle (fabian.ihle@uni-tuebingen.de)
#
#
# p4tg.sh — manage kernel module, data plane, and control plane
# Usage: ./p4tg.sh [install|update|start|stop|restart|status][--nightly]
#
# Exit codes:
#   0  : success
#   1  : bad usage / missing env vars or files
#   2  : failed to (ensure) kernel module loaded
#   3  : failed to start data plane
#   4  : data plane did not become "ready" within timeout
#   5  : failed to start/stop control plane container
#   6  : docker not available or daemon not running

set -Eeuo pipefail

###########################
# Configuration (edit me) #
###########################
P4TG_DIR="${P4TG_DIR:-/opt/P4TG}"                           # root of repository checkout
LOG_DIR="${LOG_DIR:-/var/log/traffic_gen}"                  # where to store logs
SWITCHD_LOG="${SWITCHD_LOG:-$LOG_DIR/switchd.log}"

# Runtime files (PID/state). Prefer /run; fall back to ~/.cache if needed.
RUNTIME_DIR="${RUNTIME_DIR:-/run/traffic_gen}"
FALLBACK_RUNTIME_DIR="${HOME}/.cache/traffic_gen"
DP_PIDFILE="${DP_PIDFILE:-$RUNTIME_DIR/dp.pid}"

TIMEOUT_SECS="${TIMEOUT_SECS:-60}"                          # max wait for data plane readiness
TARGET="unknown"
PROGRAM_NAME="${PROGRAM_NAME:-traffic_gen}"                 # passed to run_switchd.sh via -p
CONTROLLER_CONTAINER="${CONTROLLER_CONTAINER:-p4tg-controller}"
READY_PORT="${READY_PORT:-9999}"                            # port bf_switchd listens on when ready
NIGHTLY_MODE=false                                          # whether to use nightly branch/images

#################
# Pretty output #
#################
ts() { date "+%Y-%m-%d %H:%M:%S%z"; }
info()  { echo "[INFO ] $(ts) $*"; }
warn()  { echo "[WARN ] $(ts) $*" >&2; }
error() { echo "[ERROR] $(ts) $*" >&2; }

########################################
# Helpers & sanity checks / prerequisites
########################################
require_env_dir() {
  local var_name="$1"
  local val="${!var_name:-}"
  if [[ -z "${val}" ]]; then
    error "Environment variable $var_name is not set."
    exit 1
  fi
  if [[ ! -d "${val}" ]]; then
    error "Directory in $var_name does not exist: ${val}"
    exit 1
  fi
}

require_exe() {
  local path="$1"
  if [[ ! -x "$path" ]]; then
    error "Required executable not found or not executable: $path"
    exit 1
  fi
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    error "Required command not found in PATH: $cmd"
    exit 1
  fi
}

ensure_log_dir() {
  if [[ ! -d "$LOG_DIR" ]]; then
    sudo mkdir -p "$LOG_DIR" 2>/dev/null || mkdir -p "$LOG_DIR" || {
      error "Unable to create log directory: $LOG_DIR (try running with sudo)."
      exit 1
    }
  fi
  touch "$SWITCHD_LOG" 2>/dev/null || true
}

ensure_runtime_dir() {
  local dir="$RUNTIME_DIR"
  if [[ ! -d "$dir" ]]; then
    if ! (sudo mkdir -p "$dir" 2>/dev/null || mkdir -p "$dir"); then
      warn "Cannot create $dir; using fallback $FALLBACK_RUNTIME_DIR"
      RUNTIME_DIR="$FALLBACK_RUNTIME_DIR"
      DP_PIDFILE="$RUNTIME_DIR/dp.pid"
      mkdir -p "$RUNTIME_DIR"
    fi
  fi
}

backup_platform_conf() {
  local conf="/etc/platform.conf"
  local bak="/etc/platform.conf.bak"

  if [[ ! -e "$conf" ]]; then
    return 0
  fi

  local dest="$bak"
  if [[ -e "$bak" ]]; then
    dest="${bak}.$(date +%s)"
    warn "$bak already exists; backing up to $dest instead."
  fi

  info "Backing up $conf to $dest before running."
  if mv "$conf" "$dest" 2>/dev/null; then
    return 0
  fi

  if command -v sudo >/dev/null 2>&1; then
    if sudo mv "$conf" "$dest"; then
      return 0
    fi
  fi

  error "Failed to move $conf to $dest (insufficient permissions?)."
  exit 1
}

########################################
# Kernel module handling
########################################
is_mod_loaded() {
  local name="$1"
  lsmod | awk '{print $1}' | grep -qx "$name"
}

run_xt_cfgen_fallback() {
  local target_mod="$1"
  local script="$SDE_INSTALL/bin/xt-cfgen.sh"

  if [[ ! -x "$script" ]]; then
    warn "Fallback loader for '$target_mod' not found or not executable: $script"
    return 1
  fi

  info "Attempting fallback loader for '$target_mod' via: $script"
  set +e
  "$script"
  local rc=$?
  set -e

  if [[ $rc -eq 0 ]] && is_mod_loaded "$target_mod"; then
    info "Fallback xt-cfgen.sh loaded '$target_mod' successfully."
    return 0
  fi

  if is_mod_loaded "$target_mod"; then
    warn "xt-cfgen.sh returned $rc, but module '$target_mod' appears loaded. Continuing."
    return 0
  fi

  error "Fallback xt-cfgen.sh failed to load '$target_mod' (exit $rc)."
  return 1
}

load_kernel_module_if_needed() {
  detect_tofino_generation

  local modules=("bf_kdrv")
  local loaders=("$SDE_INSTALL/bin/bf_kdrv_mod_load")

  if [[ "$TARGET" == "tofino2" ]]; then
    modules+=("bf_fpga")
    loaders+=("$SDE_INSTALL/bin/bf_fpga_mod_load")
  fi

  local idx
  for idx in "${!modules[@]}"; do
    local kmod="${modules[$idx]}"
    local loader="${loaders[$idx]}"

    if [[ "$kmod" == "bf_fpga" && ! -x "$loader" ]]; then
      warn "Loader for '$kmod' not found at $loader; trying xt-cfgen.sh fallback."
      if run_xt_cfgen_fallback "$kmod"; then
        continue
      else
        return 2
      fi
    fi

    require_exe "$loader"

    if is_mod_loaded "$kmod"; then
      info "Kernel module '$kmod' already loaded. Skipping load step."
      continue
    fi

    info "Loading kernel module via: $loader $SDE_INSTALL"
    set +e
    "$loader" "$SDE_INSTALL"
    local rc=$?
    set -e

    if [[ $rc -eq 0 ]]; then
      info "Kernel module '$kmod' loaded successfully."
      continue
    fi

    if [[ "$kmod" == "bf_fpga" ]]; then
      warn "Primary loader for '$kmod' failed (exit $rc); attempting xt-cfgen.sh fallback."
      if run_xt_cfgen_fallback "$kmod"; then
        continue
      fi
    fi

    if is_mod_loaded "$kmod"; then
      warn "Loader returned $rc, but module '$kmod' appears loaded. Continuing."
      continue
    fi
    error "Failed to load kernel module '$kmod' (exit $rc)."
    return 2
  done

  return 0
}

########################################
# Data plane start & readiness (port-based check)
########################################
start_dataplane_background() {
  local runner="$SDE/run_switchd.sh"
  require_exe "$runner"
  detect_tofino_generation
  ensure_log_dir
  ensure_runtime_dir

  if dp_is_running; then
    info "Data plane already running (PID $(cat "$DP_PIDFILE" 2>/dev/null || echo '?'))."
    return 0
  fi

  local arch="unknown"
  case "$TARGET" in
    tofino2)
      arch="tf2"
      ;;
    tofino1)
      arch="tf1"
      ;;
    *)
      warn "Unknown Tofino target '$TARGET';"
      exit 1
      ;;
  esac

  local -a runner_cmd=("$runner" "--arch" "$arch" "-p" "$PROGRAM_NAME")
  # run_switchd.sh uses sudo and manipulates tty; wrap with nohup and detach stdin to avoid SIGHUP/stty errors on non-interactive shells.
  local -a runner_wrapper=("nohup")
  if ! command -v nohup >/dev/null 2>&1; then
    runner_wrapper=()
  fi

  info "Starting data plane in background: $runner --arch $arch -p $PROGRAM_NAME"
  if command -v stdbuf >/dev/null 2>&1; then
    if "${runner_wrapper[@]}" stdbuf -oL -eL "${runner_cmd[@]}" </dev/null >>"$SWITCHD_LOG" 2>&1 & then :; else
      warn "Direct write to $SWITCHD_LOG failed; attempting via sudo tee."
      "${runner_wrapper[@]}" stdbuf -oL -eL "${runner_cmd[@]}" </dev/null 2>&1 | sudo tee -a "$SWITCHD_LOG" >/dev/null &
    fi
  else
    if "${runner_wrapper[@]}" "${runner_cmd[@]}" </dev/null >>"$SWITCHD_LOG" 2>&1 & then :; else
      warn "Direct write to $SWITCHD_LOG failed; attempting via sudo tee."
      "${runner_wrapper[@]}" "${runner_cmd[@]}" </dev/null 2>&1 | sudo tee -a "$SWITCHD_LOG" >/dev/null &
    fi
  fi

  local dp_pid=$!
  echo "$dp_pid" > "$DP_PIDFILE"
  disown "$dp_pid" || true
  info "Data plane started (PID: $dp_pid); logging to $SWITCHD_LOG"
  return 0
}

# Wait until bf_switchd listens on port READY_PORT
wait_for_dataplane_port() {
  info "Waiting (up to ${TIMEOUT_SECS}s) for data plane port ${READY_PORT} to become available..."

  local elapsed=0
  local interval=1

  while (( elapsed < TIMEOUT_SECS )); do
    # Prefer ss, fallback to netstat
    if command -v ss >/dev/null 2>&1; then
      if ss -ltn "( sport = :$READY_PORT )" 2>/dev/null | grep -q ":$READY_PORT"; then
        info "Data plane ready — port ${READY_PORT} is listening."
        return 0
      fi
    elif command -v netstat >/dev/null 2>&1; then
      if netstat -tuln 2>/dev/null | grep -q ":${READY_PORT}[[:space:]]"; then
        info "Data plane ready — port ${READY_PORT} is listening."
        return 0
      fi
    else
      error "Neither ss nor netstat found. Cannot check port readiness."
      return 4
    fi

    if ! dp_is_running; then
      error "Data plane process exited before port ${READY_PORT} became available."
      return 3
    fi

    sleep "$interval"
    (( elapsed += interval ))
  done

  error "Timeout: port ${READY_PORT} not listening after ${TIMEOUT_SECS}s."
  if dp_is_running; then
    warn "Last 50 log lines for context:"
    tail -n 50 "$SWITCHD_LOG" 2>/dev/null || true
  fi
  return 4
}

dp_is_running() {
  if [[ -f "$DP_PIDFILE" ]]; then
    local pid; pid="$(cat "$DP_PIDFILE" 2>/dev/null || echo "")"
    if [[ -n "$pid" ]] && ps -p "$pid" >/dev/null 2>&1; then
      return 0
    fi
  fi
  if pgrep -f "bf_switchd" >/dev/null 2>&1 || pgrep -f "run_switchd.sh.*-p[[:space:]]*$PROGRAM_NAME" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

dp_stop_now() {
  info "Force-stopping data plane (bf_switchd and run_switchd.sh)..."

  # Kill by known PID if we have one
  if [[ -f "$DP_PIDFILE" ]]; then
    local pid
    pid="$(cat "$DP_PIDFILE" 2>/dev/null || echo "")"
    if [[ -n "$pid" ]]; then
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$DP_PIDFILE"
  fi

  # Kill any remaining processes that might still be alive
  pkill -9 -f "bf_switchd" 2>/dev/null || true
  pkill -9 -f "run_switchd.sh" 2>/dev/null || true

  # Double-check
  if pgrep -f "bf_switchd|run_switchd.sh" >/dev/null 2>&1; then
    warn "Some bf_switchd processes may still be alive — check manually:"
    pgrep -a -f "bf_switchd|run_switchd.sh" || true
  else
    info "Data plane force-stopped successfully."
  fi
}

detect_tofino_generation() {
  # Default to unknown
  TARGET="unknown"

  # Barefoot vendor ID
  local barefoot_vendor="0x1d1c"

  # Search PCI devices for Barefoot/Tofino entries
  for devpath in /sys/bus/pci/devices/*; do
    [[ -r "$devpath/vendor" && -r "$devpath/device" ]] || continue
    local v d
    v="$(<"$devpath/vendor")"
    d="$(<"$devpath/device")"

    # Only look at Barefoot vendor devices
    [[ "$v" != "$barefoot_vendor" ]] && continue

    case "$d" in
      0x0001|0x0010)
        TARGET="tofino1"
        break
        ;;
      0x0100|0x0110)
        TARGET="tofino2"
        break
        ;;
      *)
        ;;
    esac
  done

  if [[ "$TARGET" == "unknown" ]]; then
    # Try lspci fallback (if sysfs didn’t find anything)
    if command -v lspci >/dev/null 2>&1; then
      if lspci -nn -d 1d1c: | grep -Eq '1d1c:(0001|0010)'; then
        TARGET="tofino1"
      elif lspci -nn -d 1d1c: | grep -Eq '1d1c:(0100|0110)'; then
        TARGET="tofino2"
      elif lspci -nn -d 1d1c: | grep -Eq '1d1c:(0200|0210)'; then
        TARGET="tofino3"
      fi
    fi
  fi

  info "Detected Tofino generation: $TARGET"
}



########################################
# Control plane (Docker) start/stop/status
########################################
ensure_docker_ready() {
  require_cmd docker
  if ! docker info >/dev/null 2>&1; then
    error "Docker daemon not reachable. Is the service running and do you have permissions?"
    return 6
  fi
}

controller_exists() {
  docker inspect "$CONTROLLER_CONTAINER" >/dev/null 2>&1
}

controller_is_running() {
  [[ "$(docker inspect -f '{{.State.Running}}' "$CONTROLLER_CONTAINER" 2>/dev/null || echo false)" == "true" ]]
}

start_controller_container() {
  ensure_docker_ready || return 6
  local controller_dir="$P4TG_DIR/Controller"
  if [[ ! -d "$controller_dir" ]]; then
    error "Controller directory not found: $controller_dir"
    return 5
  fi
  local compose_cmd="docker compose up -d"
  if [[ "$NIGHTLY_MODE" == "true" ]]; then
    compose_cmd="TAG=nightly docker compose up -d"
  fi
  info "Starting control plane containers via $compose_cmd"
  if ! (cd "$controller_dir" && eval "$compose_cmd"); then
    error "docker compose up failed."
    return 5
  fi
  info "Control plane containers started."
}

stop_controller_container() {
  ensure_docker_ready || return 6
  local controller_dir="$P4TG_DIR/Controller"
  if [[ ! -d "$controller_dir" ]]; then
    info "Controller directory not found: $controller_dir; nothing to stop."
    return 0
  fi
  local compose_cmd="docker compose down"
  if [[ "$NIGHTLY_MODE" == "true" ]]; then
    compose_cmd="TAG=nightly docker compose down"
  fi
  if controller_is_running; then
    info "Stopping control plane container: $CONTROLLER_CONTAINER"
  else
    info "Ensuring control plane containers are stopped via $compose_cmd"
  fi
  if ! (cd "$controller_dir" && eval "$compose_cmd"); then
    error "docker compose down failed."
    return 5
  fi
  info "Control plane containers stopped."
}

########################################
# High-level commands
########################################
cmd_install() {
  info "=== p4tg: INSTALL ==="

  require_cmd git
  require_cmd make
  require_cmd docker
  require_cmd ln

  if [[ ! -d "$P4TG_DIR" ]]; then
    error "P4TG directory not found: $P4TG_DIR"
    return 1
  fi

  detect_tofino_generation
  local compile_target=""
  case "$TARGET" in
    tofino2)
      compile_target="tofino2"
      ;;
    tofino1)
      compile_target="tofino"
      ;;
    *)
      error "Target '$TARGET' unknown."
      exit 1
      ;;
  esac

  info "Updating repository at $P4TG_DIR"
  local branch="main"
  if [[ "$NIGHTLY_MODE" == "true" ]]; then
    branch="nightly"
  fi
  info "Checking out branch: $branch"
  if ! (cd "$P4TG_DIR" && git checkout "$branch" && git pull); then
    error "git checkout/pull failed for branch '$branch' in $P4TG_DIR"
    return 1
  fi

  local dataplane_dir="$P4TG_DIR/P4-Implementation"
  if [[ ! -d "$dataplane_dir" ]]; then
    error "Data plane directory not found: $dataplane_dir"
    return 1
  fi

  info "Building data plane: make compile TARGET=$compile_target"
  if ! (cd "$dataplane_dir" && make compile TARGET="$compile_target"); then
    error "Data plane build failed."
    return 1
  fi

  local controller_dir="$P4TG_DIR/Controller"
  if [[ ! -d "$controller_dir" ]]; then
    error "Controller directory not found: $controller_dir"
    return 1
  fi

  info "Updating control plane containers with docker compose pull"
  local compose_cmd="docker compose pull"
  if [[ "$NIGHTLY_MODE" == "true" ]]; then
    compose_cmd="TAG=nightly docker compose pull"
  fi
  if ! (cd "$controller_dir" && eval "$compose_cmd"); then
    error "docker compose pull failed."
    return 1
  fi

  local symlink_target="/usr/local/bin/p4tg.sh"
  if [[ ! -e "$symlink_target" ]]; then
    info "Creating symlink $symlink_target -> $P4TG_DIR/p4tg.sh"
    if ! ln -s "$P4TG_DIR/p4tg.sh" "$symlink_target"; then
      error "Failed to create symlink at $symlink_target"
      return 1
    fi
  else
    info "Symlink target $symlink_target already exists; skipping creation."
  fi

  local service_src="$P4TG_DIR/p4tg.service"
  local service_dest="/etc/systemd/system/p4tg.service"
  if [[ ! -f "$service_src" ]]; then
    error "Service file not found: $service_src"
    return 1
  fi
  if [[ ! -f "$service_dest" ]]; then
    info "Copying service file to $service_dest"
    if ! cp "$service_src" "$service_dest"; then
      error "Failed to copy service file to $service_dest"
      return 1
    fi
  else
    info "Service file $service_dest already exists; skipping copy."
  fi

  info "✅ Install completed."

  local start_choice="n"
  if [[ -t 0 ]]; then
    read -r -p "Start p4tg now? [y/N]: " start_choice
  else
    info "No interactive terminal detected; skipping start prompt."
  fi

  case "${start_choice,,}" in
    y|yes)
      info "Stopping any running instance before start."
      if ! sudo -E /usr/local/bin/p4tg.sh stop; then
        warn "p4tg stop command failed; proceeding with start attempt."
      fi
      info "Starting p4tg via sudo -E /usr/local/bin/p4tg.sh start"
      if ! sudo -E /usr/local/bin/p4tg.sh start; then
        warn "p4tg start command failed; please check logs."
      fi
      ;;
    *)
      info "Skipping immediate start."
      ;;
  esac

  if command -v systemctl >/dev/null 2>&1; then
    local enable_choice="n"
    if [[ -t 0 ]]; then
      read -r -p "Enable p4tg service at boot? [y/N]: " enable_choice
    else
      info "No interactive terminal detected; skipping enable prompt."
    fi

    case "${enable_choice,,}" in
      y|yes)
        info "Enabling p4tg service via systemctl."
        if ! sudo systemctl enable p4tg; then
          warn "Failed to enable p4tg service."
        fi
        ;;
      *)
        info "Leaving p4tg service disabled at boot."
        ;;
    esac
  else
    info "systemctl not available; skipping service enable prompt."
  fi

  return 0
}

cmd_start() {
  info "=== p4tg: START ==="
  require_env_dir SDE
  require_env_dir SDE_INSTALL
  load_kernel_module_if_needed || exit $?
  start_dataplane_background || exit $?
  wait_for_dataplane_port || exit $?
  start_controller_container || exit $?
  info "✅ Start completed."
}

cmd_stop() {
  info "=== p4tg: STOP ==="
  if command -v docker >/dev/null 2>&1; then
    stop_controller_container || true
  else
    info "Docker not installed; skipping control plane stop."
  fi
  if dp_is_running; then
    dp_stop_now || true
    info "Data plane stopped."
  else
    info "Data plane not running."
  fi
  info "✅ Stop completed."
}

cmd_restart() {
  info "=== p4tg: RESTART ==="
  cmd_stop
  sleep 1
  cmd_start
}

cmd_status() {
  info "=== p4tg: STATUS ==="
  detect_tofino_generation

  local kmods=("bf_kdrv")
  if [[ "$TARGET" == "tofino2" ]]; then
    kmods+=("bf_fpga")
  fi

  local kmod
  for kmod in "${kmods[@]}"; do
    if is_mod_loaded "$kmod"; then
      info "Kernel module '$kmod': LOADED"
    else
      info "Kernel module '$kmod': NOT loaded"
    fi
  done

  if dp_is_running; then
    local pid="unknown"
    [[ -f "$DP_PIDFILE" ]] && pid="$(cat "$DP_PIDFILE" 2>/dev/null || echo "unknown")"
    info "Data plane: RUNNING (PID ${pid}); log: $SWITCHD_LOG"
    if command -v ss >/dev/null 2>&1 && ss -ltn "( sport = :$READY_PORT )" 2>/dev/null | grep -q ":$READY_PORT"; then
      info "Port ${READY_PORT} is LISTENING — data plane ready."
    elif command -v netstat >/dev/null 2>&1 && netstat -tuln 2>/dev/null | grep -q ":${READY_PORT}[[:space:]]"; then
      info "Port ${READY_PORT} is LISTENING — data plane ready."
    else
      warn "Port ${READY_PORT} not listening yet."
    fi
  else
    info "Data plane: NOT running"
  fi

  if command -v docker >/dev/null 2>&1; then
    if controller_exists; then
      if controller_is_running; then
        info "Control plane container '$CONTROLLER_CONTAINER': RUNNING"
      else
        info "Control plane container '$CONTROLLER_CONTAINER': STOPPED"
      fi
    else
      info "Control plane container '$CONTROLLER_CONTAINER': NOT FOUND"
    fi
  else
    info "Docker: not installed"
  fi
}

########################################
# Entry point
########################################
usage() {
  echo "Usage: $0 [--nightly] [install|update|start|stop|restart|status]"
  echo ""
  echo "Options:"
  echo "  --nightly    Use the nightly branch and nightly Docker images"
  echo ""
  echo "Commands:"
  echo "  install      Install P4TG (build data plane, pull containers, setup service)"
  echo "  update       Same as install"
  echo "  start        Start data plane and control plane"
  echo "  stop         Stop data plane and control plane"
  echo "  restart      Stop and then start"
  echo "  status       Show status of kernel modules, data plane, and control plane"
}

main() {
  # Parse --nightly flag
  local -a args=()
  for arg in "$@"; do
    if [[ "$arg" == "--nightly" ]]; then
      NIGHTLY_MODE=true
    else
      args+=("$arg")
    fi
  done

  local cmd="${args[0]:-help}"
  backup_platform_conf
  case "$cmd" in
    install) cmd_install ;;
    update) cmd_install ;;
    start)   cmd_start ;;
    stop)    cmd_stop ;;
    restart) cmd_restart ;;
    status)  cmd_status ;;
    *) usage; exit 1 ;;
  esac
}

main "$@"
