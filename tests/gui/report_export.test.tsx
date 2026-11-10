import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import P4tgReportExportModal from "../../Configuration GUI/src/components/P4tgReportExportModal";

const mocks = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("../../Configuration GUI/src/common/API", () => ({ default: { post: mocks.post } }));
const showToast = vi.fn();

beforeEach(() => {
    mocks.post.mockReset();
    showToast.mockReset();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:p4tg-report") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});

describe("PDF result export", () => {
    /** v2.8.1: Fixed single-point PDF report charts not rendering partial or cancelled throughput results. */
    test("v2_8_1_pdf_result_export_contract", async () => {
        mocks.post.mockResolvedValue({
            data: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
            headers: { "content-disposition": 'attachment; filename="lab-report.pdf"' },
        });
        let clicked: HTMLAnchorElement | undefined;
        vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clicked = this; });
        render(<P4tgReportExportModal showToast={showToast} />);
        const user = userEvent.setup();

        await user.click(screen.getByRole("button", { name: /Export PDF/ }));
        const title = screen.getByDisplayValue("P4TG Test Report");
        await user.clear(title);
        await user.type(title, "Lab acceptance");
        await user.click(screen.getAllByRole("button", { name: /Export PDF/ }).at(-1)!);

        await waitFor(() => expect(showToast).toHaveBeenCalledWith("PDF report exported.", "success"));
        expect(mocks.post).toHaveBeenCalledWith("/report", expect.objectContaining({ title: "Lab acceptance", tester: "n/a", notes: "n/a" }), { responseType: "blob" });
        expect(clicked?.download).toBe("lab-report.pdf");
        expect(clicked?.href).toBe("blob:p4tg-report");
        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:p4tg-report");
    });

    /** v2.8.1: PDF report failures must leave the frontend usable and report the controller error. */
    test("v2_8_1_pdf_result_export_failure", async () => {
        mocks.post.mockRejectedValue({ response: { data: { message: "report generation failed" } } });
        render(<P4tgReportExportModal showToast={showToast} />);
        await userEvent.click(screen.getByRole("button", { name: /Export PDF/ }));
        await userEvent.click(screen.getAllByRole("button", { name: /Export PDF/ }).at(-1)!);
        await waitFor(() => expect(showToast).toHaveBeenCalledWith("report generation failed", "danger"));
        expect(screen.getByText("Report metadata")).toBeInTheDocument();
        expect(screen.getAllByRole("button", { name: /Export PDF/ }).at(-1)).toBeEnabled();
    });
});
