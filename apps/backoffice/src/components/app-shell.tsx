"use client";

import { type CaseList, ROLE_LABEL, type SimulationServiceView } from "@loan/core";
import { Button, cn, useToast } from "@loan/ui";
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
import { navFor } from "@/lib/navigation";
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

/**
 * The prototype's shell: a dark 252px sidebar with grouped navigation (a drawer under
 * 860px), a white sticky top bar with the persona and sign-out, and a warning banner while
 * any simulated service is not answering normally. The queue count and the banner refresh
 * on every navigation, so a mode switch or a completed action shows without a reload.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const me = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [narrow, setNarrow] = useState(false);
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
  const degraded = services.data?.filter((s) => s.mode !== "OK") ?? [];
  const reloadQueue = queue.reload;
  const reloadServices = services.reload;
  const refresh = useCallback(() => {
    void reloadQueue();
    void reloadServices();
  }, [reloadQueue, reloadServices]);

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

  const nav = (
    <nav aria-label="Main" className="flex flex-1 flex-col gap-6 px-4 py-6">
      {navFor(me.role).map((group) => (
        <div key={group.heading}>
          <p className="px-3 text-[11px] font-semibold tracking-wider text-mist-400 uppercase">
            {group.heading}
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {group.items.map((item) => {
              const active =
                item.href === "/cases" ? pathname === "/cases" : pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setDrawerOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center justify-between rounded-btn px-3 py-2 text-sm font-semibold",
                      active
                        ? "bg-ink-700 text-white"
                        : "text-mist-300 hover:bg-ink-700 hover:text-white",
                    )}
                  >
                    {item.label}
                    {item.count && queue.data && (
                      <span className="rounded-full bg-gold-500 px-2 font-mono text-xs text-ink-900">
                        {queue.data.items.length}
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
        <div className="border-t border-ink-700 px-6 py-4 text-xs text-mist-400">
          MVP · synthetic data · simulated services
        </div>
      </aside>
      {drawerOpen && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-30 bg-ink-900/40 min-[860px]:hidden"
          onClick={closeDrawer}
        />
      )}

      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-line bg-white px-4 py-3 min-[860px]:px-8">
        <button
          ref={menuRef}
          type="button"
          className="rounded-btn border border-line px-3 py-1.5 text-sm font-semibold min-[860px]:hidden"
          onClick={() => setDrawerOpen(true)}
          aria-expanded={drawerOpen}
        >
          Menu
        </button>
        <p className="hidden text-sm text-mist-500 min-[860px]:block">WhiteBank · Personal loans</p>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-sm font-semibold text-ink-900">{me.fullName}</p>
            <p className="text-xs text-mist-500">{ROLE_LABEL[me.role]}</p>
          </div>
          <Button variant="secondary" onClick={signOut}>
            Sign out
          </Button>
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
        <ShellRefresh.Provider value={refresh}>{children}</ShellRefresh.Provider>
      </main>
    </div>
  );
}

/** A page heading with an optional description and actions on the right. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[32px] leading-tight font-extrabold">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm">{description}</p>}
      </div>
      {actions}
    </div>
  );
}
