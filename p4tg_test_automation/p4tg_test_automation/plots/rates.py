import matplotlib.pyplot as plt
from pathlib import Path

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
    """

    def format_bit_rate(bits):
        if bits is None:
            return 0, "bit/s"
        if bits >= 1_000_000_000:
            return bits / 1_000_000_000, "Gb/s"
        elif bits >= 1_000_000:
            return bits / 1_000_000, "Mb/s"
        elif bits >= 1_000:
            return bits / 1_000, "Kb/s"
        else:
            return bits, "b/s"

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

            for ch in channels:
                # series are dicts keyed by second ("0","1",...)
                for series in (tx_ch_map.get(ch, {}) or {}, rx_ch_map.get(ch, {}) or {}):
                    if series:
                        global_max_rate = max(global_max_rate, max(series.values()))

    _, rate_unit = format_bit_rate(global_max_rate if global_max_rate else 0)

    # ---------- figure layout ----------
    num_entries = len(stats)
    fig, axes = plt.subplots(num_entries, 1, figsize=(12, 6 * num_entries), sharex=True)
    if num_entries == 1:
        axes = [axes]

    # ---------- plot each entry ----------
    for idx, data in enumerate(stats):
        tx_dict = data.get("tx_rate_l1", {}) or {}
        rx_dict = data.get("rx_rate_l1", {}) or {}
        loss_dict = data.get("packet_loss", {}) or {}
        ooo_dict  = data.get("out_of_order", {}) or {}

        ax = axes[idx]
        ax2 = None  # secondary axis for loss/ooo if needed

        ports = set(tx_dict.keys()) | set(rx_dict.keys()) | set(loss_dict.keys()) | set(ooo_dict.keys())
        if port_f is not None:
            ports = {p for p in ports if p == port_f}

        for p in sorted(ports, key=lambda s: int(s)):
            tx_ch_map = tx_dict.get(p, {}) or {}
            rx_ch_map = rx_dict.get(p, {}) or {}
            loss_ch_map = loss_dict.get(p, {}) or {}
            ooo_ch_map  = ooo_dict.get(p, {}) or {}

            channels = set(tx_ch_map.keys()) | set(rx_ch_map.keys()) | set(loss_ch_map.keys()) | set(ooo_ch_map.keys())
            if ch_f is not None:
                channels = {c for c in channels if c == ch_f}

            for ch in sorted(channels, key=lambda s: int(s)):
                # --- TX ---
                tx_series = tx_ch_map.get(ch, {}) or {}
                if tx_series:
                    x_tx = sorted(int(k) for k in tx_series.keys())
                    y_tx = [format_bit_rate(tx_series[str(k)])[0] for k in x_tx]
                    if y_tx:
                        ax.plot(x_tx, y_tx, marker="o", label=f"Port {p}/{ch} TX")

                # --- RX ---
                rx_series = rx_ch_map.get(ch, {}) or {}
                if rx_series:
                    x_rx = sorted(int(k) for k in rx_series.keys())
                    y_rx = [format_bit_rate(rx_series[str(k)])[0] for k in x_rx]
                    if y_rx:
                        ax.plot(x_rx, y_rx, marker="x", label=f"Port {p}/{ch} RX")

                # --- Loss / OOO on secondary axis ---
                plotted_secondary = False
                if show_loss or show_ooo:
                    l_series = loss_ch_map.get(ch, {}) if show_loss else None
                    o_series = ooo_ch_map.get(ch, {}) if show_ooo else None

                    if (l_series and any(l_series.values())) or (o_series and any(o_series.values())):
                        if ax2 is None:
                            ax2 = ax.twinx()

                        if l_series:
                            xl = sorted(int(k) for k in l_series.keys())
                            yl = [l_series[str(k)] for k in xl]
                            if any(yl):
                                ax2.plot(xl, yl, linestyle="--", marker="s", label=f"Port {p}/{ch} Loss")
                                plotted_secondary = True

                        if o_series:
                            xo = sorted(int(k) for k in o_series.keys())
                            yo = [o_series[str(k)] for k in xo]
                            if any(yo):
                                ax2.plot(xo, yo, linestyle=":", marker="d", label=f"Port {p}/{ch} OOO")
                                plotted_secondary = True

                if plotted_secondary and ax2 is not None:
                    ax2.set_ylabel("Packets (loss / out-of-order)")

        ax.set_ylabel(f"Rate ({rate_unit})")
        ax.set_title(
            f"{data.get('name', f'Entry {idx+1}')} - TX/RX Rate"
            + (f" for Port {port_f}/{ch_f}" if (port_f is not None and ch_f is not None) else "")
        )
        ax.grid(True)

        # combined legend
        h1, l1 = ax.get_legend_handles_labels()
        h2, l2 = (ax2.get_legend_handles_labels() if ax2 else ([], []))
        if h1 or h2:
            ax.legend(h1 + h2, l1 + l2, loc="upper left")

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
