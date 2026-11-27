import type { Role } from "@loan/core";
import { landingFor, navFor } from "@/lib/navigation";

describe("where each role lands and what its sidebar offers", () => {
  it.each([
    ["LOAN_OFFICER", "/queue"],
    ["APPROVER", "/queue"],
    ["LOAN_OPERATIONS", "/queue"],
    ["LOAN_OPERATIONS_SUPERVISOR", "/queue"],
    ["COMPLIANCE", "/cases"],
    ["ADMIN", "/simulation"],
  ] as [Role, string][])("%s lands on %s", (role, path) => {
    expect(landingFor(role)).toBe(path);
  });

  const hrefs = (role: Role) => navFor(role).flatMap((g) => g.items.map((i) => i.href));

  it("only the loan officer can start a new application", () => {
    expect(hrefs("LOAN_OFFICER")).toContain("/cases/new");
    expect(hrefs("APPROVER")).not.toContain("/cases/new");
  });

  it("admin has no case screens and compliance has no queue", () => {
    expect(hrefs("ADMIN")).toEqual(["/simulation"]);
    expect(hrefs("COMPLIANCE")).toEqual(["/cases", "/simulation"]);
  });
});
