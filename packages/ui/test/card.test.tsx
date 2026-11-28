import { render, screen, within } from "@testing-library/react";
import { Card } from "../src";

describe("Card (a section; a region named by its heading when asked)", () => {
  it("with region set, is a region named by its title, so a screen reader and a test find it by title", () => {
    render(
      <>
        <Card
          region
          title="Messages to the borrower"
          aside={<span>Simulated · email and SMS</span>}
        >
          <p>Body</p>
        </Card>
        <Card region title="Activity history">
          <p>Other</p>
        </Card>
      </>,
    );
    const card = screen.getByRole("region", { name: "Messages to the borrower" });
    expect(within(card).getByText("Simulated · email and SMS")).toBeInTheDocument();
    expect(within(card).getByText("Body")).toBeInTheDocument();
    expect(within(card).queryByText("Other")).toBeNull();
    expect(screen.getByRole("region", { name: "Activity history" })).toBeInTheDocument();
  });

  it("a titled Card without region is not a landmark, and keeps its heading", () => {
    render(
      <Card title="Applicant">
        <p>Body</p>
      </Card>,
    );
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Applicant" })).toBeInTheDocument();
  });

  it("without a title, region set or not, it is a plain section, not an unnamed region", () => {
    render(
      <>
        <Card>
          <p>Body</p>
        </Card>
        <Card region>
          <p>Body</p>
        </Card>
      </>,
    );
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("two regions with the same title are both found, each named by its own heading", () => {
    render(
      <>
        <Card region title="Booking">
          <p>First</p>
        </Card>
        <Card region title="Booking">
          <p>Second</p>
        </Card>
      </>,
    );
    const regions = screen.getAllByRole("region", { name: "Booking" });
    expect(regions).toHaveLength(2);
    const ids = regions.map((r) => r.getAttribute("aria-labelledby"));
    expect(new Set(ids).size).toBe(2);
    regions.forEach((r, i) => {
      expect(r.querySelector("h2")?.id).toBe(ids[i]);
    });
    expect(within(regions[1] as HTMLElement).getByText("Second")).toBeInTheDocument();
  });
});
