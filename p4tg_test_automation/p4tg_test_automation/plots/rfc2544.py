import csv
import json
import logging
from collections import defaultdict
from pathlib import Path

import matplotlib.pyplot as plt


def _out_dir():
    out = Path("results")
    out.mkdir(parents=True, exist_ok=True)
    return out


def _payload_stem(payload_path: str) -> str:
    return Path(payload_path).stem


def _extract_rfc2544(stats):
    if not isinstance(stats, list):
        return None
    for entry in stats:
        if isinstance(entry, dict) and entry.get("rfc2544"):
            return entry["rfc2544"]
    return None


def _mapping_label(mapping):
    if not isinstance(mapping, dict):
        return "unknown"
    return (
        f"{mapping.get('tx_port', '?')}/{mapping.get('tx_channel', '?')}"
        f" -> {mapping.get('rx_port', '?')}/{mapping.get('rx_channel', '?')}"
    )


def _gbps_to_mpps(gbps, frame_size):
    return float(gbps) * 1_000 / ((int(frame_size) + 20) * 8)


def _flatten_row(row):
    mapping = row.get("mapping", {}) or {}
    flat = {
        "mapping": _mapping_label(mapping),
        "tx_port": mapping.get("tx_port"),
        "tx_channel": mapping.get("tx_channel"),
        "rx_port": mapping.get("rx_port"),
        "rx_channel": mapping.get("rx_channel"),
    }
    flat.update({k: v for k, v in row.items() if k != "mapping"})
    return flat


