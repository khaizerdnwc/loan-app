import type { Role } from "@loan/core";
import type { IconName } from "@loan/ui";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** Show the role's queue count next to it. */
  count?: boolean;
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

  const groups: NavGroup[] = [];
  if (work.length) groups.push({ heading: "My work", items: work });
  groups.push({
    heading: "System",
    items: [{ href: "/simulation", label: "Simulated services", icon: "sliders" }],
  });
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
