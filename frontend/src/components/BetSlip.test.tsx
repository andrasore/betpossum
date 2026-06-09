import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { makeEvent } from "@/test/fixtures";
import { render, screen } from "@/test/render";

// BetSlip imports placeBet from the api module; stub it so no network is hit.
vi.mock("@/lib/api", () => ({ placeBet: vi.fn() }));

import { BetSlip } from "./BetSlip";

const noop = () => {};

function renderSlip(props: Partial<Parameters<typeof BetSlip>[0]> = {}) {
  return render(
    <BetSlip
      selection={{ event: makeEvent(), choice: "home" }}
      loggedIn={true}
      balance={100}
      onChoiceChange={noop}
      onPlaced={noop}
      onLogin={noop}
      {...props}
    />,
  );
}

describe("BetSlip", () => {
  it("prompts to pick an event when there is no selection", () => {
    renderSlip({ selection: null });
    expect(
      screen.getByText("Click any event to build your bet slip."),
    ).toBeInTheDocument();
  });

  it("shows the sign-in affordance and disables staking when logged out", () => {
    renderSlip({ loggedIn: false });
    expect(screen.getByTestId("betslip-login-button")).toBeInTheDocument();
    expect(screen.queryByTestId("place-bet-button")).not.toBeInTheDocument();
    expect(screen.getByTestId("stake-input")).toBeDisabled();
  });

  it("computes the potential return as stake × odds", async () => {
    renderSlip({
      selection: { event: makeEvent({ homeOdds: 2.5 }), choice: "home" },
    });
    await userEvent.type(screen.getByTestId("stake-input"), "10");
    expect(screen.getByText("£25.00")).toBeInTheDocument();
  });

  it("warns and disables Place Bet when the stake exceeds the balance", async () => {
    renderSlip({ balance: 50 });
    await userEvent.type(screen.getByTestId("stake-input"), "60");
    expect(
      screen.getByText(/Stake exceeds your balance of £50\.00/),
    ).toBeInTheDocument();
    expect(screen.getByTestId("place-bet-button")).toBeDisabled();
  });

  it("offers a Draw segment only when the event has draw odds", () => {
    const { rerender } = renderSlip({
      selection: { event: makeEvent({ drawOdds: 3.0 }), choice: "home" },
    });
    expect(screen.getAllByText("Draw").length).toBeGreaterThan(0);

    rerender(
      <BetSlip
        selection={{ event: makeEvent({ drawOdds: 0 }), choice: "home" }}
        loggedIn={true}
        balance={100}
        onChoiceChange={noop}
        onPlaced={noop}
        onLogin={noop}
      />,
    );
    expect(screen.queryAllByText("Draw")).toHaveLength(0);
  });
});
