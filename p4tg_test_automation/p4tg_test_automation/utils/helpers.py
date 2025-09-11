import json, os
from typing import Any
import time, math
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
    