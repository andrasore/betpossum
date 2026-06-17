import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { SWRConfig } from "swr";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bet, OddsEvent } from "@/types";

// A fake socket that records the handlers the hook registers, so tests can
// fire `bet.settled` payloads at the real settlement logic.
const { fakeSocket } = vi.hoisted(() => {
  const handlers: Record<string, (data: unknown) => void> = {};
  return {
    fakeSocket: {
      handlers,
      on: (event: string, cb: (data: unknown) => void) => {
        handlers[event] = cb;
      },
      off: () => {},
    },
  };
});

// Controllable bets list (what `fetchBets` resolves to) and odds index (what
// `useOddsIndex` returns), so a test can stage the betId -> event join.
const { state } = vi.hoisted(() => ({
  state: {
    bets: [] as Bet[],
    oddsIndex: new Map<string, OddsEvent>(),
  },
}));

vi.mock("@/lib/websocket", () => ({ getSocket: () => fakeSocket }));
vi.mock("@/lib/api", () => ({
  fetchBets: vi.fn(() => Promise.resolve(state.bets)),
}));
vi.mock("./useOddsIndex", () => ({
  useOddsIndex: () => state.oddsIndex,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { toast } from "sonner";
import { useBets } from "./useBets";

// Isolate SWR's cache per render so staged bets don't leak between tests.
function wrapper({ children }: { children: ReactNode }) {
  return createElement(
    SWRConfig,
    { value: { provider: () => new Map() } },
    children,
  );
}

function settle(payload: unknown) {
  act(() => fakeSocket.handlers["bet.settled"]?.(payload));
}

describe("useBets bet.settled toasts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.bets = [];
    state.oddsIndex = new Map();
  });

  it("pops a success toast with the profit on a winning settlement", () => {
    renderHook(() => useBets("token"), { wrapper });
    settle({ betId: "bet-1", won: true, payout: 23.5 });
    expect(toast.success).toHaveBeenCalledWith("Bet won! +£23.50");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("pops an error toast on a losing settlement", () => {
    renderHook(() => useBets("token"), { wrapper });
    settle({ betId: "bet-1", won: false, payout: 0 });
    expect(toast.error).toHaveBeenCalledWith("Bet lost");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("names the competing teams when the bet's event is known", async () => {
    state.bets = [
      {
        id: "bet-1",
        eventId: "evt-1",
        selection: "home",
        odds: 2.5,
        stake: 10,
        payout: null,
        status: "held",
        placedAt: "2026-06-17T00:00:00Z",
      },
    ];
    state.oddsIndex = new Map([
      [
        "evt-1",
        { homeTeamName: "Arsenal", awayTeamName: "Chelsea" } as OddsEvent,
      ],
    ]);

    const { result } = renderHook(() => useBets("token"), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(1));

    settle({ betId: "bet-1", won: true, payout: 15 });
    expect(toast.success).toHaveBeenCalledWith(
      "Bet won! Arsenal vs Chelsea +£15.00",
    );
  });
});
