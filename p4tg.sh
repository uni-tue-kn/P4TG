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
# Usage: ./p4tg.sh [--nightly|--stable] [install|update|start|stop|restart|status]
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

########################################
# Required user configuration          #
########################################
# P4TG itself needs only these two environment variables. They must point to
# an installed Intel/Barefoot SDE before running install, update, start, or
# restart. Example:
#
#   export SDE=/opt/bf-sde-9.13.4
#   export SDE_INSTALL="$SDE/install"
#   sudo -E ./p4tg.sh install
#
# P4TG_DIR normally does NOT need configuration: it is derived from this
# script's real location, including when invoked through /usr/local/bin/p4tg.sh.
# Review Controller/config.json separately to select the TG ports for the host.

add_sde_paths_to_path() {
  # sudo's secure_path overrides PATH even with -E; restore the SDE paths.
  if [[ -n "${SDE_INSTALL:-}" && ":$PATH:" != *":$SDE_INSTALL/bin:"* ]]; then
    PATH="$SDE_INSTALL/bin:$PATH"
  fi
  if [[ -n "${SDE:-}" && ":$PATH:" != *":$SDE:"* ]]; then
    PATH="$SDE:$PATH"
  fi
  export PATH
}

add_sde_paths_to_path

########################################
# Derived paths and optional overrides #
########################################
# Resolve default repo root from the script location (handles symlinked invocations).
SCRIPT_SOURCE="${BASH_SOURCE[0]}"
if command -v readlink >/dev/null 2>&1; then
  SCRIPT_SOURCE="$(readlink -f "$SCRIPT_SOURCE" 2>/dev/null || echo "$SCRIPT_SOURCE")"
fi
if ! SCRIPT_DIR="$(cd -P -- "$(dirname -- "$SCRIPT_SOURCE")" 2>/dev/null && pwd)"; then
  SCRIPT_DIR="$(pwd)"
fi

P4TG_DIR="${P4TG_DIR:-$SCRIPT_DIR}"                         # root of repository checkout
if [[ -d "$P4TG_DIR" ]]; then
  P4TG_DIR="$(cd -P -- "$P4TG_DIR" && pwd)"
fi
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
P4TG_ENV_FILE="${P4TG_ENV_FILE:-/etc/default/p4tg}"
COMMAND_LINK="${COMMAND_LINK:-/usr/local/bin/p4tg.sh}"
SERVICE_DEST="${SERVICE_DEST:-/etc/systemd/system/p4tg.service}"
P4TG_CHANNEL="${P4TG_CHANNEL:-}"                            # latest or nightly; CLI flags override it
P4TG_INTERNAL_REEXEC="${P4TG_INTERNAL_REEXEC:-0}"
P4TG_WAS_RUNNING="${P4TG_WAS_RUNNING:-0}"
COMPILE_TARGET=""

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

load_persisted_configuration() {
  if [[ ! -r "$P4TG_ENV_FILE" ]]; then
    return 0
  fi

  local key value
  while IFS='=' read -r key value; do
    value="${value%\"}"
    value="${value#\"}"
    case "$key" in
      SDE) [[ -z "${SDE:-}" ]] && SDE="$value" ;;
      SDE_INSTALL) [[ -z "${SDE_INSTALL:-}" ]] && SDE_INSTALL="$value" ;;
      P4TG_CHANNEL) [[ -z "$P4TG_CHANNEL" ]] && P4TG_CHANNEL="$value" ;;
    esac
  done < "$P4TG_ENV_FILE"
  add_sde_paths_to_path
}

validate_channel() {
  case "$P4TG_CHANNEL" in
    latest|nightly) return 0 ;;
    *)
      error "Invalid P4TG channel '$P4TG_CHANNEL' (expected 'latest' or 'nightly')."
      return 1
      ;;
  esac
}

run_privileged() {
  if (( EUID == 0 )); then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    error "Root privileges are required to run: $*"
    return 1
  fi
}

persist_configuration() {
  local channel_dir
  channel_dir="$(dirname -- "$P4TG_ENV_FILE")"

  if ! run_privileged mkdir -p "$channel_dir"; then
    error "Failed to create channel configuration directory: $channel_dir"
    return 1
  fi
  if ! printf 'SDE="%s"\nSDE_INSTALL="%s"\nP4TG_CHANNEL="%s"\n' \
      "$SDE" "$SDE_INSTALL" "$P4TG_CHANNEL" | run_privileged tee "$P4TG_ENV_FILE" >/dev/null; then
    error "Failed to persist P4TG configuration in $P4TG_ENV_FILE"
    return 1
  fi
  info "Persisted SDE paths and P4TG channel '$P4TG_CHANNEL' in $P4TG_ENV_FILE."
}

