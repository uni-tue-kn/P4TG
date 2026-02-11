import matplotlib.pyplot as plt
from pathlib import Path


def _sorted_numeric_keys(items):
    return sorted(items, key=lambda s: int(s))


def _format_bit_rate(bits):
    if bits is None:
        return 0, "bit/s"
    if bits >= 1_000_000_000:
        return bits / 1_000_000_000, "Gb/s"
    if bits >= 1_000_000:
        return bits / 1_000_000, "Mb/s"
    if bits >= 1_000:
        return bits / 1_000, "Kb/s"
    return bits, "b/s"


def plot_tx_rx_rate(
    stats,
    payload_path: str,
    show_plots: bool = False,
    port: int | str | None = None,
    channel: int | str | None = None,
    show_loss: bool = False,
    show_ooo: bool = False
):
    """
    Plots TX/RX L1 bit rates over time for each entry in `stats` (each entry = one run).
    Supports nested time series: port -> channel -> second -> value.
    Optional filters: `port`, `channel` (plot only that pair if provided).
    `show_loss` and `show_ooo` are kept for compatibility and ignored here.
    """

    _ = (show_loss, show_ooo)  # kept for call compatibility

    if not stats or not isinstance(stats, list):
        print("Invalid stats format.")
        return

    # normalize filters to strings (JSON keys are strings)
    port_f = str(port) if port is not None else None
    ch_f   = str(channel) if channel is not None else None

    # ---------- pick a consistent rate unit ----------
    global_max_rate = 0.0
    for data in stats:
        tx_dict = data.get("tx_rate_l1", {}) or {}
        rx_dict = data.get("rx_rate_l1", {}) or {}

        # set of (port,channel) to consider
        ports = set(tx_dict.keys()) | set(rx_dict.keys())
        if port_f is not None:
            ports = {p for p in ports if p == port_f}

        for p in ports:
            tx_ch_map = tx_dict.get(p, {}) or {}
            rx_ch_map = rx_dict.get(p, {}) or {}
            channels = set(tx_ch_map.keys()) | set(rx_ch_map.keys())
            if ch_f is not None:
                channels = {c for c in channels if c == ch_f}

            for ch in _sorted_numeric_keys(channels):
                # series are dicts keyed by second ("0","1",...)
                for series in (tx_ch_map.get(ch, {}) or {}, rx_ch_map.get(ch, {}) or {}):
                    if series:
                        global_max_rate = max(global_max_rate, max(series.values()))

    _, rate_unit = _format_bit_rate(global_max_rate if global_max_rate else 0)

    # ---------- figure layout ----------
    num_entries = len(stats)
    fig, axes = plt.subplots(num_entries, 1, figsize=(12, 6 * num_entries), sharex=True)
    if num_entries == 1:
        axes = [axes]

    # ---------- plot each entry ----------
    for idx, data in enumerate(stats):
        tx_dict = data.get("tx_rate_l1", {}) or {}
        rx_dict = data.get("rx_rate_l1", {}) or {}

        ax = axes[idx]

        ports = set(tx_dict.keys()) | set(rx_dict.keys())
        if port_f is not None:
            ports = {p for p in ports if p == port_f}

        for p in _sorted_numeric_keys(ports):
            tx_ch_map = tx_dict.get(p, {}) or {}
            rx_ch_map = rx_dict.get(p, {}) or {}

            channels = set(tx_ch_map.keys()) | set(rx_ch_map.keys())
            if ch_f is not None:
                channels = {c for c in channels if c == ch_f}

            for ch in _sorted_numeric_keys(channels):
                # --- TX ---
                tx_series = tx_ch_map.get(ch, {}) or {}
                if tx_series:
                    x_tx = sorted(int(k) for k in tx_series.keys())
                    y_tx = [_format_bit_rate(tx_series[str(k)])[0] for k in x_tx]
                    if y_tx:
                        ax.plot(x_tx, y_tx, marker="o", label=f"Port {p}/{ch} TX")

                # --- RX ---
                rx_series = rx_ch_map.get(ch, {}) or {}
                if rx_series:
                    x_rx = sorted(int(k) for k in rx_series.keys())
                    y_rx = [_format_bit_rate(rx_series[str(k)])[0] for k in x_rx]
                    if y_rx:
                        ax.plot(x_rx, y_rx, marker="x", label=f"Port {p}/{ch} RX")

        ax.set_ylabel(f"Rate ({rate_unit})")
        ax.set_title(
            f"{data.get('name', f'Entry {idx+1}')} - TX/RX Rate"
            + (f" for Port {port_f}/{ch_f}" if (port_f is not None and ch_f is not None) else "")
        )
        ax.grid(True)

        h1, l1 = ax.get_legend_handles_labels()
        if h1:
            ax.legend(h1, l1, loc="upper left")

    axes[-1].set_xlabel("Time (s)")
    plt.tight_layout()
    
    out_dir = Path("results")
    out_dir.mkdir(parents=True, exist_ok=True)

    p = Path(payload_path)
    out_path = out_dir / f"{p.stem}_rates.pdf"
    plt.savefig(out_path, bbox_inches="tight")
    if show_plots:
        plt.show()
    plt.close(fig)


