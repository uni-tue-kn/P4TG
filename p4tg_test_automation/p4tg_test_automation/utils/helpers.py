import json, os
from typing import Any
import time, math
import logging
from tqdm import tqdm

# ------------ Helpers ---------------

def save_stats(file_prefix, stats, payload_path):
    results_dir = "results"
    os.makedirs(results_dir, exist_ok=True)
    with open(os.path.join(results_dir, f"{file_prefix}_{os.path.basename(payload_path)}"), "w") as f:
        f.write(stats) 
        
def load_payload(path: str) -> Any:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)
    
def sleep_with_progress(seconds: float, desc: str = "Waiting"):
    steps = max(1, int(math.ceil(seconds)))        # whole-second steps
    start = time.time()
    with tqdm(total=steps, desc=desc, unit="s") as pbar:
        for i in range(steps):
            # sleep only the remaining fraction to stay accurate
            target = (i + 1)
            to_sleep = max(0.0, start + target - time.time())
            time.sleep(to_sleep)
            pbar.update(1)


def wait_for_ports_up(
    api,
    expected_ports,
    timeout_s: float = 30.0,
    poll_interval_s: float = 0.5,
    settle_s: float = 1.5,
):
    """Poll /ports until all expected (front-panel port, channel) pairs are active."""
    def _as_bool(value):
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "up", "yes", "enabled"}
        if isinstance(value, (int, float)):
            return value != 0
        return False

    deadline = time.time() + timeout_s

    while time.time() < deadline:
        ports = api.get_ports()
        if isinstance(ports, list):
            status = {}
            for entry in ports:
                if not isinstance(entry, dict):
                    continue
                fp = entry.get("port", entry.get("front_panel_port"))
                ch = entry.get("channel", 0)
                if fp is None:
                    continue
                try:
                    key = (int(fp), int(ch))
                except (TypeError, ValueError):
                    continue
                status[key] = _as_bool(entry.get("status", entry.get("active", False)))

            pending = [pc for pc in expected_ports if not status.get(pc, False)]
            if not pending:
                logging.info("All configured ports are active. Settling for %.1fs...", settle_s)
                time.sleep(settle_s)
                return

            logging.info("Waiting for ports up: %s", pending)

        time.sleep(poll_interval_s)

    raise TimeoutError(
        f"Timeout waiting for configured ports to become active: {expected_ports}"
    )
    
