import type { CaseDetail, ConsentView } from "@loan/core";
import { ToastProvider } from "@loan/ui";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import { ConsentPanel } from "@/components/case/consent-panel";

afterEach(() => vi.unstubAllGlobals());

const consent = (patch: Partial<ConsentView>): ConsentView => ({
  creditBureauCheck: true,
  dataProcessing: true,
  termsVersion: "1.0",
  channel: "BRANCH_ASSISTED",
  capturedBy: "STF-PAOLO",
  capturedByName: "Paolo Tan",
  capturedAt: "2026-11-28T01:00:00.000Z",
  complete: true,
  ...patch,
});

const draft = (patch: Partial<CaseDetail>) =>
  ({
    id: "case-1",
    status: "DRAFT",
    consent: null,
    allowedActions: [{ action: "EDIT_DRAFT", enabled: true }],
    ...patch,
  }) as unknown as CaseDetail;

const renderPanel = (c: CaseDetail, onChanged = vi.fn()) =>
  render(
    <ToastProvider>
      <ConsentPanel detail={c} onChanged={onChanged} />
    </ToastProvider>,
  );

describe("ConsentPanel (C-1)", () => {
  it("on a draft with no consent, records both consents through PATCH and hands back the case", async () => {
    const saved = draft({ consent: consent({}) });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(saved), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const onChanged = vi.fn();
    renderPanel(draft({}), onChanged);

    expect(screen.getByText("Not recorded.")).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText(/credit bureau check/));
    await userEvent.click(screen.getByLabelText(/data processing/));
    await userEvent.click(screen.getByRole("button", { name: "Record consent" }));

    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledWith(saved));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/cases/case-1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({
      consent: { creditBureauCheck: true, dataProcessing: true, termsVersion: "1.0" },
    });
  });

  it("shows who captured a complete consent, with no editing outside a draft", () => {
    renderPanel(draft({ status: "OFFER", consent: consent({}), allowedActions: [] }));
    expect(screen.getByText("Complete.")).toBeInTheDocument();
    expect(screen.getByText(/Captured by Paolo Tan at the branch/)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record consent" })).not.toBeInTheDocument();
  });

  it("names what is missing when incomplete", () => {
    renderPanel(draft({ consent: consent({ dataProcessing: false, complete: false }) }));
    expect(screen.getByText("Incomplete: no consent to data processing.")).toBeInTheDocument();
  });

  it("explains an older terms version instead of an empty list", () => {
    renderPanel(draft({ consent: consent({ termsVersion: "0.9", complete: false }) }));
    expect(
      screen.getByText(/given under terms 0.9; record it again under terms 1.0/),
    ).toBeInTheDocument();
  });
});
