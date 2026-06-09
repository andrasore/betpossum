import { describe, expect, it, vi } from "vitest";
import type { Sport } from "@/lib/schemas";
import { render, screen } from "@/test/render";
import { SportFilterBar } from "./SportFilterBar";

const sports: Sport[] = [
  { slug: "soccer", name: "Soccer" },
  { slug: "basketball", name: "Basketball" },
];

describe("SportFilterBar", () => {
  it("renders nothing when there are no sports", () => {
    render(<SportFilterBar sports={[]} selected={null} onSelect={() => {}} />);
    expect(screen.queryByTestId("sport-filter-bar")).not.toBeInTheDocument();
  });

  it("presses the All chip when nothing is selected", () => {
    render(
      <SportFilterBar sports={sports} selected={null} onSelect={() => {}} />,
    );
    expect(screen.getByTestId("sport-chip-all")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("sport-chip-soccer")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("presses the chip matching the selected slug", () => {
    render(
      <SportFilterBar
        sports={sports}
        selected="basketball"
        onSelect={() => {}}
      />,
    );
    expect(screen.getByTestId("sport-chip-basketball")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("sport-chip-all")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("emits the slug on chip click and null on All", () => {
    const onSelect = vi.fn();
    render(
      <SportFilterBar sports={sports} selected={null} onSelect={onSelect} />,
    );
    screen.getByTestId("sport-chip-soccer").click();
    expect(onSelect).toHaveBeenCalledWith("soccer");
    screen.getByTestId("sport-chip-all").click();
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});
