import argparse
import json
import logging
import time
    
from .api.client import P4TG, FEC, Speed, AutoNeg
from .plots.rates import plot_tx_rx_rate, plot_packet_loss
from .plots.histograms import (
    plot_all_rtt_histograms,
    plot_all_iat_histograms_tx,
    plot_all_iat_histograms_rx,
)
from .plots.rfc2544 import plot_rfc2544_results
from .utils.helpers import load_payload, sleep_with_progress, wait_for_ports_up


# ------- Test orchestration ---------

def is_rfc2544_payload(payload):
    tests = payload if isinstance(payload, list) else [payload]
    return any(test.get("mode") == 5 or test.get("rfc2544") for test in tests)


def has_infinite_duration(tests):
    """The controller treats a missing, null, or zero duration as infinite."""
    return any(test.get("duration") in (None, 0) for test in tests)


def configure_logging(log_level: str):
    logging.basicConfig(
        level=getattr(logging, log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s: %(message)s",
        datefmt="%H:%M:%S",
    )


def prepare_payload_for_post(payload):
    if isinstance(payload, list) and len(payload) == 1 and is_rfc2544_payload(payload):
        logging.info("Posting single RFC2544 test as object instead of one-element multiple-test list.")
        return payload[0]
    return payload


def rfc2544_result_counts(rfc2544):
    keys = ["throughput", "latency", "frame_loss", "reset", "system_recovery"]
    return ", ".join(f"{key}={len(rfc2544.get(key, []) or [])}" for key in keys)


def default_report_metadata():
    return {
        "title": "P4TG Test Report",
        "tester": "n/a",
        "organization": "n/a",
        "test_location": "n/a",
        "dut_name": "n/a",
        "dut_vendor": "n/a",
        "dut_model": "n/a",
        "dut_software_version": "n/a",
        "dut_configuration": "n/a",
        "media_type": "n/a",
        "protocol": "n/a",
        "data_stream_format": "n/a",
        "notes": "n/a",
    }


def load_report_metadata(path):
    metadata = default_report_metadata()
    if not path:
        return metadata
    with open(path, "r", encoding="utf-8") as handle:
        metadata.update(json.load(handle))
    return metadata


def wait_for_rfc2544(api: P4TG, timeout_s: float = 1800.0, poll_interval_s: float = 2.0):
    start = time.time()
    deadline = start + timeout_s
    last_status = None
    next_progress_log = start

    while time.time() < deadline:
        stats = api.get_statistics()
        now = time.time()
        if isinstance(stats, list) and stats:
            rfc2544 = stats[0].get("rfc2544") or {}
            status = rfc2544.get("status")
            should_log = status != last_status or now >= next_progress_log
            if rfc2544 and should_log:
                logging.info(
                    "RFC2544 running %.0fs/%.0fs: %s (%s)",
                    now - start,
                    timeout_s,
                    status or "no status yet",
                    rfc2544_result_counts(rfc2544),
                )
                last_status = status
                next_progress_log = now + 10
            if rfc2544 and not rfc2544.get("running", False):
                logging.info("RFC2544 completed: %s (%s)", status, rfc2544_result_counts(rfc2544))
                return
        elif now >= next_progress_log:
            logging.info("Waiting for RFC2544 statistics block...")
            next_progress_log = now + 10

        time.sleep(poll_interval_s)

    raise TimeoutError(f"Timed out waiting for RFC2544 completion after {timeout_s:.0f}s")


def wait_for_traffic_gen_completion(api: P4TG, timeout_s: float, poll_interval_s: float = 0.5):
    """Wait until the controller reports that the complete orchestration has exited."""
    start = time.time()
    deadline = start + timeout_s
    next_progress_log = start

    while time.time() < deadline:
        status = api.get_traffic_gen_status()
        if status is None:
            logging.info("Traffic-generation orchestration completed.")
            return

        now = time.time()
        if now >= next_progress_log:
            phase = (
                "draining"
                if status.get("draining")
                else "paused"
                if status.get("cooldown")
                else "running"
            )
            logging.info(
                "Traffic generation %s %.0fs/%.0fs: %s",
                phase,
                now - start,
                timeout_s,
                status.get("name") or "unnamed test",
            )
            next_progress_log = now + 10

        time.sleep(poll_interval_s)

    raise TimeoutError(
        f"Timed out waiting for traffic-generation orchestration after {timeout_s:.0f}s"
    )


def run_tests(api: P4TG, payload, payload_path, show_plots, rfc2544_timeout, report, report_metadata):
    tests = payload if isinstance(payload, list) else [payload]
    logging.info("Loaded %d test configuration(s) from %s.", len(tests), payload_path)
    
    rfc2544_mode = is_rfc2544_payload(payload)
    infinite_duration = has_infinite_duration(tests)
    logging.info("Starting P4TG traffic generator via REST API...")
    api.start_traffic_gen(prepare_payload_for_post(payload))
    
    if rfc2544_mode:
        logging.info("Detected RFC2544 payload. Polling /statistics until the RFC2544 task finishes.")
        wait_for_rfc2544(api, timeout_s=rfc2544_timeout)
    elif infinite_duration:
        logging.warning(
            "At least one test has no duration and will run indefinitely. "
            "Auto-stopping after 20s."
        )
        sleep_with_progress(20, desc="Running indefinite test")
        logging.info("Stopping indefinite traffic generation after automation timeout.")
        api.stop_traffic_gen()
    else:
        total_runs = sum(max(1, int(t.get("repetitions", 1))) for t in tests)
        expected_runtime = (
            sum(
                (t.get("duration", 0) + t.get("drain_duration_secs", 0))
                * max(1, int(t.get("repetitions", 1)))
                for t in tests
            )
            + 3 * max(0, total_runs - 1)
        )
        timeout = expected_runtime + max(30, 5 * total_runs)
        logging.info(
            "Polling /trafficgen for completion (expected runtime %.0fs, timeout %.0fs).",
            expected_runtime,
            timeout,
        )
        wait_for_traffic_gen_completion(api, timeout_s=timeout)
    
    # Retrieve statistics
    logging.info("Fetching /time_statistics and saving raw time statistics.")
    time_stats = api.get_time_statistics(payload_path)
    logging.info("Fetching /statistics and saving raw final statistics.")
    stats = api.get_statistics(payload_path) 
    
    # Plot all results into a single plot
    logging.info("Rendering RTT histogram plots.")
    plot_all_rtt_histograms(stats, payload_path, y="probability", show_plots=show_plots)
    logging.info("Rendering TX IAT histogram plots.")
    plot_all_iat_histograms_tx(stats, payload_path, y="probability", show_plots=show_plots)
    logging.info("Rendering RX IAT histogram plots.")
    plot_all_iat_histograms_rx(stats, payload_path, y="probability", show_plots=show_plots)
    logging.info("Rendering TX/RX rate plot.")
    plot_tx_rx_rate(time_stats, payload_path, show_plots=show_plots)
    logging.info("Rendering packet-loss plot.")
    plot_packet_loss(time_stats, payload_path, show_plots=show_plots)
    if rfc2544_mode:
        logging.info("Rendering RFC2544 summaries and plots.")
        plot_rfc2544_results(stats, payload_path, show_plots=show_plots)
    if report:
        logging.info("Exporting controller-generated P4TG PDF report.")
        api.export_report(report_metadata, payload_path)
    logging.info("Done. Results are in the results/ directory.")

def configure_ports(api: P4TG):
    # Example to configure port 1 and 2
    logging.info("Configuring port 1/0.")
    api.configure_port(1, 0, Speed.BF_SPEED_100G, AutoNeg.PM_AN_DEFAULT, FEC.BF_FEC_TYP_NONE)
    logging.info("Configuring port 2/0.")
    api.configure_port(2, 0, Speed.BF_SPEED_100G, AutoNeg.PM_AN_DEFAULT, FEC.BF_FEC_TYP_NONE)
    return [(1, 0), (2, 0)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--payload", required=True, help="Path to payload JSON")
    ap.add_argument("--base-url", default="http://localhost:8000/api")
    ap.add_argument("--show-plots", type=lambda x: x.lower()=="true", default=False)
    ap.add_argument("--rfc2544-timeout", type=float, default=1800.0)
    ap.add_argument(
        "--report",
        "--rfc2544-report",
        dest="report",
        action="store_true",
        help="Export the controller-generated P4TG PDF report.",
    )
    ap.add_argument(
        "--report-metadata",
        "--rfc2544-report-metadata",
        dest="report_metadata",
        help="Path to JSON metadata for the P4TG PDF report.",
    )
    ap.add_argument("--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"])
    ap.add_argument(
        "--configure-ports",
        action="store_true",
        help="Configure ports before starting traffic generation.",
    )
    args = ap.parse_args()
    configure_logging(args.log_level)

    payload_path = args.payload
    logging.info("Loading payload from %s.", payload_path)
    payload = load_payload(payload_path)
    api = P4TG(args.base_url)
    logging.info("Using P4TG API at %s.", args.base_url)
    show_plots = args.show_plots

    if args.configure_ports:
        configured_ports = configure_ports(api)
        wait_for_ports_up(api, configured_ports)

    report_metadata = load_report_metadata(args.report_metadata)
    run_tests(
        api,
        payload,
        payload_path,
        show_plots,
        args.rfc2544_timeout,
        args.report,
        report_metadata,
    )


if __name__ == "__main__":
    main()
