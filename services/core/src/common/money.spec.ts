import { profitCents } from "./money";

// profitCents is the only place a money value is rounded anywhere in the
// system, so its rule has to be pinned: half-up, never negative, integers out.
describe("profitCents", () => {
  it("returns whole cents for an exact multiplier", () => {
    expect(profitCents(1000, 3)).toBe(2000);
    expect(profitCents(500, 2)).toBe(500);
  });

  it("rounds a half-cent up rather than to even", () => {
    // 333 * 0.5 = 166.5 — Python's round() would give 166 here, which is
    // exactly the divergence that let Core and Stats disagree.
    expect(profitCents(333, 1.5)).toBe(167);
    expect(profitCents(1, 1.5)).toBe(1); // 0.5 -> 1
    expect(profitCents(10, 3.35)).toBe(24); // 23.5 -> 24
  });

  it("absorbs float noise in the multiplication", () => {
    // These products land just off a whole cent in IEEE-754 — 70 * 0.1 is
    // 7.000000000000006, 2000 * 0.07 is 140.0000000000001 — and must not leak
    // that dust into the ledger.
    expect(profitCents(70, 1.1)).toBe(7);
    expect(profitCents(2000, 1.07)).toBe(140);
    expect(Number.isInteger(profitCents(4210, 1.0303))).toBe(true);
  });

  it("floors at zero so a bad multiplier can never produce a negative payout", () => {
    expect(profitCents(1000, 0.5)).toBe(0);
    expect(profitCents(1000, 1)).toBe(0);
  });
});