def plot_packet_loss(
    stats,
    payload_path: str,
    show_plots: bool = False,
    port: int | str | None = None,
    channel: int | str | None = None,
    show_ooo: bool = False,
):
    """
    Plots packet loss (and optionally out-of-order packets) over time.
    """
    if not stats or not isinstance(stats, list):
        print("Invalid stats format.")
        return

    port_f = str(port) if port is not None else None
    ch_f = str(channel) if channel is not None else None

    num_entries = len(stats)
    fig, axes = plt.subplots(num_entries, 1, figsize=(12, 6 * num_entries), sharex=True)
    if num_entries == 1:
        axes = [axes]

    for idx, data in enumerate(stats):
        loss_dict = data.get("packet_loss", {}) or {}
        ooo_dict = data.get("out_of_order", {}) or {}
        ax = axes[idx]

        ports = set(loss_dict.keys()) | (set(ooo_dict.keys()) if show_ooo else set())
        if port_f is not None:
            ports = {p for p in ports if p == port_f}

        for p in _sorted_numeric_keys(ports):
            loss_ch_map = loss_dict.get(p, {}) or {}
            ooo_ch_map = ooo_dict.get(p, {}) or {}

            channels = set(loss_ch_map.keys()) | (set(ooo_ch_map.keys()) if show_ooo else set())
            if ch_f is not None:
                channels = {c for c in channels if c == ch_f}

            for ch in _sorted_numeric_keys(channels):
                loss_series = loss_ch_map.get(ch, {}) or {}
                if loss_series:
                    xl = sorted(int(k) for k in loss_series.keys())
                    yl = [loss_series[str(k)] for k in xl]
                    if any(yl):
                        ax.plot(xl, yl, linestyle="--", marker="s", label=f"Port {p}/{ch} Loss")

                if show_ooo:
                    ooo_series = ooo_ch_map.get(ch, {}) or {}
                    if ooo_series:
                        xo = sorted(int(k) for k in ooo_series.keys())
                        yo = [ooo_series[str(k)] for k in xo]
                        if any(yo):
                            ax.plot(xo, yo, linestyle=":", marker="d", label=f"Port {p}/{ch} OOO")

        ax.set_ylabel("Packets")
        ax.set_title(
            f"{data.get('name', f'Entry {idx+1}')} - Packet Loss"
            + (" / Out-of-Order" if show_ooo else "")
            + (f" for Port {port_f}/{ch_f}" if (port_f is not None and ch_f is not None) else "")
        )
        ax.grid(True)

        h, l = ax.get_legend_handles_labels()
        if h:
            ax.legend(h, l, loc="upper left")

    axes[-1].set_xlabel("Time (s)")
    plt.tight_layout()

    out_dir = Path("results")
    out_dir.mkdir(parents=True, exist_ok=True)

    p = Path(payload_path)
    out_path = out_dir / f"{p.stem}_packet_loss.pdf"
    plt.savefig(out_path, bbox_inches="tight")
    if show_plots:
        plt.show()
    plt.close(fig)
