import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import SignInPage from "@/app/sign-in/page";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const RINA = {
  id: "STF-RINA",
  username: "rina",
  fullName: "Rina Aquino",
  role: "APPROVER",
  title: "Approver",
  approvalLimit: "1000000.00",
  approvalGrades: ["A", "B", "C"],
};

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockReset();
});

describe("sign-in page (test sign-in, R-10)", () => {
  it("lists no accounts and calls nothing until the form is sent", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<SignInPage />);
    expect(screen.queryByText(/Rina|Paolo|Use /)).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("marks each blank field and sends nothing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<SignInPage />);
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("textbox", { name: "Username" })).toHaveAccessibleDescription(
      "Enter your username.",
    );
    expect(screen.getByLabelText("Password")).toHaveAccessibleDescription("Enter your password.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a refusal shows one message, clears the password and refocuses it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        json(401, {
          status: 401,
          code: "UNAUTHENTICATED",
          detail: "The username or password is not correct.",
        }),
      ),
    );
    render(<SignInPage />);
    await userEvent.type(screen.getByRole("textbox", { name: "Username" }), "rina");
    const password = screen.getByLabelText("Password");
    await userEvent.type(password, "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The username or password is not correct.",
    );
    expect(password).toHaveValue("");
    expect(password).toHaveFocus();
    expect(push).not.toHaveBeenCalled();
  });

  it("signs in and goes to the role's landing screen", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json(200, RINA));
    vi.stubGlobal("fetch", fetchMock);
    render(<SignInPage />);
    await userEvent.type(screen.getByRole("textbox", { name: "Username" }), "Rina");
    await userEvent.type(screen.getByLabelText("Password"), "Password123!");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/queue"));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/auth/sign-in");
    expect(JSON.parse(String(init.body))).toEqual({ username: "Rina", password: "Password123!" });
  });
});
