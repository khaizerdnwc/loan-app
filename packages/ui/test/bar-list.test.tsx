import { render, screen, within } from "@testing-library/react";
import { BarList } from "../src";

describe("BarList", () => {
  it("lists each bar with its figure, scaled to the largest value", () => {
    render(
      <BarList
        label="Decision mix"
        bars={[
          { label: "Auto-approve", value: 6, display: "60%", tone: "ok" },
          { label: "Refer", value: 3, display: "30%", tone: "gold" },
          { label: "Auto-decline", value: 0, display: "0%" },
        ]}
      />,
    );
    const items = within(screen.getByRole("list", { name: "Decision mix" })).getAllByRole(
      "listitem",
    );
    expect(items.map((i) => i.textContent)).toEqual([
      "Auto-approve: 60%",
      "Refer: 30%",
      "Auto-decline: 0%",
    ]);
    const fills = items.map(
      (i) => (i.querySelector("[aria-hidden] > span") as HTMLElement).style.width,
    );
    expect(fills).toEqual(["100%", "50%", "0%"]);
  });

  it("a small value above zero still shows a sliver", () => {
    render(
      <BarList
        label="Small"
        bars={[
          { label: "Big", value: 1000 },
          { label: "Tiny", value: 1 },
        ]}
      />,
    );
    const tiny = screen.getAllByRole("listitem")[1] as HTMLElement;
    expect((tiny.querySelector("[aria-hidden] > span") as HTMLElement).style.width).toBe("2%");
  });

  it("draws nothing when every value is zero, and takes an explicit maximum", () => {
    const { rerender } = render(<BarList label="Empty" bars={[{ label: "A", value: 0 }]} />);
    expect(
      (screen.getByRole("listitem").querySelector("[aria-hidden] > span") as HTMLElement).style
        .width,
    ).toBe("0%");
    rerender(<BarList label="Of ten" max={10} bars={[{ label: "A", value: 5 }]} />);
    expect(
      (screen.getByRole("listitem").querySelector("[aria-hidden] > span") as HTMLElement).style
        .width,
    ).toBe("50%");
  });
});
