import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import { SessionProvider, useSession } from "@/lib/session";

const { replace, router } = vi.hoisted(() => {
  const replace = vi.fn();
  return { replace, router: { replace } };
});
// A stable router, as Next gives one.
vi.mock("next/navigation", () => ({ useRouter: () => router }));

afterEach(() => {
  vi.unstubAllGlobals();
  replace.mockReset();
});

function Me() {
  return <p>Signed in as {useSession().fullName}</p>;
}

const renderSession = () =>
  render(
    <SessionProvider fallback={<p>Checking your session…</p>}>
      <Me />
    </SessionProvider>,
  );

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe("SessionProvider", () => {
  it("sends an expired session back to sign-in", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(401, { status: 401, detail: "Sign in." })),
    );
    renderSession();
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in"));
  });

  it("shows an API outage with a retry instead of hanging, and recovers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json(502, { status: 502, detail: "The lending service is not answering." }),
      )
      .mockResolvedValueOnce(
        json(200, { id: "STF-PAOLO", fullName: "Paolo Tan", role: "LOAN_OFFICER" }),
      );
    vi.stubGlobal("fetch", fetchMock);
    renderSession();
    expect(await screen.findByRole("alert")).toHaveTextContent("not answering");
    expect(replace).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Signed in as Paolo Tan")).toBeInTheDocument();
  });
});
