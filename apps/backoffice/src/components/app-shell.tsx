"use client";

import {
  type CaseList,
  ROLE_LABEL,
  type SimulationServiceView,
  type StaffNotificationList,
} from "@loan/core";
import { Avatar, buttonClass, cn, Icon, type IconName, useToast } from "@loan/ui";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { api, errorMessage } from "@/lib/api";
import { breadcrumbFor, isActive, navFor, pageIconFor } from "@/lib/navigation";
import { useSession } from "@/lib/session";
import { MODE_LABEL } from "@/lib/simulation";
import { useApi } from "@/lib/use-api";

export const ShellRefresh = createContext<() => void>(() => {});

/**
 * Refreshes the shell's queue count and simulated-failure banner. Call it after an action
 * that may change either (a case action, a mode switch). Outside the shell it does nothing.
 */
export function useShellRefresh(): () => void {
  return useContext(ShellRefresh);
}

const ShellCrumb = createContext<(label: string | null) => void>(() => {});

/**
 * Names the record a detail page shows in the top bar's breadcrumb (the prototype's
 * "Applications / All applications / APP-1042"). The page passes its reference once loaded;
 * it is cleared when the page goes. Outside the shell it does nothing.
 */
export function useShellCrumb(label: string | null): void {
  const set = useContext(ShellCrumb);
  useEffect(() => {
    set(label);
    return () => set(null);
  }, [label, set]);
}

