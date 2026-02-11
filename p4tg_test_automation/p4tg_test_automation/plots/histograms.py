import matplotlib.pyplot as plt
import math
import numpy as np
from pathlib import Path

def _convert_ns(ns: float, *, ascii_units: bool = False) -> tuple[float, str]:
    """
    Convert a duration in nanoseconds to a human unit.
    Returns (value, unit) where unit ∈ {ns, µs/us, ms, s, min, h}.
    """
    abs_ns = abs(ns)
    if abs_ns < 1e3:
        return ns, "ns"
    if abs_ns < 1e6:
        return ns / 1e3, "us" if ascii_units else "µs"
    if abs_ns < 1e9:
        return ns / 1e6, "ms"
    secs = ns / 1e9
    if abs(secs) < 60:
        return secs, "s"
    mins = secs / 60
    if abs(mins) < 60:
        return mins, "min"
    return mins / 60, "h"

def _as_float(v):
    if v is None:
        return 0.0
    if isinstance(v, dict):               # e.g., {"source":"0.0","parsedValue":0}
        return float(v.get("parsedValue", v.get("source", 0.0)))
    return float(v)

def _extract_hist_list(result):
    """Yield (rx_port, ch, cfg, dat) for each available histogram in one result entry."""
    rh = result.get("rtt_histogram", {}) or {}
    for p_str, per_ch in rh.items():
        for ch_str, h in (per_ch or {}).items():
            cfg = (h or {}).get("config")
            dat = (h or {}).get("data")
            if cfg and dat:
                yield int(p_str), int(ch_str), cfg, dat

def _plot_one_hist(ax, cfg, dat, y="probability", title_suffix=""):
    num_bins = int(cfg.get("num_bins", 0))
    vmin_ns = float(cfg.get("min", 0))
    vmax_ns = float(cfg.get("max", 0))
    if num_bins <= 0 or not math.isfinite(vmin_ns) or not math.isfinite(vmax_ns) or vmax_ns <= vmin_ns:
        ax.set_visible(False)
        return

    # --- choose unit for this histogram & compute scaling denom (ns -> unit) ---
    ref = max(abs(vmin_ns), abs(vmax_ns))
    val_ref, unit = _convert_ns(ref)            # e.g. (2.5, "µs")
    denom = (ref / val_ref) if val_ref else 1   # e.g. 1000 for µs

    bins_dict = dat.get("data_bins", {}) or {}

    counts = [int((bins_dict.get(str(i), {}) or {}).get("count", 0)) for i in range(num_bins)]
    probs_raw = [(bins_dict.get(str(i), {}) or {}).get("probability", None) for i in range(num_bins)]
    probs = [_as_float(v) if v is not None else None for v in probs_raw]

    # If any probability is missing, recompute all from counts
    if any(p is None for p in probs):
        total = sum(counts)
        probs = [(c / total * 100.0) if total > 0 else 0.0 for c in counts]

    # Convert bin edges from ns -> chosen unit
    edges_ns = np.linspace(vmin_ns, vmax_ns, num_bins + 1)
    edges = edges_ns / denom
    widths = np.diff(edges)

    if y == "count":
        ax.bar(edges[:-1], counts, width=widths, align="edge", edgecolor="black")
        ax.set_ylabel("Packets")
        ymax_for_labels = max(counts) if counts else 1.0
    else:
        ax.bar(edges[:-1], probs, width=widths, align="edge", edgecolor="black")
        ax.set_ylabel("Probability (%)")
        ymax_for_labels = max(probs) if probs else 1.0

    # Mean / std shown in the same unit
    mean_ns = dat.get("mean_rtt")
    std_ns = dat.get("std_dev_rtt")
    if isinstance(mean_ns, (int, float)):
        mean_u = mean_ns / denom
        ax.axvline(mean_u, linestyle="--", linewidth=1)
        if isinstance(std_ns, (int, float)):
            std_u = std_ns / denom
            ax.set_title(f"{title_suffix}  μ={mean_u:.2f} {unit}, σ={std_u:.2f} {unit}", pad=8)
        else:
            ax.set_title(f"{title_suffix}  μ={mean_u:.2f} {unit}", pad=8)
    else:
        ax.set_title(title_suffix, pad=8)

    ax.grid(True, axis="y", alpha=0.3)
    ax.set_xlabel(f"RTT [{unit}]")

    # Percentiles (convert to same unit)
    percs = dat.get("percentiles", {}) or {}
    if percs:
        colors = ["#3c82e7", "#e74c3c", "#e7a23c", "#a23ce7"]
        for i, (pname, pval) in enumerate(sorted(percs.items(), key=lambda kv: float(kv[0]))):
            try:
                x_u = float(pval) / denom
            except Exception:
                continue
            ax.axvline(x_u, linestyle="--", linewidth=1, color=colors[i % len(colors)])
            ylab = ymax_for_labels * (0.95 - 0.05 * i)
            ax.text(x_u, ylab, f"p{pname}", rotation=90, va="top", ha="right",
                    fontsize=8, bbox=dict(boxstyle="round", fc="white", ec="none", alpha=0.6))

    # Missed bin info (optional footer)
    missed = dat.get("missed_bin_count", 0)
    total  = dat.get("total_pkt_count", 0)
    if missed and total:
        ax.text(0.99, 0.02, f"missed: {missed:,} / {total:,}",
                transform=ax.transAxes, ha="right", va="bottom", fontsize=8, alpha=0.8)


