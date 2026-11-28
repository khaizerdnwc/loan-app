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
    // The eligibility pre-check is the loan officer's (PC-008).
    expect(hrefs("LOAN_OFFICER")).toContain("/eligibility");
    expect(hrefs("APPROVER")).not.toContain("/eligibility");
    expect(hrefs("COMPLIANCE")).not.toContain("/eligibility");
  });

  it("admin has no case screens and compliance has no queue", () => {
    expect(hrefs("ADMIN")).toEqual([
      "/notifications",
      "/audit",
      "/reports/funnel",
      "/reports/decisions",
      "/reports/turnaround",
      "/simulation",
      "/automation",
      "/models",
      "/approval-matrix",
      "/features",
      "/calendar",
    ]);
    expect(hrefs("COMPLIANCE")).toEqual([
      "/cases",
      "/intake",
      "/notifications",
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

  it("every role has its notifications (PRD NTF-002)", () => {
    for (const role of [
      "LOAN_OFFICER",
      "APPROVER",
      "LOAN_OPERATIONS",
      "LOAN_OPERATIONS_SUPERVISOR",
      "COMPLIANCE",
      "ADMIN",
    ] as Role[]) {
      expect(hrefs(role)).toContain("/notifications");
      expect(breadcrumbFor(role, "/notifications")).toEqual({
        section: "My work",
        page: "Notifications",
      });
    }
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
    ["LOAN_OFFICER", "/eligibility", "My work", "Eligibility pre-check", "check"],
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

describe("a module the bank switched off leaves the sidebar (FF-5, PRD PLT-006)", () => {
  const hrefsWith = (role: Role, features?: Parameters<typeof navFor>[1]) =>
    navFor(role, features).flatMap((g) => g.items.map((i) => i.href));

  it("hides the eligibility pre-check and email intake when they are off", () => {
    const off = { ELIGIBILITY_PRECHECK: false, EMAIL_INTAKE: false };
    expect(hrefsWith("LOAN_OFFICER", off)).not.toContain("/eligibility");
    expect(hrefsWith("LOAN_OFFICER", off)).not.toContain("/intake");
    expect(hrefsWith("COMPLIANCE", off)).not.toContain("/intake");
    // Everything else stays.
    expect(hrefsWith("LOAN_OFFICER", off)).toContain("/cases/new");
  });

  it("shows them when on, and while the state is still loading (unknown is not off)", () => {
    for (const features of [
      undefined,
      null,
      {},
      { ELIGIBILITY_PRECHECK: true, EMAIL_INTAKE: true },
    ]) {
      expect(hrefsWith("LOAN_OFFICER", features)).toEqual(
        expect.arrayContaining(["/eligibility", "/intake"]),
      );
    }
  });

  it("switches each module separately", () => {
    const hrefs = hrefsWith("LOAN_OFFICER", { ELIGIBILITY_PRECHECK: true, EMAIL_INTAKE: false });
    expect(hrefs).toContain("/eligibility");
    expect(hrefs).not.toContain("/intake");
  });

  it("only administrators get the Feature flags screen", () => {
    expect(hrefsWith("ADMIN")).toContain("/features");
    for (const role of ["LOAN_OFFICER", "APPROVER", "COMPLIANCE", "LOAN_OPERATIONS"] as Role[]) {
      expect(hrefsWith(role)).not.toContain("/features");
    }
  });

  it("only administrators get the Business calendar screen (HC-7, PRD PLT-005)", () => {
    expect(hrefsWith("ADMIN")).toContain("/calendar");
    for (const role of ["LOAN_OFFICER", "APPROVER", "COMPLIANCE", "LOAN_OPERATIONS"] as Role[]) {
      expect(hrefsWith(role)).not.toContain("/calendar");
    }
  });
});
