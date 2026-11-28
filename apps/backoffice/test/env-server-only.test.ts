// Runs in jsdom (the default here): a browser-like global `window`.
import { describe, expect, it } from "vitest";

describe("the backoffice env module is server-only", () => {
  it("throws when it is loaded where `window` exists", async () => {
    expect(typeof window).toBe("object");
    await expect(import("@/config/env")).rejects.toThrow(/server-only/);
  });
});
