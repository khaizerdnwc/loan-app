import type { ReactNode } from "react";
import { cn } from "../lib/cn";

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
  empty: ReactNode;
  footer?: ReactNode;
}

/** A dense data table. The caption is visible to screen readers only. */
export function Table<T>({ caption, columns, rows, rowKey, empty, footer }: TableProps<T>) {
  if (rows.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-line px-6 py-10 text-center text-sm text-mist-500">
        {empty}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-card border border-line bg-white">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line bg-mist-050">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  "px-4 py-3 text-2xs font-bold tracking-wider text-mist-500 uppercase",
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
            <tr key={rowKey(row)} className="border-b border-line last:border-b-0">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn("px-4 py-3 align-middle", c.numeric && "text-right tabular-nums")}
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