/**
 * The prototype's shell: a dark 252px sidebar with grouped, iconed navigation and the
 * signed-in persona with sign-out at its foot (a drawer under 860px); a white sticky top bar
 * with the "Section / Page" breadcrumb (on a case, "Section / All applications / reference") and a role chip; and a warning banner while any
 * simulated service is not answering normally. The queue count and the banner refresh
 * on every navigation, so a mode switch or a completed action shows without a reload.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const me = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [detailCrumb, setDetailCrumb] = useState<string | null>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  /** Close the drawer and put focus back on the Menu button that opened it. */
  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    menuRef.current?.focus();
  }, []);
  const queue = useApi<CaseList>(
    me.role === "ADMIN" || me.role === "COMPLIANCE" ? null : "/cases?view=queue",
  );
  const services = useApi<SimulationServiceView[]>("/simulation/services");
  const alerts = useApi<StaffNotificationList>("/notifications");
  const unread = alerts.data?.unread ?? 0;
  const degraded = services.data?.filter((s) => s.mode !== "OK") ?? [];
  const reloadQueue = queue.reload;
  const reloadServices = services.reload;
  const reloadAlerts = alerts.reload;
  const refresh = useCallback(() => {
    void reloadQueue();
    void reloadServices();
    void reloadAlerts();
  }, [reloadQueue, reloadServices, reloadAlerts]);

  // useApi loads on mount; after that, refetch whenever the route changes.
  const firstRoute = useRef(pathname);
  useEffect(() => {
    if (firstRoute.current === pathname) return;
    firstRoute.current = pathname;
    refresh();
  }, [pathname, refresh]);

  // Under 860px the sidebar is a drawer: hidden from keyboard and screen readers while
  // closed, focus moves into it when it opens, and Escape closes it.
  useEffect(() => {
    // Without matchMedia (test environments; every supported browser has it) the screen
    // counts as wide, so the sidebar is never made inert.
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-width: 859.98px)");
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!drawerOpen) return;
    drawerRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDrawer();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen, closeDrawer]);

  async function signOut() {
    try {
      await api("/auth/logout", { method: "POST" });
      router.replace("/sign-in");
    } catch (e) {
      toast(`Sign-out did not complete: ${errorMessage(e)}`, "bad");
    }
  }

  const crumb = breadcrumbFor(me.role, pathname);
  // A detail page under a list: "<group> / <the list, a link> / <the record>", like the
  // prototype's "Applications / All applications / APP-1042". A case sits under All
  // applications; any other detail (an AML escalation) under the nav item whose path it extends.
  const groups = navFor(me.role);
  const casesGroup = groups.find((g) => g.items.some((i) => i.href === "/cases"));
  const parentOf = (): { heading: string; label: string; href: string } | null => {
    if (/^\/cases\/(?!new$)[^/]+$/.test(pathname)) {
      return casesGroup
        ? { heading: casesGroup.heading, label: crumb.section, href: "/cases" }
        : null;
    }
    // A page with its own nav item (New application) is not a detail.
    if (groups.some((g) => g.items.some((i) => i.href === pathname))) return null;
    for (const g of groups) {
      const item = g.items.find((i) => pathname.startsWith(`${i.href}/`));
      if (item) return { heading: g.heading, label: item.label, href: item.href };
    }
    return null;
  };
  const detailParent = parentOf();

  const nav = (
    <nav aria-label="Main" className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 py-4">
      {navFor(me.role).map((group) => (
        <div key={group.heading}>
          <p className="px-2 text-2xs font-bold tracking-widest text-mist-400 uppercase">
            {group.heading}
          </p>
          <ul className="mt-1.5 flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = isActive(item, pathname);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setDrawerOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-nav px-2.5 py-2 text-sm",
                      active
                        ? "bg-ink-700 font-semibold text-white"
                        : "font-medium text-mist-200 hover:bg-ink-700/60 hover:text-white",
                    )}
                  >
                    <Icon name={item.icon} className="size-5 text-mist-300" />
                    <span className="min-w-0 flex-1">{item.label}</span>
                    {/* The prototype shows a count only when there is something to do. */}
                    {item.count && queue.data && queue.data.items.length > 0 && (
                      <span className="grid h-5.5 min-w-5.5 place-items-center rounded-full bg-gold-500 px-1.5 text-2xs font-extrabold text-ink-900 tabular-nums">
                        {queue.data.items.length}
                      </span>
                    )}
                    {item.unread && unread > 0 && (
                      <span
                        data-testid="unread-badge"
                        className="grid h-5.5 min-w-5.5 place-items-center rounded-full bg-gold-500 px-1.5 text-2xs font-extrabold text-ink-900 tabular-nums"
                      >
                        {unread}
                        <span className="sr-only"> unread</span>
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen min-[860px]:pl-[252px]">
      <aside
        ref={drawerRef}
        inert={narrow && !drawerOpen}
        data-surface="dark"
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-[252px] flex-col bg-ink-800 transition-transform",
          drawerOpen ? "translate-x-0" : "-translate-x-full min-[860px]:translate-x-0",
        )}
      >
        <div className="border-b border-ink-700 px-6 py-5">
          <p className="text-base font-extrabold text-white">Lending Ops</p>
          <p className="text-xs text-mist-400">WhiteBank Lending</p>
        </div>
        {nav}
        <div className="mx-3 flex items-center gap-2.5 border-t border-ink-700 px-1.5 py-3">
          <Avatar name={me.fullName} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-white">{me.fullName}</p>
            <p className="truncate text-xs text-mist-400">{ROLE_LABEL[me.role]}</p>
          </div>
          <button
            type="button"
            onClick={signOut}
            aria-label="Sign out"
            title="Sign out"
            className="rounded-tile p-1.5 text-mist-300 hover:bg-ink-700 hover:text-white"
          >
            <Icon name="signOut" />
          </button>
        </div>
        <p className="px-5 pt-1 pb-4 text-2xs text-mist-400">
          MVP · synthetic data · simulated services
        </p>
      </aside>
      {drawerOpen && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-30 bg-ink-900/40 min-[860px]:hidden"
          onClick={closeDrawer}
        />
      )}

      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-white px-4 py-3 min-[860px]:px-6">
        <button
          ref={menuRef}
          type="button"
          className="grid size-10 place-items-center rounded-nav border border-line bg-white text-ink-700 hover:bg-mist-050 min-[860px]:hidden"
          onClick={() => setDrawerOpen(true)}
          aria-expanded={drawerOpen}
          aria-label="Menu"
        >
          <Icon name="menu" />
        </button>
        <nav
          aria-label="Breadcrumb"
          className="hidden items-center gap-2 text-sm whitespace-nowrap text-mist-500 min-[860px]:flex"
        >
          {detailParent ? (
            <>
              <span>{detailParent.heading}</span>
              <span aria-hidden="true" className="text-mist-300">
                /
              </span>
              <Link href={detailParent.href} className="hover:text-ink-900">
                {detailParent.label}
              </Link>
              <span aria-hidden="true" className="text-mist-300">
                /
              </span>
              <span aria-current="page" className="font-bold text-ink-900">
                {detailCrumb ?? (detailParent.href === "/cases" ? crumb.page : "Details")}
              </span>
            </>
          ) : (
            <>
              <span>{crumb.section}</span>
              <span aria-hidden="true" className="text-mist-300">
                /
              </span>
              <span aria-current="page" className="font-bold text-ink-900">
                {crumb.page}
              </span>
            </>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-2.5">
          {me.role === "ADMIN" && !pathname.startsWith("/simulation") && (
            <Link href="/simulation" className={buttonClass("primary")}>
              <Icon name="sliders" className="size-4" />
              Run simulation
            </Link>
          )}
          <div className="flex items-center gap-2 rounded-full border border-line bg-white py-1 pr-3 pl-1">
            <Avatar name={me.fullName} className="rounded-full" />
            <span className="text-sm font-semibold text-ink-900">{ROLE_LABEL[me.role]}</span>
          </div>
        </div>
      </header>

      {degraded.length > 0 && (
        <div
          role="status"
          className="border-b border-gold-200 bg-gold-050 px-4 py-2 text-sm text-gold-700 min-[860px]:px-8"
        >
          <strong>Simulated failure active:</strong>{" "}
          {degraded.map((s) => `${s.label} — ${MODE_LABEL[s.mode].toLowerCase()}`).join("; ")}.
          Cases that need these services are referred or can be retried; modes reset on their own.
        </div>
      )}

      <main className="px-4 py-7 min-[860px]:px-8">
        <ShellRefresh.Provider value={refresh}>
          <ShellCrumb.Provider value={setDetailCrumb}>{children}</ShellCrumb.Provider>
        </ShellRefresh.Provider>
      </main>
    </div>
  );
}

/**
 * A page heading: the prototype's 42px icon tile, the title and description, and actions on
 * the right. The icon defaults to the current nav item's.
 */
export function PageHeader({
  title,
  description,
  actions,
  icon,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  icon?: IconName;
}) {
  const me = useSession();
  const pathname = usePathname();
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-start gap-4">
        <span className="mt-1 grid size-12 shrink-0 place-items-center rounded-btn border border-line bg-mist-100 text-ink-700">
          <Icon name={icon ?? pageIconFor(me.role, pathname)} className="size-5" />
        </span>
        <div>
          <h1 className="text-display leading-tight font-extrabold">{title}</h1>
          {description && <p className="mt-1.5 max-w-[70ch] text-base">{description}</p>}
        </div>
      </div>
      {actions}
    </div>
  );
}
