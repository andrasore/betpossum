import { describe, expect, it } from "vitest";
import { makeEvent } from "@/test/fixtures";
import { render, screen } from "@/test/render";
import { OddsBoard } from "./OddsBoard";

const open = makeEvent({ eventId: "mock:epl-1" });
const concluded = makeEvent({
  eventId: "mock:epl-2",
  outcome: "home",
  resolvedAt: 1_700_000_100_000,
});

describe("OddsBoard", () => {
  it("hides concluded events when the toggle is off", () => {
    render(
      <OddsBoard
        events={[open, concluded]}
        selectedEventId={null}
        onToggle={() => {}}
        isLoading={false}
        showConcluded={false}
      />,
    );
    expect(screen.getByTestId("event-card-mock:epl-1")).toBeInTheDocument();
    expect(
      screen.queryByTestId("event-card-mock:epl-2"),
    ).not.toBeInTheDocument();
  });

  it("shows concluded events, inert and last, when the toggle is on", () => {
    render(
      <OddsBoard
        // Concluded first, so the ordering assertion can't pass by accident.
        events={[concluded, open]}
        selectedEventId={null}
        onToggle={() => {}}
        isLoading={false}
        showConcluded={true}
      />,
    );
    const cards = screen.getAllByTestId(/^event-card-/);
    expect(cards.map((c) => c.dataset.testid)).toEqual([
      "event-card-mock:epl-1",
      "event-card-mock:epl-2",
    ]);
    expect(screen.getByTestId("event-card-mock:epl-2")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("spins while loading with nothing left to show after filtering", () => {
    render(
      <OddsBoard
        events={[concluded]}
        selectedEventId={null}
        onToggle={() => {}}
        isLoading={true}
        showConcluded={false}
      />,
    );
    expect(screen.getByLabelText("Loading live odds")).toBeInTheDocument();
  });
});
