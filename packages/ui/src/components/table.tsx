import type { MouseEvent, ReactNode } from "react";
import { cn } from "../lib/cn";
import { EmptyState } from "./empty-state";

export interface Column<T> {
  key: string;
  header: string;
  /** Right-align with tabular figures (amounts, counts), in the body font. */
  numeric?: boolean;
  render: (row: T) => ReactNode;
}

export interface TableProps<T> {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Shown instead of the table when there are no rows: a short sentence, or an EmptyState. */
  empty: ReactNode;
  footer?: ReactNode;
  /**
   * Make each whole row open its record (the prototype's `tr.cl`). The row must hold one real
   * link marked with `data-row-link` (see ROW_LINK): that link is the keyboard and screen-reader
   * path, and a click anywhere else in the row follows it.
   */
  clickableRows?: boolean;
}

/** Spread onto the one link in a row that the whole row should open: `<Link {...ROW_LINK}>`. */
export const ROW_LINK = { "data-row-link": "" } as const;

/** Anything in a row that handles its own click: leave those alone. */
const INTERACTIVE = "a, button, input, select, textarea, label, summary, [role='button']";

/**
 * A click on a clickable row follows its row link, unless the click landed on something
 * interactive (it handles itself), used a modifier or another button (let the browser decide),
 * or ended a text selection (the user was copying a reference).
 */
export function followRowLink(e: MouseEvent<HTMLTableRowElement>): void {
  if (e.defaultPrevented || e.button !== 0) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const target = e.target as Element;
  if (target.closest(INTERACTIVE)) return;
  const selection = typeof window.getSelection === "function" ? window.getSelection() : null;
  if (selection && !selection.isCollapsed && selection.toString().trim() !== "") return;
  e.currentTarget.querySelector<HTMLAnchorElement>("a[data-row-link]")?.click();
}

/**
 * A dense data table in the prototype's look (.t): a tinted header row of small uppercase
 * labels, 13px cells, soft row dividers. The caption is visible to screen readers only.
 */
export function Table<T>({
  caption,
  columns,
  rows,
  rowKey,
  empty,
  footer,
  clickableRows = false,
}: TableProps<T>) {
  if (rows.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-line bg-white">
        {typeof empty === "string" ? <EmptyState title={empty} /> : empty}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-card border border-line bg-white shadow-card">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line bg-mist-050">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  "px-4 py-3 text-2xs font-bold tracking-wider whitespace-nowrap text-mist-500 uppercase",
                  c.numeric ? "text-right" : "text-left",
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              data-clickable={clickableRows || undefined}
              onClick={clickableRows ? followRowLink : undefined}
              className={cn(
                "border-b border-line-soft last:border-b-0",
                clickableRows &&
                  "cursor-pointer transition-colors focus-within:bg-mist-050 hover:bg-mist-050",
              )}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn("px-4 py-3.5 align-middle", c.numeric && "text-right tabular-nums")}
                >
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && (
          <tfoot className="border-t border-line bg-mist-050 font-semibold">{footer}</tfoot>
        )}
      </table>
    </div>
  );
}
