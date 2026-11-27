import type { Role } from "@loan/core";

export interface NavItem {
  href: string;
  label: string;
  /** Show the role's queue count next to it. */
  count?: boolean;
}

export interface NavGroup {
  heading: string;
  items: NavItem[];
}

const QUEUE_LABEL: Partial<Record<Role, string>> = {
  LOAN_OFFICER: "Work queue",
  APPROVER: "Approvals",
  LOAN_OPERATIONS: "Booking",
  LOAN_OPERATIONS_SUPERVISOR: "Booking checks",
};

/** The sidebar for a role. The API still refuses anything a role cannot do. */
export function navFor(role: Role): NavGroup[] {
  const work: NavItem[] = [];
  const queue = QUEUE_LABEL[role];
  if (queue) work.push({ href: "/queue", label: queue, count: true });
  if (role === "LOAN_OFFICER") work.push({ href: "/cases/new", label: "New application" });
  if (role !== "ADMIN") work.push({ href: "/cases", label: "All applications" });

  const groups: NavGroup[] = [];
  if (work.length) groups.push({ heading: "My work", items: work });
  groups.push({ heading: "System", items: [{ href: "/simulation", label: "Simulated services" }] });
  return groups;
}

/** Where a role lands after signing in. */
export function landingFor(role: Role): string {
  if (role === "ADMIN") return "/simulation";
  if (role === "COMPLIANCE") return "/cases";
  return "/queue";
}
