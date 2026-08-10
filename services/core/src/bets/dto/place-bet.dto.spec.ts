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
      stakeCents: 500,
      ...overrides,
    }),
  ).flatMap((e) => e.property);

describe("PlaceBetDto", () => {
  it("accepts a whole-cent stake", () => {
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

  // There is no `odds` case here on purpose: the client doesn't get to name a
  // price any more. The MIN_ODDS/MAX_ODDS range check moved to
  // `OddsCacheService.priceFor`, which is now the only way a bet gets one.
});
