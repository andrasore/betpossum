import { describe, expect, it } from "vitest";
import {
  formatCents,
  formatCentsSigned,
  isMoneyInput,
  parseCents,
} from "./money";

describe("isMoneyInput", () => {
  // This gates the money inputs' onChange, so it has to accept every
  // intermediate state of typing a valid amount, not just finished ones.
  it.each(["", "0", "1", "10", "1.", "1.5", "1.50", "0.01", "1234.56"])(
    "accepts %p",
    (value) => {
      expect(isMoneyInput(value)).toBe(true);
    },
  );

  it.each(["0.333333", "1.234", "0.001", "-1", "1e3", "abc", "1.2.3", "1,50"])(
    "rejects %p",
    (value) => {
      expect(isMoneyInput(value)).toBe(false);
    },
  );

  it("rejects each extra decimal as it would be typed", () => {
    // Typing "0.333333" one character at a time: the state only ever advances
    // while isMoneyInput holds, so it stops at "0.33".
    let state = "";
    for (const ch of "0.333333") {
      const next = state + ch;
      if (isMoneyInput(next)) {
        state = next;
      }
    }
    expect(state).toBe("0.33");
  });
});

describe("parseCents", () => {
  it.each([
    ["1.50", 150],
    ["1.5", 150],
    ["1", 100],
    ["0.01", 1],
    ["0", 0],
    ["1234.56", 123456],
    ["0.99", 99],
  ])("converts %p to %p cents", (input, expected) => {
    expect(parseCents(input)).toBe(expected);
  });

  it.each(["", "1.", ".", "0.333333", "abc", "-1"])(
    "returns null for the incomplete or invalid entry %p",
    (input) => {
      expect(parseCents(input)).toBeNull();
    },
  );

  it("always returns an integer, never a float", () => {
    for (const v of ["0.07", "19.99", "100.10", "3.03"]) {
      expect(Number.isInteger(parseCents(v))).toBe(true);
    }
  });
});

describe("formatCents", () => {
  it.each([
    [0, "0.00"],
    [1, "0.01"],
    [150, "1.50"],
    [100, "1.00"],
    [123456, "1234.56"],
    [-150, "-1.50"],
  ])("renders %p as %p", (cents, expected) => {
    expect(formatCents(cents)).toBe(expected);
  });

  it("emits no thousands separator, so a rendered amount stays parseable", () => {
    expect(formatCents(1_000_000_00)).toBe("1000000.00");
  });

  it("round-trips through parseCents", () => {
    for (const cents of [0, 1, 99, 100, 12345, 99999]) {
      expect(parseCents(formatCents(cents))).toBe(cents);
    }
  });
});

describe("formatCentsSigned", () => {
  it("always carries a sign", () => {
    expect(formatCentsSigned(150)).toBe("+1.50");
    expect(formatCentsSigned(0)).toBe("+0.00");
    expect(formatCentsSigned(-150)).toBe("-1.50");
  });
});