def plot_all_rtt_histograms(
    results: list[dict],
    payload_path: str,
    y: str = "probability",
    max_cols: int = 3,
    show_plots: bool = False,
):
    """
    One figure that contains *all* results.
    Each result gets a subfigure (row), and inside it a grid of histograms (port/channel).
    """

    if not results:
        print("No results.")
        return

    # Pre-compute rows per result to size the figure nicely
    rows_per_result = []
    cols_used_per_result = []
    for result in results:
        n = sum(1 for _ in _extract_hist_list(result))
        if n == 0:
            rows_per_result.append(0)
            cols_used_per_result.append(0)
            continue
        cols = min(max_cols, n)
        rows = math.ceil(n / cols)
        rows_per_result.append(rows)
        cols_used_per_result.append(cols)

    # Total figure size: width by global max cols, height by total rows
    total_rows = sum(rows_per_result)
    if total_rows == 0:
        print("No histograms in any result.")
        return

    fig_width = 6 * (max(cols_used_per_result) if cols_used_per_result else max_cols)
    fig_height = 4.2 * total_rows + 1.2  # + a bit for spacing
    fig = plt.figure(figsize=(fig_width, fig_height), constrained_layout=True)

    # Use subfigures if available (Matplotlib >= 3.4). Fallback otherwise.
    use_subfigures = hasattr(fig, "subfigures")
    if use_subfigures:
        raw_subfigs = fig.subfigures(nrows=len(results), ncols=1)
        if isinstance(raw_subfigs, np.ndarray):
            subfigs = list(raw_subfigs.ravel())
        else:
            subfigs = [raw_subfigs]
    else:
        subfigs = [fig.add_subplot(len(results), 1, i + 1) for i in range(len(results))]

    for res_idx, result in enumerate(results):
        name = result.get("name") or f"Entry {res_idx + 1}"
        hists = list(_extract_hist_list(result))
        n = len(hists)
        if n == 0:
            continue

        cols = min(max_cols, n)
        rows = math.ceil(n / cols)
        container = subfigs[res_idx]

        if use_subfigures:
            subfig = container
            subfig.suptitle(name, y=1.02, x=0.01, ha="left", fontsize=12)
            axes = subfig.subplots(rows, cols, squeeze=False)
        else:
            # Fallback: create a gridspec-like area within this axes
            # We’ll just add a small title and create a nested Figure-like grid
            host_ax = container
            host_ax.axis("off")
            host_ax.set_title(name, loc="left", fontsize=12, pad=14)
            # Create a nested grid of axes in the remaining area
            gs = host_ax.figure.add_gridspec(rows, cols,
                                             left=0.06, right=0.98,
                                             top=(1 - (res_idx) / len(results)) - 0.01,
                                             bottom=(1 - (res_idx + 1) / len(results)) + 0.01)
            axes = [[fig.add_subplot(gs[r, c]) for c in range(cols)] for r in range(rows)]

        for k, (rx_port, ch, cfg, dat) in enumerate(hists):
            r = k // cols
            c = k % cols
            ax = axes[r][c]
            _plot_one_hist(ax, cfg, dat, y=y, title_suffix=f"RX port {rx_port}/{ch}")

        # Hide any unused axes in the last row
        for k in range(n, rows * cols):
            r = k // cols
            c = k % cols
            axes[r][c].set_visible(False)

    # Save one combined PDF
    out_dir = Path("results"); out_dir.mkdir(parents=True, exist_ok=True)
    p = Path(payload_path)
    out_path = out_dir / f"{p.stem}_histogram_all.pdf"
    fig.savefig(out_path, bbox_inches="tight", pad_inches=0.2)
    if show_plots:
        plt.show()
    plt.close(fig)
