// The only place dollars and cents meet. Everything else in the app — state,
// props, API payloads — carries integer cents.

/**
 * Matches a money amount mid-entry, so it can gate an input's `onChange`:
 * accepts "", "1", "1.", "1.5", "1.50" and rejects anything with a third
 * decimal. This is what makes "0.333333" impossible to type or paste.
 */
export const MONEY_INPUT_RE = /^\d*(?:\.\d{0,2})?$/;

export function isMoneyInput(value: string): boolean {
  return MONEY_INPUT_RE.test(value);
}

/**
 * Integer cents for a complete amount, or null when the string is empty, only
 * partially typed ("1."), or not a money amount at all.
 */
export function parseCents(value: string): number | null {
  const trimmed = value.trim();
  if (!isMoneyInput(trimmed) || trimmed === "" || trimmed.endsWith(".")) {
    return null;
  }
  const [whole, fraction = ""] = trimmed.split(".");
  return Number(whole || "0") * 100 + Number(fraction.padEnd(2, "0"));
}

/**
 * "1234.56" — deliberately without thousands separators, so a rendered amount
 * stays machine-parseable (the e2e suite reads the balance back out with a
 * `/\$([\d.]+)/` match). The "$" belongs to the call site.
 */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Always carries a sign, for deltas like net profit: "+12.34" / "-12.34". */
export function formatCentsSigned(cents: number): string {
  return `${cents >= 0 ? "+" : ""}${formatCents(cents)}`;
}
