import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/lib/websocket", () => ({ getSocket: () => fakeSocket }));
vi.mock("@/lib/api", () => ({ fetchBets: vi.fn(() => Promise.resolve([])) }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { toast } from "sonner";
import { useBets } from "./useBets";

function settle(payload: unknown) {
  act(() => fakeSocket.handlers["bet.settled"]?.(payload));
}

describe("useBets bet.settled toasts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pops a success toast with the profit on a winning settlement", () => {
    renderHook(() => useBets("token"));
    settle({ betId: "bet-1", won: true, payout: 23.5 });
    expect(toast.success).toHaveBeenCalledWith("Bet won! +£23.50");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("pops an error toast on a losing settlement", () => {
    renderHook(() => useBets("token"));
    settle({ betId: "bet-1", won: false, payout: 0 });
    expect(toast.error).toHaveBeenCalledWith("Bet lost");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("ignores a malformed settlement payload without toasting", () => {
    renderHook(() => useBets("token"));
    settle({ betId: "bet-1" });
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });
});