ensure_log_dir() {
  if [[ ! -d "$LOG_DIR" ]]; then
    run_privileged mkdir -p "$LOG_DIR" || {
      error "Unable to create log directory: $LOG_DIR (try running with sudo)."
      return 1
    }
  fi
  if ! touch "$SWITCHD_LOG" 2>/dev/null; then
    error "Log file is not writable: $SWITCHD_LOG (try running with sudo)."
    return 1
  fi
}

ensure_runtime_dir() {
  local dir="$RUNTIME_DIR"
  if [[ ! -d "$dir" ]] && ! run_privileged mkdir -p "$dir"; then
    warn "Cannot create $dir; using fallback $FALLBACK_RUNTIME_DIR"
    RUNTIME_DIR="$FALLBACK_RUNTIME_DIR"
    DP_PIDFILE="$RUNTIME_DIR/dp.pid"
    mkdir -p "$RUNTIME_DIR"
  fi
  if [[ ! -w "$RUNTIME_DIR" ]]; then
    error "Runtime directory is not writable: $RUNTIME_DIR (try running with sudo)."
    return 1
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
    dest="${bak}.$(date +%Y%m%d%H%M%S).$$"
    warn "$bak already exists; backing up to $dest instead."
  fi

  info "Backing up $conf to $dest before running."
  if mv "$conf" "$dest" 2>/dev/null; then
    return 0
  fi

  if run_privileged mv "$conf" "$dest"; then
    return 0
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
  # xt-cfgen.sh expects sibling scripts (e.g. xt-setup.sh) to be in PATH
  local rc=0
  PATH="$SDE_INSTALL/bin:$PATH" "$script" || rc=$?

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

    if is_mod_loaded "$kmod"; then
      info "Kernel module '$kmod' already loaded. Skipping load step."
      continue
    fi

    if [[ "$kmod" == "bf_fpga" && ! -x "$loader" ]]; then
      warn "Loader for '$kmod' not found at $loader; trying xt-cfgen.sh fallback."
      if run_xt_cfgen_fallback "$kmod"; then
        continue
      fi
      # bf_fpga is not available on all platforms (e.g. Asterfusion).
      # If the module file doesn't exist in the kernel, treat it as optional.
      if ! modinfo bf_fpga >/dev/null 2>&1; then
        warn "Kernel module 'bf_fpga' not available on this system; skipping (non-fatal)."
        continue
      fi
      return 2
    fi

    if [[ ! -x "$loader" ]]; then
      error "Required module loader not found or not executable: $loader"
      return 2
    fi

    info "Loading kernel module via: $loader $SDE_INSTALL"
    local rc=0
    "$loader" "$SDE_INSTALL" || rc=$?

    if is_mod_loaded "$kmod"; then
      if [[ $rc -eq 0 ]]; then
        info "Kernel module '$kmod' loaded successfully."
      else
        warn "Loader returned $rc, but module '$kmod' appears loaded. Continuing."
      fi
      continue
    fi

    if [[ "$kmod" == "bf_fpga" ]]; then
      warn "Primary loader for '$kmod' did not load the module (exit $rc); attempting xt-cfgen.sh fallback."
      if run_xt_cfgen_fallback "$kmod"; then
        continue
      fi
      # bf_fpga is not available on all platforms (e.g. Asterfusion).
      if ! modinfo bf_fpga >/dev/null 2>&1; then
        warn "Kernel module 'bf_fpga' not available on this system; skipping (non-fatal)."
        continue
      fi
    fi

    if [[ $rc -eq 0 ]]; then
      error "Loader returned success, but kernel module '$kmod' is not loaded."
    else
      error "Failed to load kernel module '$kmod' (exit $rc)."
    fi
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
  ensure_log_dir || return 1
  ensure_runtime_dir || return 1

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
    "${runner_wrapper[@]}" stdbuf -oL -eL "${runner_cmd[@]}" </dev/null >>"$SWITCHD_LOG" 2>&1 &
  else
    "${runner_wrapper[@]}" "${runner_cmd[@]}" </dev/null >>"$SWITCHD_LOG" 2>&1 &
  fi

  local dp_pid=$!
  sleep 0.2
  if ! ps -p "$dp_pid" >/dev/null 2>&1 && ! dp_is_running; then
    local rc=0
    wait "$dp_pid" || rc=$?
    error "Data plane process exited immediately (exit $rc)."
    tail -n 20 "$SWITCHD_LOG" 2>/dev/null || true
    return 3
  fi
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

controller_compose() {
  local controller_dir="$P4TG_DIR/Controller"
  if [[ ! -d "$controller_dir" ]]; then
    error "Controller directory not found: $controller_dir"
    return 5
  fi

  (
    cd "$controller_dir"
    env \
      TAG="$P4TG_CHANNEL" \
      P4TG_CONFIG_PATH="$controller_dir/config.json" \
      docker compose "$@"
  )
}

expected_controller_image() {
  local images
  images="$(controller_compose config --images)" || return 5
  printf '%s\n' "$images" | sed -n '1p'
}

verify_controller_container() {
  local expected_image actual_image
  expected_image="$(expected_controller_image)" || return 5
  actual_image="$(docker inspect -f '{{.Config.Image}}' "$CONTROLLER_CONTAINER" 2>/dev/null)" || {
    error "Controller container '$CONTROLLER_CONTAINER' was not created."
    return 5
  }

  if [[ "$actual_image" != "$expected_image" ]]; then
    error "Controller image mismatch: expected '$expected_image', found '$actual_image'."
    return 5
  fi
  if ! controller_is_running; then
    error "Controller container '$CONTROLLER_CONTAINER' is not running."
    return 5
  fi
  info "Verified running controller image: $actual_image"
}

start_controller_container() {
  ensure_docker_ready || return 6
  info "Starting control plane containers with channel '$P4TG_CHANNEL'."
  if ! controller_compose up -d; then
    error "docker compose up failed."
    return 5
  fi
  verify_controller_container || return $?
  info "Control plane containers started."
}

stop_controller_container() {
  ensure_docker_ready || return 6
  if [[ ! -d "$P4TG_DIR/Controller" ]]; then
    info "Controller directory not found: $P4TG_DIR/Controller; nothing to stop."
    return 0
  fi
  if controller_is_running; then
    info "Stopping control plane container: $CONTROLLER_CONTAINER"
  else
    info "Ensuring control plane containers are stopped."
  fi
  if ! controller_compose down; then
    error "docker compose down failed."
    return 5
  fi
  info "Control plane containers stopped."
}

########################################
# High-level commands
########################################
preflight_install_update() {
  require_env_dir SDE
  require_env_dir SDE_INSTALL
  require_cmd git
  require_cmd make
  require_cmd docker
  require_cmd ln
  ensure_docker_ready || return $?

  if [[ ! -d "$P4TG_DIR" ]]; then
    error "P4TG directory not found: $P4TG_DIR"
    return 1
  fi
}

compile_target_for_host() {
  detect_tofino_generation
  case "$TARGET" in
    tofino2) COMPILE_TARGET="tofino2" ;;
    tofino1) COMPILE_TARGET="tofino" ;;
    *)
      error "Target '$TARGET' unknown."
      return 1
      ;;
  esac
}

