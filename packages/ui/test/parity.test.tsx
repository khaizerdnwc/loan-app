/**
 * The shared parts copied from the prototype (docs/ui-parity.md): clickable rows, one button
 * hierarchy, one pill, one callout, label-over-value facts, the stage bar and the toast.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import {
  Button,
  buttonClass,
  Callout,
  type Column,
  ConfirmDialog,
  EmptyState,
  KeyValues,
  Pill,
  ROW_LINK,
  StageBar,
  Table,
  ToastProvider,
  useToast,
} from "../src";

interface Row {
  id: string;
  name: string;
}

function rowsTable(onOpen: (id: string) => void, extra?: (row: Row) => React.ReactNode) {
  const columns: Column<Row>[] = [
    {
      key: "name",
      header: "Name",
      render: (r) => (
        <a
          {...ROW_LINK}
          href={`/cases/${r.id}`}
          onClick={(e) => {
            e.preventDefault();
            onOpen(r.id);
          }}
        >
          {r.name}
        </a>
      ),
    },
    { key: "ref", header: "Reference", render: (r) => <span>REF-{r.id}</span> },
    { key: "extra", header: "Action", render: (r) => extra?.(r) ?? null },
  ];
  return (
    <Table
      caption="Cases"
      columns={columns}
      rows={[
        { id: "1", name: "Joel Reyes" },
        { id: "2", name: "Maria Santos" },
      ]}
      rowKey={(r) => r.id}
      empty="None"
      clickableRows
    />
  );
}

describe("Table with clickable rows (the prototype's tr.cl)", () => {
  it("opens the row's record when any cell of the row is clicked", async () => {
    const onOpen = vi.fn();
    render(rowsTable(onOpen));
    await userEvent.click(screen.getByText("REF-2"));
    expect(onOpen).toHaveBeenCalledWith("2");
  });

  it("marks rows as clickable so hover and focus highlight the whole row", () => {
    render(rowsTable(() => {}));
    const row = screen.getAllByRole("row")[1] as HTMLElement;
    expect(row).toHaveAttribute("data-clickable", "true");
    expect(row.className).toMatch(/cursor-pointer/);
    expect(row.className).toMatch(/hover:bg-mist-050/);
    expect(row.className).toMatch(/focus-within:bg-mist-050/);
  });

  it("keeps a real link in the row: reached with Tab and opened with Enter", async () => {
    const onOpen = vi.fn();
    render(rowsTable(onOpen));
    await userEvent.tab();
    const link = screen.getByRole("link", { name: "Joel Reyes" });
    expect(link).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledWith("1");
  });

  it("does not add a second tab stop: the row itself is not focusable", () => {
    render(rowsTable(() => {}));
    expect(screen.getAllByRole("row")[1]).not.toHaveAttribute("tabindex");
  });

  it("leaves a button inside the row to do its own job", async () => {
    const onOpen = vi.fn();
    const onPick = vi.fn();
    render(
      rowsTable(onOpen, (r) => (
        <button type="button" onClick={() => onPick(r.id)}>
          Pick
        </button>
      )),
    );
    await userEvent.click(within(screen.getAllByRole("row")[1] as HTMLElement).getByText("Pick"));
    expect(onPick).toHaveBeenCalledWith("1");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("ignores a modified click (new tab is the link's job) and a text selection", () => {
    const onOpen = vi.fn();
    render(rowsTable(onOpen));
    fireEvent.click(screen.getByText("REF-1"), { metaKey: true });
    fireEvent.click(screen.getByText("REF-1"), { ctrlKey: true });
    const selection = vi
      .spyOn(window, "getSelection")
      .mockReturnValue({ isCollapsed: false, toString: () => "REF-1" } as unknown as Selection);
    fireEvent.click(screen.getByText("REF-1"));
    selection.mockRestore();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("leaves a row without a record to open as a plain row (rowClickable)", async () => {
    const onOpen = vi.fn();
    render(
      <Table
        caption="Entries"
        columns={[
          {
            key: "n",
            header: "Entry",
            render: (r: Row) =>
              r.id === "1" ? (
                <a
                  {...ROW_LINK}
                  href="/x"
                  onClick={(e) => {
                    e.preventDefault();
                    onOpen(r.id);
                  }}
                >
                  {r.name}
                </a>
              ) : (
                <span>{r.name}</span>
              ),
          },
        ]}
        rows={[
          { id: "1", name: "With a case" },
          { id: "2", name: "Without" },
        ]}
        rowKey={(r) => r.id}
        empty="None"
        clickableRows
        rowClickable={(r) => r.id === "1"}
      />,
    );
    const [, withCase, without] = screen.getAllByRole("row") as HTMLElement[];
    expect(withCase).toHaveAttribute("data-clickable", "true");
    expect(without).not.toHaveAttribute("data-clickable");
    await userEvent.click(screen.getByText("Without"));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("draws its own frame by default, and none inside a Card flush (framed={false})", () => {
    const cols = [{ key: "n", header: "#", render: (r: Row) => r.id }];
    const { rerender } = render(
      <Table
        caption="T"
        columns={cols}
        rows={[{ id: "1", name: "x" }]}
        rowKey={(r) => r.id}
        empty="None"
      />,
    );
    expect(screen.getByRole("table").parentElement).toHaveAttribute("data-framed", "true");
    expect(screen.getByRole("table").parentElement?.className).toMatch(/border-line/);
    rerender(
      <Table
        caption="T"
        columns={cols}
        rows={[{ id: "1", name: "x" }]}
        rowKey={(r) => r.id}
        empty="None"
        framed={false}
      />,
    );
    expect(screen.getByRole("table").parentElement).not.toHaveAttribute("data-framed");
    expect(screen.getByRole("table").parentElement?.className).not.toMatch(/border/);
  });

  it("is not clickable unless asked", () => {
    render(
      <Table
        caption="Lines"
        columns={[{ key: "n", header: "#", render: (r: Row) => r.id }]}
        rows={[{ id: "1", name: "x" }]}
        rowKey={(r) => r.id}
        empty="None"
      />,
    );
    const row = screen.getAllByRole("row")[1] as HTMLElement;
    expect(row).not.toHaveAttribute("data-clickable");
    expect(row.className).not.toMatch(/cursor-pointer/);
  });

  it("shows a sentence as the prototype's empty state: a bold line", () => {
    render(
      <Table caption="Cases" columns={[]} rows={[]} rowKey={() => ""} empty="Queue is clear" />,
    );
    expect(screen.getByText("Queue is clear").className).toMatch(/font-bold/);
  });
});

describe("ConfirmDialog error (U-2)", () => {
  it("shows the API's refusal with its amounts formatted, as a live alert", () => {
    render(
      <ConfirmDialog
        open
        title="Approve?"
        description="x"
        confirmLabel="Approve"
        error="₱120000.00 is above your approval limit of ₱100000.00"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole("alert", { hidden: true })).toHaveTextContent(
      "₱120,000.00 is above your approval limit of ₱100,000.00",
    );
  });
});

describe("EmptyState", () => {
  it("says what is missing and, optionally, what to do", () => {
    render(<EmptyState title="Nothing to book" hint="Approved loans appear here." />);
    expect(screen.getByText("Nothing to book")).toBeInTheDocument();
    expect(screen.getByText("Approved loans appear here.")).toBeInTheDocument();
  });
});

describe("one button hierarchy", () => {
  it.each([
    ["primary", /bg-ink-800/],
    ["accent", /bg-ink-800/],
    ["secondary", /border-line-strong/],
    ["danger", /bg-bad-700/],
    ["ghost", /border-transparent/],
  ] as const)("%s has its one look", (variant, look) => {
    expect(buttonClass(variant)).toMatch(look);
  });

  it("danger darkens on hover (white text stays AA), it never lightens", () => {
    expect(buttonClass("danger")).toMatch(/hover:bg-bad-800/);
    expect(buttonClass("danger")).not.toMatch(/hover:bg-bad-500/);
  });

  it("every variant looks disabled the same way, not as a faded copy", () => {
    for (const v of ["primary", "secondary", "danger"] as const) {
      expect(buttonClass(v)).toMatch(/disabled:bg-mist-100/);
      expect(buttonClass(v)).not.toMatch(/disabled:opacity/);
    }
  });

  it("has a small size for row actions and card headers, same height as fields by default", () => {
    render(
      <>
        <Button>Default</Button>
        <Button size="sm">Small</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Default" })).toHaveAttribute("data-size", "md");
    expect(screen.getByRole("button", { name: "Small" })).toHaveAttribute("data-size", "sm");
  });
});

describe("one pill", () => {
  it.each([
    ["ok", /bg-ok-050.*text-ok-700/],
    ["warn", /bg-gold-050.*text-gold-700/],
    ["bad", /bg-bad-050.*text-bad-700/],
    ["info", /bg-info-050.*text-info-700/],
    ["neutral", /bg-mist-100.*text-ink-700/],
  ] as const)("%s: the lightest tint, a 1px inset ring and the 700 text", (tone, look) => {
    render(<Pill tone={tone}>Label</Pill>);
    const pill = screen.getByText("Label");
    expect(pill).toHaveAttribute("data-tone", tone);
    expect(pill.className).toMatch(look);
    expect(pill.className).toMatch(/ring-1 ring-inset/);
  });
});

describe("Callout (the prototype's .trig)", () => {
  it("leads with bold words and keeps the message in the same box", () => {
    render(
      <Callout tone="warn" lead="Referred to human review.">
        Thin bureau file
      </Callout>,
    );
    const lead = screen.getByText("Referred to human review.");
    expect(lead.tagName).toBe("STRONG");
    expect(lead.parentElement).toHaveTextContent("Referred to human review. Thin bureau file");
    expect(lead.parentElement).toHaveAttribute("data-tone", "warn");
  });

  it("is a live alert only when asked", () => {
    const { rerender } = render(<Callout tone="bad">Failed</Callout>);
    expect(screen.queryByRole("alert")).toBeNull();
    rerender(
      <Callout tone="bad" alert>
        Failed
      </Callout>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Failed");
  });
});

describe("KeyValues (the prototype's dl.kv)", () => {
  it("pairs each label with its value inside one wrapper, label first", () => {
    render(<KeyValues items={[{ label: "Approved amount", value: "₱120,000.00" }]} />);
    const label = screen.getByText("Approved amount");
    expect(label.tagName).toBe("DT");
    expect(label.parentElement).toHaveTextContent("Approved amount₱120,000.00");
    expect(label.className).toMatch(/uppercase/);
  });

  it("sets only identifiers in monospace, never amounts", () => {
    render(
      <KeyValues
        items={[
          { label: "Monthly income", value: "₱56,000.00" },
          { label: "Disburse to", value: "WB-SAV-0087-1192", mono: true },
        ]}
      />,
    );
    expect(screen.getByText("₱56,000.00")).not.toHaveAttribute("data-mono");
    expect(screen.getByText("WB-SAV-0087-1192")).toHaveAttribute("data-mono", "true");
  });
});

describe("StageBar (the prototype's .stages)", () => {
  it("draws done grey, current dark ink and what is ahead sunken", () => {
    render(<StageBar status="REVIEW" wasReferred />);
    const steps = screen.getAllByRole("listitem");
    const state = (name: string) =>
      steps.find((s) => s.textContent === name)?.getAttribute("data-state");
    expect(state("Submitted")).toBe("done");
    expect(state("Review")).toBe("current");
    expect(state("Approval")).toBe("todo");
  });

  it("wraps below 860px instead of scrolling, so the current step is never off-screen", () => {
    render(<StageBar status="BOOKING" wasReferred />);
    const bar = screen.getByRole("list", { name: "Case stages" });
    expect(bar).toHaveAttribute("data-layout", "wrap-narrow");
    expect(bar.className).toMatch(/(^| )flex-wrap( |$)/);
    expect(bar.className).toMatch(/min-\[860px\]:flex-nowrap/);
    expect(bar.className).not.toMatch(/overflow-x-auto/);
    expect(bar).not.toHaveAttribute("tabindex");
  });

  it("marks a decline as a red stop", () => {
    render(<StageBar status="DECLINED" wasReferred={false} />);
    const stop = screen.getByText("Declined");
    expect(stop).toHaveAttribute("data-state", "failed");
  });
});

function Push({ message }: { message: string }) {
  const toast = useToast();
  return (
    <button type="button" onClick={() => toast(message, "warn")}>
      push
    </button>
  );
}

describe("toast (the prototype's dark notice)", () => {
  it("is dark with a coloured edge, and formats amounts in its message", async () => {
    render(
      <ToastProvider>
        <Push message="Approved ₱120000.00 over 36 months" />
      </ToastProvider>,
    );
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "push" }));
    });
    const toast = screen.getByRole("status");
    expect(toast).toHaveTextContent("Approved ₱120,000.00 over 36 months");
    expect(toast).toHaveAttribute("data-kind", "warn");
    expect(toast.className).toMatch(/bg-ink-800/);
  });
});
