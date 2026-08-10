// Bots carry money as integer cents, matching the API. This is display only.

/** 12345 -> "123.45". The "$" belongs to the call site. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