sync_repository() {
  local operation="$1"
  local branch="main"
  [[ "$P4TG_CHANNEL" == "nightly" ]] && branch="nightly"

  if [[ "$P4TG_INTERNAL_REEXEC" == "1" ]]; then
    info "Repository already synchronized; continuing with the updated script."
    return 0
  fi

  info "Updating repository at $P4TG_DIR"
  info "Checking out branch: $branch"
  if ! (cd "$P4TG_DIR" && git checkout "$branch" && git pull); then
    error "git checkout/pull failed for branch '$branch' in $P4TG_DIR"
    return 1
  fi

  # Continue with the script version that was just checked out instead of
  # running the remainder of an update with stale in-memory function bodies.
  info "Continuing $operation with the updated p4tg.sh."
  # shellcheck disable=SC2093 # Intentionally replace the stale, pre-update script process.
  exec env \
    P4TG_INTERNAL_REEXEC=1 \
    P4TG_WAS_RUNNING="$P4TG_WAS_RUNNING" \
    P4TG_CHANNEL="$P4TG_CHANNEL" \
    P4TG_DIR="$P4TG_DIR" \
    bash "$P4TG_DIR/p4tg.sh" "$operation"
  error "Failed to re-execute the updated p4tg.sh."
  return 1
}

build_and_pull() {
  compile_target_for_host || return 1

  local dataplane_dir="$P4TG_DIR/P4-Implementation"
  if [[ ! -d "$dataplane_dir" ]]; then
    error "Data plane directory not found: $dataplane_dir"
    return 1
  fi

  info "Building data plane: make compile TARGET=$COMPILE_TARGET"
  if ! (cd "$dataplane_dir" && make compile TARGET="$COMPILE_TARGET"); then
    error "Data plane build failed."
    return 1
  fi

  local controller_dir="$P4TG_DIR/Controller"
  if [[ ! -d "$controller_dir" ]]; then
    error "Controller directory not found: $controller_dir"
    return 1
  fi

  info "Updating control plane containers with docker compose pull"
  if ! controller_compose pull; then
    error "docker compose pull failed."
    return 5
  fi
}

