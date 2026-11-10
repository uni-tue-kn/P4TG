import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import SummaryView from "../../Configuration GUI/src/components/SummaryView";
import { DefaultStream, DefaultStreamSettings, GenerationMode, RxMappingMode, StatisticsObject, TimeStatisticsObject } from "../../Configuration GUI/src/common/Interfaces";

vi.mock("../../Configuration GUI/src/components/StatView", () => ({ default: () => <div>statistics</div> }));
vi.mock("../../Configuration GUI/src/components/StreamView", () => ({ default: () => <div>stream statistics</div> }));

describe("dashboard mapping regressions", () => {
    /** v2.8.1: Fixed duplicate dashboard mapping tabs when RFC2544 results and the current port mapping share a TX port/channel. */
    test("v2_8_1_duplicate_rfc2544_dashboard_tabs", () => {
        const mapping = { tx_port: 1, tx_channel: 0, rx_port: 2, rx_channel: 0 };
        render(<SummaryView
            statistics={{ ...StatisticsObject, rfc2544: { selected_mappings: [mapping] } as any }}
            time_statistics={TimeStatisticsObject}
            port_tx_rx_mapping={{ "1": { "0": { port: 2, channel: 0 } } }}
            stream_settings={[{ ...DefaultStreamSettings(1, 1, 0), active: true }]}
            streams={[DefaultStream(1)]}
            rx_mapping_mode={RxMappingMode.PerTxPort}
            visual={false}
            mode={GenerationMode.RFC2544}
        />);

        expect(screen.getAllByRole("tab", { name: "1/0 → 2/0" })).toHaveLength(1);
        expect(screen.getByRole("tab", { name: "Summary" })).toBeInTheDocument();
    });
});
