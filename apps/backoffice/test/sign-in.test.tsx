import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import SignInPage from "@/app/sign-in/page";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const PERSONAS = [
  {
    id: "STF-RINA",
    username: "rina",
    fullName: "Rina Aquino",
    role: "APPROVER",
    title: "Approver",
    approvalLimit: "1000000.00",
    approvalGrades: ["A", "B", "C"],
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockReset();
});

describe("sign-in page (test sign-in, R-10)", () => {
  it("marks each blank field and sends nothing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, PERSONAS));
    vi.stubGlobal("fetch", fetchMock);
    render(<SignInPage />);
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("textbox", { name: "Username" })).toHaveAccessibleDescription(
      "Enter your username.",
    );
    expect(screen.getByLabelText("Password")).toHaveAccessibleDescription("Enter your password.");
    expect(fetchMock).not.toHaveBeenCalledWith("/api/auth/sign-in", expect.anything());
  });

  it("the shortcut fills only the username; a refusal clears the password and refocuses it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(200, PERSONAS))
      .mockResolvedValueOnce(
        json(401, {
          status: 401,
          code: "UNAUTHENTICATED",
          detail: "The username or password is not correct.",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(<SignInPage />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Use Rina Aquino's username" }),
    );
    expect(screen.getByRole("textbox", { name: "Username" })).toHaveValue("rina");
    const password = screen.getByLabelText("Password");
    expect(password).toHaveValue("");
    expect(password).toHaveFocus();
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
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(200, PERSONAS))
      .mockResolvedValueOnce(json(200, PERSONAS[0]));
    vi.stubGlobal("fetch", fetchMock);
    render(<SignInPage />);
    await userEvent.type(screen.getByRole("textbox", { name: "Username" }), "Rina");
    await userEvent.type(screen.getByLabelText("Password"), "rina-test-2026");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await vi.waitFor(() => expect(push).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ username: "Rina", password: "rina-test-2026" });
  });
});
