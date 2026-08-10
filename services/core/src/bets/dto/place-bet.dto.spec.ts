import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { MAX_STAKE_CENTS } from "../../common/money";
import { PlaceBetDto } from "./place-bet.dto";

// The DTO is the only thing standing between a non-browser caller and the
// ledger — the UI's keystroke filter does not apply to curl. Everything here
// goes through class-validator exactly as the global ValidationPipe would.
const errorsFor = (overrides: Partial<Record<keyof PlaceBetDto, unknown>>) =>
  validateSync(
    plainToInstance(PlaceBetDto, {
      eventId: "evt-1",
      selection: "home",
      odds: 2,
      stakeCents: 500,
      ...overrides,
    }),
  ).flatMap((e) => e.property);

describe("PlaceBetDto", () => {
  it("accepts a whole-cent stake at sane odds", () => {
    expect(errorsFor({})).toEqual([]);
  });

  describe("stakeCents", () => {
    it.each([0.004, 5.005, 0.5])(
      "rejects the fractional stake %p",
      (stakeCents) => {
        expect(errorsFor({ stakeCents })).toContain("stakeCents");
      },
    );

    it("rejects a zero stake, which would place a bet for free", () => {
      expect(errorsFor({ stakeCents: 0 })).toContain("stakeCents");
    });

    it("rejects a negative stake", () => {
      expect(errorsFor({ stakeCents: -100 })).toContain("stakeCents");
    });

    it("rejects a stake past the cap that keeps products in range", () => {
      expect(errorsFor({ stakeCents: MAX_STAKE_CENTS + 1 })).toContain(
        "stakeCents",
      );
    });

    it("accepts the smallest bettable amount, one cent", () => {
      expect(errorsFor({ stakeCents: 1 })).toEqual([]);
    });
  });

  describe("odds", () => {
    // Decimal odds are a payout multiplier, so profit is stake * (odds - 1).
    // At 1.0 a win pays nothing; below 1.0 the profit is negative.
    it.each([1, 0.5, 0, -2])("rejects the non-multiplier odds %p", (odds) => {
      expect(errorsFor({ odds })).toContain("odds");
    });

    it("rejects implausibly large odds", () => {
      expect(errorsFor({ odds: 100_000 })).toContain("odds");
    });

    it("accepts fractional odds above 1", () => {
      expect(errorsFor({ odds: 1.01 })).toEqual([]);
      expect(errorsFor({ odds: 3.35 })).toEqual([]);
    });
  });
});
