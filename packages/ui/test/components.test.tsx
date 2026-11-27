import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { vi } from "vitest";
import {
  Avatar,
  Button,
  Checkbox,
  ConfirmDialog,
  Field,
  FormGrid,
  FormStack,
  GRADE_FILL,
  GradeTile,
  ICON_NAMES,
  Icon,
  Input,
  initials,
  OutcomePill,
  SegmentedFilter,
  Select,
  StageBar,
  StagePill,
  Table,
  Textarea,
} from "../src";

describe("Button", () => {
  it("is disabled and says so while busy, so a double click cannot send twice", async () => {
    const onClick = vi.fn();
    render(
      <Button busy onClick={onClick}>
        Approve
      </Button>,
    );
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("Working…");
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

/** A screen that opens a dialog from a button and unmounts it on cancel. */
function FocusHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open it</Button>
      {open && (
        <ConfirmDialog
          open
          title="Sure?"
          description="x"
          confirmLabel="Yes"
          onConfirm={() => {}}
          onCancel={() => setOpen(false)}
        />
      )}
    </>
  );
}

describe("ConfirmDialog", () => {
  it("ignores Escape while a request is in flight, and closes on it otherwise", () => {
    const onCancel = vi.fn();
    const props = {
      open: true,
      title: "Approve?",
      description: "x",
      confirmLabel: "Approve",
      onConfirm: () => {},
      onCancel,
    };
    const { rerender, container } = render(<ConfirmDialog {...props} busy />);
    const dialog = container.querySelector("dialog") as HTMLDialogElement;
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(onCancel).not.toHaveBeenCalled();
    rerender(<ConfirmDialog {...props} busy={false} />);
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("returns focus to the button that opened it when it unmounts", async () => {
    // jsdom has no showModal: stand in for the browser, which moves focus into the dialog.
    const proto = HTMLDialogElement.prototype;
    const original = Object.getOwnPropertyDescriptor(proto, "showModal");
    const showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
      this.tabIndex = -1;
      this.focus();
    });
    Object.defineProperty(proto, "showModal", { configurable: true, value: showModal });
    render(<FocusHarness />);
    const opener = screen.getByRole("button", { name: "Open it" });
    await userEvent.click(opener);
    screen.getByRole("button", { name: "Cancel" }).focus();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(showModal).toHaveBeenCalled();
    expect(opener).toHaveFocus();
    if (original) Object.defineProperty(proto, "showModal", original);
    else Reflect.deleteProperty(proto, "showModal");
  });

  it("states what will happen, shows an inline error, and confirms or cancels", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Approve ₱120,000 over 36 months?"
        description="The counter-offer goes to the borrower."
        confirmLabel="Approve"
        error="This amount is above your approval authority."
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByText("The counter-offer goes to the borrower.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("above your approval authority");
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("renders nothing inside while closed", () => {
    render(
      <ConfirmDialog
        open={false}
        title="Hidden"
        description="x"
        confirmLabel="Go"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByText("Hidden")).not.toBeInTheDocument();
  });
});

describe("Field", () => {
  it("links the label, the hint and the error to the input", () => {
    render(
      <Field label="Amount" hint="₱20,000 to ₱500,000" error="Amount is below the minimum">
        <input />
      </Field>,
    );
    const input = screen.getByLabelText("Amount");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Amount is below the minimum");
  });
});

describe("form controls", () => {
  it("Input, Select and Textarea share one look; inputs and selects share one height", () => {
    render(
      <>
        <Field label="Amount">
          <Input defaultValue="1" />
        </Field>
        <Field label="Reason">
          <Select defaultValue="a">
            <option value="a">A</option>
          </Select>
        </Field>
        <Field label="Note" error="Too short">
          <Textarea defaultValue="x" />
        </Field>
      </>,
    );
    const input = screen.getByLabelText("Amount");
    const select = screen.getByLabelText("Reason");
    const textarea = screen.getByLabelText("Note");
    for (const el of [input, select, textarea]) {
      for (const cls of ["rounded-btn", "border-line", "text-base", "px-3"]) {
        expect(el.className).toContain(cls);
      }
    }
    expect(input.className).toContain("h-11");
    expect(select.className).toContain("h-11");
    expect(textarea.className).toContain("min-h-24");
    expect(textarea).toHaveAttribute("aria-invalid", "true");
    expect(textarea).toHaveAccessibleDescription("Too short");
  });

  it("passes a ref through, so focus can be moved to a control", () => {
    let node: HTMLInputElement | null = null;
    render(
      <Field label="Password">
        <Input
          ref={(el) => {
            node = el;
          }}
          type="password"
        />
      </Field>,
    );
    expect(node).toBe(screen.getByLabelText("Password"));
  });

  it("lays fields out with one gap: side by side in a grid, stacked in a stack", () => {
    const { container } = render(
      <FormStack>
        <FormGrid>
          <span>a</span>
          <span>b</span>
        </FormGrid>
      </FormStack>,
    );
    const stack = container.firstElementChild as HTMLElement;
    const grid = stack.firstElementChild as HTMLElement;
    expect(stack.className).toContain("gap-4");
    expect(grid.className).toContain("gap-4");
    expect(grid.className).toContain("sm:grid-cols-2");
  });
});

describe("status presentation", () => {
  it("uses one wording per stage and outcome", () => {
    render(
      <>
        <StagePill status="PENDING_CHECKER" />
        <OutcomePill outcome="REFER" />
        <OutcomePill outcome={null} />
        <GradeTile grade="C" />
      </>,
    );
    expect(screen.getByText("Awaiting checker")).toBeInTheDocument();
    expect(screen.getByText("Refer")).toBeInTheDocument();
    expect(screen.getByText("Not decided")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Grade C" })).toBeInTheDocument();
  });

  it("marks the current stage, and hides review steps for an auto-decided case", () => {
    const { rerender } = render(<StageBar status="APPROVAL" wasReferred />);
    expect(screen.getByText("Approval")).toHaveAttribute("aria-current", "step");
    rerender(<StageBar status="BOOKING" wasReferred={false} />);
    expect(screen.queryByText("Review")).not.toBeInTheDocument();
    expect(screen.getByText("Booking")).toHaveAttribute("aria-current", "step");
  });
});

describe("Table", () => {
  it("shows the empty state when there are no rows", () => {
    render(
      <Table caption="Cases" columns={[]} rows={[]} rowKey={() => ""} empty="Queue is clear" />,
    );
    expect(screen.getByText("Queue is clear")).toBeInTheDocument();
  });
});

describe("icons, avatars and grade tiles (prototype look)", () => {
  it.each(ICON_NAMES)(
    "the %s icon is a decorative 24px line drawing in the text colour",
    (name) => {
      const { container } = render(<Icon name={name} />);
      const svg = container.querySelector("svg");
      expect(svg).toHaveAttribute("aria-hidden", "true");
      expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
      expect(svg).toHaveAttribute("stroke", "currentColor");
      expect(svg).toHaveAttribute("stroke-width", "1.8");
      expect(svg?.querySelectorAll("path").length).toBeGreaterThan(0);
    },
  );

  it.each([
    ["Joel Reyes", "JR"],
    ["Maria Clara Santos", "MC"],
    ["  leo  ", "L"],
    ["Rina", "R"],
  ])("initials of %j are %s", (name, expected) => {
    expect(initials(name)).toBe(expected);
  });

  it("the avatar shows the initials and is hidden from screen readers", () => {
    const { container } = render(<Avatar name="Paolo Tan" />);
    const avatar = container.firstElementChild;
    expect(avatar).toHaveTextContent("PT");
    expect(avatar).toHaveAttribute("aria-hidden", "true");
    expect(avatar?.className).toMatch(/bg-lav/);
  });

  it.each([
    ["A", "bg-grade-a"],
    ["B", "bg-grade-b"],
    ["C", "bg-grade-c"],
    ["D", "bg-grade-d"],
    ["E", "bg-grade-e"],
  ] as const)("grade %s is a solid %s tile with a white letter", (grade, fill) => {
    render(<GradeTile grade={grade} />);
    const tile = screen.getByRole("img", { name: `Grade ${grade}` });
    expect(tile).toHaveTextContent(grade);
    expect(tile).toHaveClass(fill, "text-white", "rounded-tile");
  });

  it("every grade has a different fill, and a missing grade is a neutral tile", () => {
    expect(new Set(Object.values(GRADE_FILL)).size).toBe(5);
    render(<GradeTile grade={null} />);
    expect(screen.getByRole("img", { name: "No grade" })).toHaveTextContent("—");
  });
});

function Filter({ onChange }: { onChange: (v: string) => void }) {
  const [value, setValue] = useState("ALL");
  return (
    <SegmentedFilter
      label="Filter by stage"
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange(v);
      }}
      options={[
        { value: "ALL", label: "All", count: 4 },
        { value: "REVIEW", label: "In review", count: 3 },
      ]}
    />
  );
}

describe("the segmented stage filter", () => {
  it("is a named group of toggle buttons; the chosen one is pressed", async () => {
    const onChange = vi.fn();
    render(<Filter onChange={onChange} />);
    const group = screen.getByRole("group", { name: "Filter by stage" });
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    const all = screen.getByRole("button", { name: /^All\s*4$/ });
    const review = screen.getByRole("button", { name: /^In review\s*3$/ });
    expect(group).toContainElement(review);
    expect(all).toHaveAttribute("aria-pressed", "true");
    expect(review).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(review);
    expect(onChange).toHaveBeenCalledWith("REVIEW");
    expect(review).toHaveAttribute("aria-pressed", "true");
    expect(all).toHaveAttribute("aria-pressed", "false");
  });
});

describe("Checkbox", () => {
  it("is labelled by its sentence and marks itself invalid only when told to", () => {
    const { rerender } = render(
      <Checkbox label="The applicant consents to a credit bureau check" />,
    );
    const box = screen.getByLabelText("The applicant consents to a credit bureau check");
    expect(box).toHaveAttribute("type", "checkbox");
    expect(box).not.toHaveAttribute("aria-invalid");
    rerender(<Checkbox label="The applicant consents to a credit bureau check" invalid />);
    expect(screen.getByLabelText(/credit bureau check/)).toHaveAttribute("aria-invalid", "true");
  });
});
