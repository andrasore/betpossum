import type { Bet, OddsEvent } from "@/types";
import type { AccentColor } from "./sportColor";

// Shared rendering helpers for a placed bet, used by both the dashboard's
// Recent Bets sidebar and the My Bets page table so the two stay consistent.

export const statusColor: Record<Bet["status"], AccentColor> = {
  won: "green",
  lost: "red",
  pending: "gray",
  held: "yellow",
};

// The team the user backed. When the bet's event is known (joined from the odds
// feed) we show the actual team name; for a draw, or when the event isn't
// available, we fall back to the raw selection word.
export function selectionLabel(bet: Bet, event?: OddsEvent): string {
  if (!event) {
    return bet.selection;
  }
  switch (bet.selection) {
    case "home":
      return event.homeTeamName ?? event.homeTeam;
    case "away":
      return event.awayTeamName ?? event.awayTeam;
    case "draw":
      return "Draw";
  }
}

// Settlement outcome text: the status, plus the profit paid out on a win.
export function betOutcomeLabel(bet: Bet): string {
  if (bet.status === "won" && bet.payout != null) {
    return `Won +£${Number(bet.payout).toFixed(2)}`;
  }
  return bet.status;
}