install_integration_files() {
  local desired_script="$P4TG_DIR/p4tg.sh"
  if [[ -L "$COMMAND_LINK" && "$(readlink -f "$COMMAND_LINK" 2>/dev/null || true)" == "$desired_script" ]]; then
    info "Command symlink is current: $COMMAND_LINK -> $desired_script"
  elif [[ -d "$COMMAND_LINK" && ! -L "$COMMAND_LINK" ]]; then
    error "Cannot replace command path because it is a directory: $COMMAND_LINK"
    return 1
  else
    info "Installing symlink $COMMAND_LINK -> $desired_script"
    if ! run_privileged ln -sfn "$desired_script" "$COMMAND_LINK"; then
      error "Failed to install symlink at $COMMAND_LINK"
      return 1
    fi
  fi

  local service_src="$P4TG_DIR/p4tg.service"
  if [[ ! -f "$service_src" ]]; then
    error "Service file not found: $service_src"
    return 1
  fi
  if [[ -f "$SERVICE_DEST" ]] && cmp -s "$service_src" "$SERVICE_DEST"; then
    info "Systemd service file is current: $SERVICE_DEST"
  else
    info "Installing service file at $SERVICE_DEST"
    if ! run_privileged install -m 0644 "$service_src" "$SERVICE_DEST"; then
      error "Failed to install service file at $SERVICE_DEST"
      return 1
    fi
    if command -v systemctl >/dev/null 2>&1; then
      if ! run_privileged systemctl daemon-reload; then
        error "Failed to reload systemd after updating $SERVICE_DEST"
        return 1
      fi
    fi
  fi
}

perform_install_update() {
  local operation="$1"
  preflight_install_update || return $?
  sync_repository "$operation" || return $?
  build_and_pull || return $?
  install_integration_files || return $?
}

cmd_install() {
  info "=== p4tg: INSTALL ($P4TG_CHANNEL) ==="
  P4TG_WAS_RUNNING=0
  perform_install_update install || return $?

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
      cmd_stop || return $?
      info "Starting p4tg with channel '$P4TG_CHANNEL'."
      cmd_start || return $?
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
        if ! run_privileged systemctl enable p4tg; then
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

should_restart_after_update() {
  if [[ ! -t 0 ]]; then
    info "No interactive terminal detected; restarting the previously running stack."
    return 0
  fi

  local choice="y"
  read -r -p "Restart p4tg now to apply the update? [Y/n]: " choice
  case "${choice,,}" in
    ""|y|yes) return 0 ;;
    *) return 1 ;;
  esac
}

should_start_after_update() {
  if [[ ! -t 0 ]]; then
    info "No interactive terminal detected; leaving the previously stopped stack stopped."
    return 1
  fi

  local choice="n"
  read -r -p "Start p4tg now? [y/N]: " choice
  case "${choice,,}" in
    y|yes) return 0 ;;
    *) return 1 ;;
  esac
}

cmd_update() {
  info "=== p4tg: UPDATE ($P4TG_CHANNEL) ==="
  preflight_install_update || return $?

  if [[ "$P4TG_INTERNAL_REEXEC" != "1" ]]; then
    if dp_is_running || controller_is_running; then
      P4TG_WAS_RUNNING=1
    else
      P4TG_WAS_RUNNING=0
    fi
  fi

  sync_repository update || return $?
  build_and_pull || return $?
  install_integration_files || return $?

  if [[ "$P4TG_WAS_RUNNING" == "1" ]]; then
    if should_restart_after_update; then
      info "Restarting the full stack with the update."
      cmd_restart || return $?
    else
      info "Restart skipped; the existing stack continues running until it is restarted manually."
    fi
  else
    if should_start_after_update; then
      info "Starting the full stack with the update."
      cmd_start || return $?
    else
      info "P4TG was stopped before the update; the new images and data plane are staged but remain stopped."
    fi
  fi
  info "✅ Update completed."
}

