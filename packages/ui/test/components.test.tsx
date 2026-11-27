import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { vi } from "vitest";
import {
  Button,
  ConfirmDialog,
  Field,
  GradeTile,
  OutcomePill,
  StageBar,
  StagePill,
  Table,
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
