import type { Role } from "@loan/core";
import type { IconName } from "@loan/ui";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** Show the role's queue count next to it. */
  count?: boolean;
  /** Show the caller's unread alert count next to it. */
  unread?: boolean;
}

export interface NavGroup {
  heading: string;
  items: NavItem[];
}

const QUEUE: Partial<Record<Role, { label: string; icon: IconName }>> = {
  LOAN_OFFICER: { label: "Work queue", icon: "inbox" },
  APPROVER: { label: "Approvals", icon: "check" },
  LOAN_OPERATIONS: { label: "Booking", icon: "book" },
  LOAN_OPERATIONS_SUPERVISOR: { label: "Booking checks", icon: "book" },
};

/** The sidebar for a role. The API still refuses anything a role cannot do. */
export function navFor(role: Role): NavGroup[] {
  const work: NavItem[] = [];
  const queue = QUEUE[role];
  if (queue) work.push({ href: "/queue", ...queue, count: true });
  if (role === "LOAN_OFFICER")
    work.push({ href: "/cases/new", label: "New application", icon: "plus" });
  if (role !== "ADMIN") work.push({ href: "/cases", label: "All applications", icon: "file" });
  // Email and file intake (PRD INT-010, F4): the loan officer reviews OCR drafts; compliance reads.
  if (role === "LOAN_OFFICER" || role === "COMPLIANCE") {
    work.push({ href: "/intake", label: "Email and file intake", icon: "send" });
  }
  // Booking exceptions and reconciliation (PRD BKG-005): loan operations' own screen.
  if (role === "LOAN_OPERATIONS" || role === "LOAN_OPERATIONS_SUPERVISOR") {
    work.push({ href: "/operations/exceptions", label: "Booking exceptions", icon: "alert" });
  }
  // Staff alerts (PRD NTF-002): everyone has some (assignments, work for the role, SLA).
  work.push({ href: "/notifications", label: "Notifications", icon: "bell", unread: true });

  const groups: NavGroup[] = [];
  if (work.length) groups.push({ heading: "My work", items: work });
  // Compliance screens (PRD CMP-005, PLT-004): the audit log for compliance and the
  // administrator, AML escalations for compliance only.
  const compliance: NavItem[] = [];
  if (role === "COMPLIANCE") {
    compliance.push({
      href: "/compliance/escalations",
      label: "AML escalations",
      icon: "shieldAlert",
    });
  }
  if (role === "COMPLIANCE" || role === "ADMIN") {
    compliance.push({ href: "/audit", label: "Audit log", icon: "list" });
  }
  // Compliance reads the booking exceptions and reconciliation too (it does not run it).
  if (role === "COMPLIANCE") {
    compliance.push({ href: "/operations/exceptions", label: "Booking exceptions", icon: "alert" });
  }
  if (compliance.length) groups.push({ heading: "Compliance", items: compliance });
  // Reports (PRD RPT-001, RPT-003): counts only, for the roles that read decisions.
  if (role === "LOAN_OFFICER" || role === "APPROVER" || role === "COMPLIANCE" || role === "ADMIN") {
    groups.push({
      heading: "Reports",
      items: [
        { href: "/reports/funnel", label: "Origination funnel", icon: "chart" },
        { href: "/reports/decisions", label: "Decisioning", icon: "chart" },
        { href: "/reports/turnaround", label: "Turnaround and SLA", icon: "chart" },
      ],
    });
  }
  const system: NavItem[] = [{ href: "/simulation", label: "Simulated services", icon: "sliders" }];
  // Automation controls (PRD §7.5): administrators change them, compliance reads them.
  if (role === "ADMIN" || role === "COMPLIANCE")
    system.push(
      { href: "/automation", label: "Automation controls", icon: "sliders" },
      // Model governance (PRD AIS-008..012): read by administrators and compliance.
      { href: "/models", label: "Model governance", icon: "chart" },
    );
  groups.push({ heading: "System", items: system });
  return groups;
}

/** Whether a nav item is the current page (`/cases` only matches the list itself). */
export function isActive(item: NavItem, pathname: string): boolean {
  return item.href === "/cases" ? pathname === "/cases" : pathname.startsWith(item.href);
}

/**
 * The top bar's "Section / Page" breadcrumb for a path, from the role's own navigation. A
 * case page sits under All applications (or the role's queue when it has no list).
 */
export function breadcrumbFor(role: Role, pathname: string): { section: string; page: string } {
  const groups = navFor(role);
  for (const group of groups) {
    const item = group.items.find((i) => isActive(i, pathname));
    if (item) return { section: group.heading, page: item.label };
  }
  if (pathname.startsWith("/cases/")) {
    const list = groups.flatMap((g) => g.items).find((i) => i.href === "/cases");
    return { section: list?.label ?? "My work", page: "Case" };
  }
  return { section: "My work", page: "Overview" };
}

/** The icon for a page title tile: the nav item's icon, or a file for a case. */
export function pageIconFor(role: Role, pathname: string): IconName {
  const item = navFor(role)
    .flatMap((g) => g.items)
    .find((i) => isActive(i, pathname));
  return item?.icon ?? "file";
}

/** Where a role lands after signing in. */
export function landingFor(role: Role): string {
  if (role === "ADMIN") return "/simulation";
  if (role === "COMPLIANCE") return "/cases";
  return "/queue";
}
