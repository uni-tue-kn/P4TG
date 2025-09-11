import time
import argparse
import logging    
    
from .api.client import P4TG, FEC, Speed, AutoNeg
from .plots.rates import plot_tx_rx_rate
from .plots.histograms import plot_all_rtt_histograms
from .utils.helpers import load_payload, sleep_with_progress


# ------- Test orchestration ---------

def run_tests(api: P4TG, payload, payload_path, show_plots):
    logging.info("Starting P4TG traffic generator...")
    
    infinite_duration = any(t.get("duration") == 0 for t in (payload if isinstance(payload, list) else [payload]) if "duration" in t)
    api.start_traffic_gen(payload)
    
    if infinite_duration:
        logging.warning(
            "At least one test has no duration and will run indefinitely. "
            "Auto-stopping after 20s."
        )
        sleep_with_progress(20, desc="Running indefinite test")
        api.stop_traffic_gen()
    else:
        tests = payload if isinstance(payload, list) else [payload]
        total_duration = sum(t.get("duration", 0) for t in tests) + 3 * len(tests)
        sleep_with_progress(total_duration, desc="Running tests")
    
    # Retrieve statistics
    time_stats = api.get_time_statistics(payload_path)
    stats = api.get_statistics(payload_path) 
    
    # Plot all results into a single plot
    plot_all_rtt_histograms(stats, payload_path, y="probability", show_plots=show_plots)
    plot_tx_rx_rate(time_stats, payload_path, show_plots=show_plots, show_loss=True)

def configure_ports(api: P4TG):
    # Example to configure port 1 and 2
    api.configure_port(1, 0, Speed.BF_SPEED_100G, AutoNeg.PM_AN_DEFAULT, FEC.BF_FEC_TYP_NONE)
    api.configure_port(2, 0, Speed.BF_SPEED_100G, AutoNeg.PM_AN_DEFAULT, FEC.BF_FEC_TYP_NONE)
    

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--payload", required=True, help="Path to payload JSON")
    ap.add_argument("--base-url", default="http://localhost:8000/api")
    ap.add_argument("--show-plots", type=lambda x: x.lower()=="true", default=False)    
    args = ap.parse_args()

    payload_path = args.payload
    payload = load_payload(payload_path)
    api = P4TG(args.base_url)
    show_plots = args.show_plots

    configure_ports(api)

    run_tests(api, payload, payload_path, show_plots)


if __name__ == "__main__":
    main()