def _write_csv(path, rows, preferred_fields):
    if not rows:
        logging.info("Skipping %s because no rows are available.", path)
        return
    flattened = [_flatten_row(row) for row in rows]
    extra_fields = sorted({key for row in flattened for key in row.keys()} - set(preferred_fields))
    fields = preferred_fields + extra_fields
    with open(path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(flattened)
    logging.info("Wrote %s (%d rows).", path, len(rows))


def save_rfc2544_summary(stats, payload_path: str):
    rfc = _extract_rfc2544(stats)
    if not rfc:
        logging.warning("No RFC2544 result block found in /statistics.")
        return

    out = _out_dir()
    stem = _payload_stem(payload_path)

    with open(out / f"{stem}_rfc2544_summary.json", "w", encoding="utf-8") as handle:
        json.dump(rfc, handle, indent=2)
    logging.info("Wrote %s.", out / f"{stem}_rfc2544_summary.json")

    common = ["mapping", "tx_port", "tx_channel", "rx_port", "rx_channel", "frame_size"]
    _write_csv(
        out / f"{stem}_rfc2544_throughput.csv",
        rfc.get("throughput", []) or [],
        common + ["zero_loss_rate_gbps", "first_loss_rate_gbps", "lost_frames"],
    )
    _write_csv(
        out / f"{stem}_rfc2544_latency.csv",
        rfc.get("latency", []) or [],
        common + [
            "rate_gbps",
            "mean_latency_ns",
            "min_latency_ns",
            "max_latency_ns",
            "jitter_ns",
            "samples",
        ],
    )
    _write_csv(
        out / f"{stem}_rfc2544_frame_loss.csv",
        rfc.get("frame_loss", []) or [],
        common + [
            "offered_percent",
            "offered_rate_gbps",
            "tx_frames",
            "rx_frames",
            "lost_frames",
            "loss_percentage",
        ],
    )
    _write_csv(
        out / f"{stem}_rfc2544_reset.csv",
        rfc.get("reset", []) or [],
        common + ["rate_gbps", "reset_time_ms", "status"],
    )
    _write_csv(
        out / f"{stem}_rfc2544_system_recovery.csv",
        rfc.get("system_recovery", []) or [],
        common + [
            "throughput_rate_gbps",
            "overload_rate_gbps",
            "recovery_rate_gbps",
            "recovery_time_ms",
            "lost_frames_after_reduction",
            "recovered",
            "status",
        ],
    )


def _save_or_show(fig, payload_path, suffix, show_plots):
    out_path = _out_dir() / f"{_payload_stem(payload_path)}_{suffix}.pdf"
    fig.savefig(out_path, bbox_inches="tight")
    logging.info("Wrote %s.", out_path)
    if show_plots:
        plt.show()
    plt.close(fig)


def plot_rfc2544_throughput(stats, payload_path: str, show_plots: bool = False):
    rfc = _extract_rfc2544(stats)
    rows = (rfc or {}).get("throughput", []) or []
    if not rfc or not rows:
        logging.info("Skipping RFC2544 throughput plot because no throughput rows are available.")
        return

    frame_sizes = sorted(set(rfc.get("selected_frame_sizes", []) or [r["frame_size"] for r in rows]))
    line_rate = float(rfc.get("line_rate_gbps", 0))

    fig, ax = plt.subplots(figsize=(10, 6))
    if line_rate > 0:
        ax.plot(
            frame_sizes,
            [_gbps_to_mpps(line_rate, frame_size) for frame_size in frame_sizes],
            marker="o",
            linestyle="--",
            label="Theoretical line rate",
        )

    by_mapping = defaultdict(dict)
    for row in rows:
        by_mapping[_mapping_label(row.get("mapping"))][row["frame_size"]] = row

    for mapping, per_frame_size in sorted(by_mapping.items()):
        y = [
            _gbps_to_mpps(per_frame_size[frame_size]["zero_loss_rate_gbps"], frame_size)
            if frame_size in per_frame_size else None
            for frame_size in frame_sizes
        ]
        ax.plot(frame_sizes, y, marker="x", label=f"Zero loss {mapping}")

    ax.set_title("RFC2544 Zero Loss Throughput")
    ax.set_xlabel("Frame size (bytes)")
    ax.set_ylabel("Frame rate (Mpps)")
    ax.grid(True)
    ax.legend()
    _save_or_show(fig, payload_path, "rfc2544_throughput", show_plots)


def plot_rfc2544_frame_loss(stats, payload_path: str, show_plots: bool = False):
    rfc = _extract_rfc2544(stats)
    rows = (rfc or {}).get("frame_loss", []) or []
    if not rows:
        logging.info("Skipping RFC2544 frame-loss plot because no frame-loss rows are available.")
        return

    by_series = defaultdict(list)
    for row in rows:
        key = (_mapping_label(row.get("mapping")), row.get("frame_size"))
        by_series[key].append(row)

    fig, ax = plt.subplots(figsize=(10, 6))
    for (mapping, frame_size), series in sorted(by_series.items()):
        series = sorted(series, key=lambda row: row["offered_percent"])
        ax.plot(
            [row["offered_percent"] for row in series],
            [row["loss_percentage"] for row in series],
            marker="o",
            label=f"{mapping}, {frame_size} B",
        )

    ax.set_title("RFC2544 Frame Loss Rate")
    ax.set_xlabel("Offered load (% of line rate)")
    ax.set_ylabel("Frame loss (%)")
    ax.set_xlim(0, 100)
    ax.set_ylim(bottom=0)
    ax.grid(True)
    ax.legend()
    _save_or_show(fig, payload_path, "rfc2544_frame_loss", show_plots)


def plot_rfc2544_latency(stats, payload_path: str, show_plots: bool = False):
    rfc = _extract_rfc2544(stats)
    rows = (rfc or {}).get("latency", []) or []
    if not rows:
        logging.info("Skipping RFC2544 latency plot because no latency rows are available.")
        return

    by_mapping = defaultdict(list)
    for row in rows:
        by_mapping[_mapping_label(row.get("mapping"))].append(row)

    fig, ax = plt.subplots(figsize=(10, 6))
    for mapping, series in sorted(by_mapping.items()):
        series = sorted(series, key=lambda row: row["frame_size"])
        x = [row["frame_size"] for row in series]
        y = [row["mean_latency_ns"] for row in series]
        lower = [max(0, row["mean_latency_ns"] - row["min_latency_ns"]) for row in series]
        upper = [max(0, row["max_latency_ns"] - row["mean_latency_ns"]) for row in series]
        ax.errorbar(x, y, yerr=[lower, upper], marker="o", capsize=4, label=mapping)

    ax.set_title("RFC2544 Latency")
    ax.set_xlabel("Frame size (bytes)")
    ax.set_ylabel("Latency RTT/2 (ns)")
    ax.grid(True)
    ax.legend()
    _save_or_show(fig, payload_path, "rfc2544_latency", show_plots)


def _plot_time_bars(stats, payload_path, result_key, value_key, title, ylabel, suffix, show_plots):
    rfc = _extract_rfc2544(stats)
    rows = (rfc or {}).get(result_key, []) or []
    rows = [row for row in rows if row.get(value_key) is not None]
    if not rows:
        logging.info("Skipping %s plot because no completed rows are available.", title)
        return

    labels = [f"{_mapping_label(row.get('mapping'))}\n{row.get('frame_size')} B" for row in rows]
    values = [row[value_key] for row in rows]

    fig, ax = plt.subplots(figsize=(max(8, len(labels) * 1.4), 6))
    bars = ax.bar(range(len(labels)), values)
    ax.set_xticks(range(len(labels)))
    ax.set_xticklabels(labels, rotation=30, ha="right")
    ax.set_title(title)
    ax.set_ylabel(ylabel)
    ax.grid(True, axis="y")

    for bar, row in zip(bars, rows):
        status = row.get("status")
        if status:
            ax.text(
                bar.get_x() + bar.get_width() / 2,
                bar.get_height(),
                status,
                ha="center",
                va="bottom",
                fontsize=8,
                rotation=90,
            )

    _save_or_show(fig, payload_path, suffix, show_plots)


def plot_rfc2544_reset(stats, payload_path: str, show_plots: bool = False):
    _plot_time_bars(
        stats,
        payload_path,
        "reset",
        "reset_time_ms",
        "RFC2544 Reset Time",
        "Reset time (ms)",
        "rfc2544_reset",
        show_plots,
    )


def plot_rfc2544_system_recovery(stats, payload_path: str, show_plots: bool = False):
    _plot_time_bars(
        stats,
        payload_path,
        "system_recovery",
        "recovery_time_ms",
        "RFC2544 System Recovery",
        "Recovery time (ms)",
        "rfc2544_system_recovery",
        show_plots,
    )


def plot_rfc2544_results(stats, payload_path: str, show_plots: bool = False):
    save_rfc2544_summary(stats, payload_path)
    plot_rfc2544_throughput(stats, payload_path, show_plots=show_plots)
    plot_rfc2544_frame_loss(stats, payload_path, show_plots=show_plots)
    plot_rfc2544_latency(stats, payload_path, show_plots=show_plots)
    plot_rfc2544_reset(stats, payload_path, show_plots=show_plots)
    plot_rfc2544_system_recovery(stats, payload_path, show_plots=show_plots)
