import type { Role } from "@loan/core";
import { breadcrumbFor, landingFor, navFor, pageIconFor } from "@/lib/navigation";

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
    expect(hrefs("ADMIN")).toEqual([
      "/audit",
      "/reports/funnel",
      "/reports/decisions",
      "/reports/turnaround",
      "/simulation",
      "/automation",
      "/models",
      "/approval-matrix",
    ]);
    expect(hrefs("COMPLIANCE")).toEqual([
      "/cases",
      "/intake",
      "/compliance/escalations",
      "/audit",
      "/operations/exceptions",
      "/reports/funnel",
      "/reports/decisions",
      "/reports/turnaround",
      "/simulation",
      "/automation",
      "/models",
      "/approval-matrix",
    ]);
    expect(hrefs("LOAN_OFFICER")).not.toContain("/automation");
    expect(hrefs("LOAN_OFFICER")).not.toContain("/models");
    expect(hrefs("APPROVER")).not.toContain("/models");
  });

  it("booking exceptions for loan operations and Compliance; reports for the roles that read decisions", () => {
    for (const role of ["LOAN_OPERATIONS", "LOAN_OPERATIONS_SUPERVISOR"] as Role[]) {
      expect(hrefs(role)).toContain("/operations/exceptions");
      expect(hrefs(role)).not.toContain("/reports/funnel");
    }
    for (const role of ["LOAN_OFFICER", "APPROVER"] as Role[]) {
      expect(hrefs(role)).not.toContain("/operations/exceptions");
      expect(hrefs(role)).toEqual(
        expect.arrayContaining(["/reports/funnel", "/reports/decisions"]),
      );
    }
    expect(breadcrumbFor("LOAN_OPERATIONS", "/operations/exceptions")).toEqual({
      section: "My work",
      page: "Booking exceptions",
    });
    expect(breadcrumbFor("APPROVER", "/reports/decisions")).toEqual({
      section: "Reports",
      page: "Decisioning",
    });
    expect(pageIconFor("ADMIN", "/reports/funnel")).toBe("chart");
  });

  it("email and file intake for the loan officer (who acts) and compliance (who reads) only (INT-5)", () => {
    expect(hrefs("LOAN_OFFICER")).toContain("/intake");
    for (const role of [
      "APPROVER",
      "LOAN_OPERATIONS",
      "LOAN_OPERATIONS_SUPERVISOR",
      "ADMIN",
    ] as Role[]) {
      expect(hrefs(role)).not.toContain("/intake");
    }
    expect(breadcrumbFor("LOAN_OFFICER", "/intake")).toEqual({
      section: "My work",
      page: "Email and file intake",
    });
  });

  it("only compliance works AML escalations; compliance and admin read the audit log", () => {
    for (const role of ["LOAN_OFFICER", "APPROVER", "LOAN_OPERATIONS_SUPERVISOR"] as Role[]) {
      expect(hrefs(role)).not.toContain("/audit");
      expect(hrefs(role)).not.toContain("/compliance/escalations");
    }
    expect(hrefs("ADMIN")).not.toContain("/compliance/escalations");
  });
});

describe("breadcrumb and page icons", () => {
  it.each([
    ["LOAN_OFFICER", "/queue", "My work", "Work queue", "inbox"],
    ["LOAN_OFFICER", "/cases/new", "My work", "New application", "plus"],
    ["LOAN_OFFICER", "/cases", "My work", "All applications", "file"],
    ["APPROVER", "/queue", "My work", "Approvals", "check"],
    ["LOAN_OPERATIONS", "/queue", "My work", "Booking", "book"],
    ["ADMIN", "/simulation", "System", "Simulated services", "sliders"],
    ["ADMIN", "/automation", "System", "Automation controls", "sliders"],
    ["COMPLIANCE", "/models", "System", "Model governance", "chart"],
    ["ADMIN", "/audit", "Compliance", "Audit log", "list"],
    ["COMPLIANCE", "/compliance/escalations", "Compliance", "AML escalations", "shieldAlert"],
    ["COMPLIANCE", "/compliance/escalations/0b6d", "Compliance", "AML escalations", "shieldAlert"],
  ] as [Role, string, string, string, string][])(
    "%s on %s reads %s / %s with the %s icon",
    (role, path, section, page, icon) => {
      expect(breadcrumbFor(role, path)).toEqual({ section, page });
      expect(pageIconFor(role, path)).toBe(icon);
    },
  );

  it("a case page sits under All applications", () => {
    expect(breadcrumbFor("APPROVER", "/cases/0b6d")).toEqual({
      section: "All applications",
      page: "Case",
    });
    expect(pageIconFor("APPROVER", "/cases/0b6d")).toBe("file");
  });

  it("every nav item has an icon", () => {
    const roles: Role[] = [
      "LOAN_OFFICER",
      "APPROVER",
      "LOAN_OPERATIONS",
      "LOAN_OPERATIONS_SUPERVISOR",
      "COMPLIANCE",
      "ADMIN",
    ];
    for (const role of roles) {
      for (const item of navFor(role).flatMap((g) => g.items)) expect(item.icon).toBeTruthy();
    }
  });
});
