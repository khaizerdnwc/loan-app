import type { FeatureStateView, StaffView } from "@loan/core";
import { ToastProvider } from "@loan/ui";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, vi } from "vitest";
import EligibilityPage from "@/app/(staff)/eligibility/page";
import IntakePage from "@/app/(staff)/intake/page";
import { LoadState } from "@/components/load-state";
import { FeaturesContext } from "@/lib/features";

const { session } = vi.hoisted(() => ({
  session: { me: { id: "STF-PAOLO", fullName: "Paolo Tan", role: "LOAN_OFFICER" } },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/intake",
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/lib/session", () => ({ useSession: () => session.me as StaffView }));

afterEach(() => {
  vi.unstubAllGlobals();
});

const withFeatures = (state: FeatureStateView, page: ReactNode) =>
  render(
    <ToastProvider>
      <FeaturesContext.Provider value={state}>{page}</FeaturesContext.Provider>
    </ToastProvider>,
  );

describe("a switched-off module's page says so, neutrally, with nothing to do (FF-5)", () => {
  it("email intake off: the statement, what is kept, and no upload, filter, table or retry; nothing fetched", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    withFeatures({ ELIGIBILITY_PRECHECK: true, EMAIL_INTAKE: false }, <IntakePage />);
    expect(screen.getByRole("heading", { name: "Email and file intake" })).toBeInTheDocument();
    expect(
      screen.getByText("Email and file intake is switched off for this bank."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/switch it on under Feature flags\. Drafts already captured are kept\./),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText("Try again")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("eligibility pre-check off: the statement and no form", () => {
    withFeatures({ ELIGIBILITY_PRECHECK: false, EMAIL_INTAKE: true }, <EligibilityPage />);
    expect(
      screen.getByText("Eligibility pre-check is switched off for this bank."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("eligibility pre-check on: the form as before", () => {
    withFeatures({ ELIGIBILITY_PRECHECK: true, EMAIL_INTAKE: true }, <EligibilityPage />);
    expect(screen.queryByText(/is switched off for this bank/)).toBeNull();
    expect(screen.getAllByRole("textbox").length).toBeGreaterThan(0);
  });
});

describe("LoadState and a module switched off after the page loaded (FF-5)", () => {
  it("shows FEATURE_DISABLED as a neutral statement with no Try again", () => {
    render(
      <LoadState
        loading={false}
        error="Email and file intake is switched off for this bank."
        code="FEATURE_DISABLED"
        onRetry={() => {}}
      />,
    );
    expect(
      screen.getByText("Email and file intake is switched off for this bank."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("any other failure keeps its alert and Try again", () => {
    render(
      <LoadState
        loading={false}
        error="The API is down."
        code="INTERNAL_ERROR"
        onRetry={() => {}}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("The API is down.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