cmd_start() {
  info "=== p4tg: START ($P4TG_CHANNEL) ==="
  require_env_dir SDE
  require_env_dir SDE_INSTALL
  ensure_docker_ready || return $?
  require_exe "$SDE/run_switchd.sh"
  # Asterfusion's xt-cfgen.sh fallback generates /etc/platform.conf while
  # loading bf_fpga. Move an existing file only after preflight checks, but
  # before module loading, so xt-cfgen.sh does not stop at its overwrite prompt.
  backup_platform_conf || return $?
  load_kernel_module_if_needed || return $?
  start_dataplane_background || return $?
  wait_for_dataplane_port || return $?
  start_controller_container || return $?
  info "✅ Start completed."
}

cmd_stop() {
  info "=== p4tg: STOP ==="
  local controller_rc=0
  if command -v docker >/dev/null 2>&1; then
    stop_controller_container || controller_rc=$?
  else
    info "Docker not installed; skipping control plane stop."
  fi
  if dp_is_running; then
    dp_stop_now || true
    info "Data plane stopped."
  else
    info "Data plane not running."
  fi
  if [[ $controller_rc -ne 0 ]]; then
    error "Control plane stop failed (exit $controller_rc)."
    return "$controller_rc"
  fi
  info "✅ Stop completed."
}

cmd_restart() {
  info "=== p4tg: RESTART ==="
  cmd_stop || return $?
  sleep 1
  cmd_start || return $?
}

cmd_status() {
  info "=== p4tg: STATUS ==="
  info "Release channel: $P4TG_CHANNEL"
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
  echo "Usage: $0 [--nightly|--stable] [install|update|start|stop|restart|status]"
  echo ""
  echo "Options:"
  echo "  --nightly    Use the nightly branch/image channel"
  echo "  --stable     Use the main branch/latest image channel"
  echo ""
  echo "Commands:"
  echo "  install      Install P4TG (build data plane, pull containers, setup service)"
  echo "  update       Update P4TG and restart it only if it was already running"
  echo "  start        Start data plane and control plane"
  echo "  stop         Stop data plane and control plane"
  echo "  restart      Stop and then start"
  echo "  status       Show status of kernel modules, data plane, and control plane"
}

main() {
  load_persisted_configuration

  local cmd=""
  local channel_override=""
  local arg
  for arg in "$@"; do
    case "$arg" in
      --nightly)
        if [[ -n "$channel_override" && "$channel_override" != "nightly" ]]; then
          error "--nightly and --stable cannot be used together."
          return 1
        fi
        channel_override="nightly"
        ;;
      --stable)
        if [[ -n "$channel_override" && "$channel_override" != "latest" ]]; then
          error "--nightly and --stable cannot be used together."
          return 1
        fi
        channel_override="latest"
        ;;
      -h|--help)
        usage
        return 0
        ;;
      install|update|start|stop|restart|status)
        if [[ -n "$cmd" ]]; then
          error "Multiple commands specified: '$cmd' and '$arg'."
          return 1
        fi
        cmd="$arg"
        ;;
      -* )
        error "Unknown option: $arg"
        return 1
        ;;
      *)
        error "Unexpected argument: $arg"
        return 1
        ;;
    esac
  done

  if [[ -n "$channel_override" ]]; then
    P4TG_CHANNEL="$channel_override"
  elif [[ -z "$P4TG_CHANNEL" ]]; then
    P4TG_CHANNEL="latest"
  fi
  validate_channel || return 1

  if [[ -z "$cmd" ]]; then
    usage
    return 1
  fi

  local rc=0
  case "$cmd" in
    install) cmd_install || rc=$? ;;
    update)  cmd_update || rc=$? ;;
    start)   cmd_start || rc=$? ;;
    stop)    cmd_stop || rc=$? ;;
    restart) cmd_restart || rc=$? ;;
    status)  cmd_status || rc=$? ;;
  esac
  [[ $rc -eq 0 ]] || return "$rc"

  case "$cmd" in
    install|update|start|restart) persist_configuration || return $? ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
