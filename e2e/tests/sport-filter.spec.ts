import { expect, test } from "@playwright/test";

// The dashboard sport filter bar, driven anonymously (it's public — no auth, no
// socket). This spec covers the integration boundary only: selecting a chip
// re-hydrates GET /odds?sport=<canonical-slug> on the server and replaces the
// board. The chips' pressed-state bookkeeping is covered by
// SportFilterBar.test.tsx; here we assert on which canonical mock fixtures are
// present rather than on brittle exact counts. The mock provider seeds three
// canonical sports: soccer (epl-*), basketball (nba-*), american_football
// (nfl-*).
const soccerCards = '[data-testid^="event-card-mock:epl-"]';
const basketballCards = '[data-testid^="event-card-mock:nba-"]';
const footballCards = '[data-testid^="event-card-mock:nfl-"]';

test("anonymous visitor filters the dashboard board by canonical sport", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await page.waitForURL("**/dashboard");

  // The bar hydrates from /odds/sports and the board from /odds.
  await expect(page.getByTestId("sport-filter-bar")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator(soccerCards).first()).toBeVisible({
    timeout: 15_000,
  });

  // "All" is the initial state: every seeded sport is on the board.
  await expect(page.locator(basketballCards).first()).toBeVisible();
  await expect(page.locator(footballCards).first()).toBeVisible();

  // Select Soccer → the board narrows to soccer fixtures only; basketball and
  // football cards drop off entirely.
  await page.getByTestId("sport-chip-soccer").click();
  await expect(page.locator(soccerCards).first()).toBeVisible();
  await expect(page.locator(basketballCards)).toHaveCount(0);
  await expect(page.locator(footballCards)).toHaveCount(0);

  // Switching directly to another sport re-hydrates again (soccer drops off,
  // basketball comes back) — not just an additive narrowing of the prior view.
  await page.getByTestId("sport-chip-basketball").click();
  await expect(page.locator(basketballCards).first()).toBeVisible();
  await expect(page.locator(soccerCards)).toHaveCount(0);

  // "All" clears the filter and the full board returns.
  await page.getByTestId("sport-chip-all").click();
  await expect(page.locator(soccerCards).first()).toBeVisible();
  await expect(page.locator(basketballCards).first()).toBeVisible();
  await expect(page.locator(footballCards).first()).toBeVisible();
});
