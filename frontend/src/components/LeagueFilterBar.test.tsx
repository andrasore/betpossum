import { describe, expect, it, vi } from "vitest";
import type { League } from "@/generated/events";
import { render, screen } from "@/test/render";
import { LeagueFilterBar } from "./LeagueFilterBar";

const leagues: League[] = [
  { id: 1, name: "Premier League", sportSlug: "soccer" },
  { id: 7, name: "NBA", sportSlug: "basketball" },
];

describe("LeagueFilterBar", () => {
  it("renders nothing when there are no leagues", () => {
    render(
      <LeagueFilterBar leagues={[]} selected={null} onSelect={() => {}} />,
    );
    expect(screen.queryByTestId("league-filter-bar")).not.toBeInTheDocument();
  });

  it("presses the chip matching the selected league id", () => {
    render(
      <LeagueFilterBar leagues={leagues} selected={7} onSelect={() => {}} />,
    );
    expect(screen.getByTestId("league-chip-7")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("league-chip-all")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("emits the whole league on click (so the parent can sync the sport)", () => {
    const onSelect = vi.fn();
    render(
      <LeagueFilterBar leagues={leagues} selected={null} onSelect={onSelect} />,
    );
    screen.getByTestId("league-chip-7").click();
    expect(onSelect).toHaveBeenCalledWith(leagues[1]);
  });

  it("emits null on the All chip", () => {
    const onSelect = vi.fn();
    render(
      <LeagueFilterBar leagues={leagues} selected={7} onSelect={onSelect} />,
    );
    screen.getByTestId("league-chip-all").click();
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});
