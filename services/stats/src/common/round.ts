/**
 * Two-decimal rounding that matches Python's `round(x, 2)`.
 *
 * The read model was built in Python, and every percentage it returns went
 * through `round(x, 2)`. Matching it exactly needs two things `Math.round`
 * does not do:
 *
 *  1. **Ties go to even**, not away from zero — `round(0.125, 2)` is `0.12`.
 *  2. The decision is made on the double's *exact* value, not on `x * 100`.
 *     `12.345` is really `12.34500000000000064`, so it rounds **up** to
 *     `12.35`; multiplying by 100 first collapses it to exactly `1234.5` and
 *     would wrongly read as a tie, giving `12.34`.
 *
 * So we expand the value to 20 decimal places (far beyond a double's ~17
 * significant digits at percentage magnitudes, so the expansion is exact here)
 * and compare the tail against a true half.
 *
 * Only percentages use this. Money is integer cents and is never rounded.
 */
export function round2(value: number): number {
  if (!Number.isFinite(value)) {
    return value;
  }
  const negative = value < 0;
  const digits = Math.abs(value).toFixed(20);
  const dot = digits.indexOf(".");
  const kept = Number(digits.slice(0, dot) + digits.slice(dot + 1, dot + 3));
  const tail = digits.slice(dot + 3);
  const half = `5${"0".repeat(tail.length - 1)}`;

  let scaled = kept;
  if (tail > half) {
    scaled += 1;
  } else if (tail === half && kept % 2 !== 0) {
    scaled += 1;
  }
  const rounded = scaled / 100;
  return negative ? -rounded : rounded;
}
