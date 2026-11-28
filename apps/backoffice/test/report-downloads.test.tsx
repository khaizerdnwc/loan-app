import type { OriginationFunnelReport, TurnaroundReport } from "@loan/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, vi } from "vitest";
import DecisionsPage from "@/app/(staff)/reports/decisions/page";
import FunnelPage from "@/app/(staff)/reports/funnel/page";
import TurnaroundPage from "@/app/(staff)/reports/turnaround/page";
import { periodQuery } from "@/lib/reports";

// The URL is the period's state: replace() rewrites it, as the browser would.
const { url, router } = vi.hoisted(() => {
  const url = { search: "" };
  return {
    url,
    router: {
      push: () => {},
      replace: (href: string) => {
        url.search = href.includes("?") ? href.slice(href.indexOf("?")) : "";
      },
    },
  };
});
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/reports/funnel",
  useSearchParams: () => new URLSearchParams(url.search),
}));
vi.mock("@/lib/session", () => ({
  useSession: () => ({ id: "STF-RINA", fullName: "Rina Aquino", role: "APPROVER" }),
}));

/** What the page saved: the anchor it clicked (jsdom has no downloads). */
const saved: { href: string; download: string }[] = [];
const createObjectURL = vi.fn(() => "blob:report");
const revokeObjectURL = vi.fn();
beforeEach(() => {
  saved.length = 0;
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  // jsdom has neither: define them for the test, and remove them after it.
  Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, configurable: true });
  Object.defineProperty(URL, "revokeObjectURL", { value: revokeObjectURL, configurable: true });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    saved.push({ href: this.href, download: this.download });
  });
});
afterEach(() => {
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  url.search = "";
});

const funnel: OriginationFunnelReport = {
  period: { from: "2026-11-01", to: "2026-11-30" },
  stages: [
    { key: "STARTED", count: 0, conversion: "0.0000" },
    { key: "SUBMITTED", count: 0, conversion: "0.0000" },
    { key: "APPROVED", count: 0, conversion: "0.0000" },
    { key: "DISBURSED", count: 0, conversion: "0.0000" },
  ],
  disbursedAmount: "0.00",
  byStatus: [],
};

const csvResponse = (fileName: string) =>
  new Response("﻿Report,Origination funnel\r\n", {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${fileName}"`,
    },
  });

/** JSON for the report, and `onCsv` for the download. */
const stub = (report: unknown, onCsv: (url: string) => Response) => {
  const fetchMock = vi.fn(async (u: string) =>
    u.includes(".csv") ? onCsv(u) : new Response(JSON.stringify(report), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

describe("report downloads (RPT-006)", () => {
  it("the funnel's download button names its period, fetches that period's file and saves it under the API's file name", async () => {
    const fetchMock = stub(funnel, () =>
      csvResponse("origination-funnel-2026-11-01-to-2026-11-30.csv"),
    );
    const { rerender } = render(<FunnelPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Download CSV · 30 days" }));
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/reports/funnel.csv${periodQuery(30)}`,
      expect.anything(),
    );
    expect(saved).toEqual([
      { href: "blob:report", download: "origination-funnel-2026-11-01-to-2026-11-30.csv" },
    ]);
    // The object URL is let go once the download has started (next tick).
    await vi.waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:report"));
    expect(screen.queryByRole("alert")).toBeNull();

    // Another period: the button says so and fetches that period.
    await userEvent.click(screen.getByRole("button", { name: /^7 days/ }));
    rerender(<FunnelPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Download CSV · 7 days" }));
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/reports/funnel.csv${periodQuery(7)}`,
      expect.anything(),
    );
  });

  it("a refused download says why under the filter row, and saves nothing", async () => {
    stub(
      funnel,
      () =>
        new Response(
          JSON.stringify({
            title: "Forbidden",
            status: 403,
            code: "FORBIDDEN",
            detail: "Your role cannot download this report.",
          }),
          { status: 403, headers: { "content-type": "application/problem+json" } },
        ),
    );
    const { rerender } = render(<FunnelPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Download CSV · 30 days" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The file was not downloaded. Your role cannot download this report.",
    );
    expect(saved).toEqual([]);
    expect(createObjectURL).not.toHaveBeenCalled();

    // The refusal was for that period: choosing another clears it.
    await userEvent.click(screen.getByRole("button", { name: /^7 days/ }));
    rerender(<FunnelPage />);
    await vi.waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("the decision mix and the turnaround report download their own files", async () => {
    const mixFetch = stub(
      {
        period: funnel.period,
        decisions: 0,
        outcomes: [],
        straightThroughRate: "0.0000",
        reasonCodes: [],
        referralTriggers: [],
        recommendations: 0,
        overrides: 0,
        overrideRate: "0.0000",
        overrideReasons: [],
      },
      () => csvResponse("decision-mix.csv"),
    );
    const { unmount } = render(<DecisionsPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Download CSV · 30 days" }));
    expect(mixFetch).toHaveBeenCalledWith(
      `/api/reports/decision-mix.csv${periodQuery(30)}`,
      expect.anything(),
    );
    unmount();

    const tat: TurnaroundReport = {
      period: funnel.period,
      stages: [],
      openNow: { onTrack: 0, atRisk: 0, breached: 0 },
      businessDay: { start: "09:00", end: "17:00" },
      holidays: [],
      holidayCalendarEnds: null,
    };
    const tatFetch = stub(tat, () => csvResponse("turnaround-sla.csv"));
    render(<TurnaroundPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Download CSV · 30 days" }));
    expect(tatFetch).toHaveBeenCalledWith(
      `/api/reports/turnaround.csv${periodQuery(30)}`,
      expect.anything(),
    );
    expect(saved.map((s) => s.download)).toEqual(["decision-mix.csv", "turnaround-sla.csv"]);
  });
});
