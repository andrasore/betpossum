import { expect, test } from "@playwright/test";

// The dashboard league filter bar, driven anonymously (public — no auth, no
// socket). It sits under the sport bar. This spec covers the integration
// boundary: selecting a league re-hydrates GET /odds/events?sport=<slug>&league=<id>
// server-side, and switching the sport re-scopes the league bar to that sport's
// leagues (a server fetch). The pure client auto-sync of the chips' pressed
// state is covered by useDashboardFilters.test.ts.
//
// League ids are autoincrement (not deterministic), so we locate league chips
// by their visible text. The mock provider seeds three canonical leagues:
// Premier League (soccer, epl-*), NBA (basketball, nba-*), NFL
// (american_football, nfl-*).
const soccerCards = '[data-testid^="event-card-mock:epl-"]';
const basketballCards = '[data-testid^="event-card-mock:nba-"]';
const footballCards = '[data-testid^="event-card-mock:nfl-"]';

test("anonymous visitor filters by league and the sport bar auto-syncs", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await page.waitForURL("**/dashboard");

  // The bar hydrates from /odds/leagues and the board from /odds/events.
  await expect(page.getByTestId("league-filter-bar")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator(soccerCards).first()).toBeVisible({
    timeout: 15_000,
  });

  // "All" sports initially: every seeded league has a chip.
  const nbaChip = page.getByRole("button", { name: "NBA", exact: true });
  await expect(nbaChip).toBeVisible();
  await expect(
    page.getByRole("button", { name: "NFL", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Premier League", exact: true }),
  ).toBeVisible();

  // Select NBA → the board narrows to basketball fixtures only; soccer and
  // football cards drop off entirely.
  await nbaChip.click();
  await expect(page.locator(basketballCards).first()).toBeVisible();
  await expect(page.locator(soccerCards)).toHaveCount(0);
  await expect(page.locator(footballCards)).toHaveCount(0);

  // Changing the sport re-scopes the league bar to the new sport's leagues
  // (Premier League for soccer) — a server-side fetch — and re-hydrates the
  // board to soccer fixtures.
  await page.getByTestId("sport-chip-soccer").click();
  await expect(
    page.getByRole("button", { name: "Premier League", exact: true }),
  ).toBeVisible();
  await expect(page.locator(soccerCards).first()).toBeVisible();
  await expect(page.locator(basketballCards)).toHaveCount(0);
});
