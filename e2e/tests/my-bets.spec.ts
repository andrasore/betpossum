import { expect, type Page, test } from "@playwright/test";

async function loginAs(page: Page, username: string): Promise<void> {
  await page.goto("/");
  await page.getByTestId("login-button").click();
  await page.locator("#username").fill(username);
  await page.locator("#password").fill("password");
  await page.locator("#kc-login").click();
}

test("anonymous /my-bets is gated behind sign-in, not broken", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/my-bets");
  await page.waitForURL("**/my-bets");
  // The page renders with a sign-in affordance and no bet table — no redirect
  // loop, no crash.
  await expect(page.getByTestId("mybets-login-button")).toBeVisible();
  await expect(page.locator('[data-testid^="bet-row-"]')).toHaveCount(0);
  await ctx.close();
});

// Bob is the bettor here: he funds himself and places the bet, then a second
// bob session (a separate browser context) resolves the event. Using bob (whom
// no other spec places bets for) keeps this test independent of leftover
// state — alice carries a settled bet from the happy-path spec, so her bet
// counts aren't deterministic across the run.
//
// The resolve happens in a separate session so the bettor page never has to
// leave My Bets to drive settlement. The final "Won" assertion then exercises
// the page's query-on-load path: a fresh visit to My Bets refetches /bets and
// shows the settled row. (The live bet.settled socket push — settling while
// the bettor is already parked on a bets view — is covered by the happy-path
// spec, where alice's dashboard row flips in place.)
//
// This spec covers the cross-service integration: a placed bet shows in the
// dashboard's Recent Bets, deep-links into the My Bets page, and reads "Won"
// after the event resolves. The pure rendering — the 5-row Recent Bets cap, the
// uncapped table, and the odds-join enrichment — is covered by
// RecentBets.test.tsx and BetsTable.test.tsx.
test("a placed bet deep-links from Recent Bets into My Bets and settles to Won", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginAs(page, "bob");
  await page.waitForURL("**/dashboard");

  // Fund bob enough for a £10 bet (the balance is set absolutely).
  await page.getByTestId("admin-link").click();
  await page.waitForURL("**/admin");
  const bobRow = page.locator("tr", { hasText: "admin@example.com" });
  await expect(bobRow).toBeVisible();
  await bobRow.getByRole("spinbutton").fill("100");
  await bobRow.getByRole("button", { name: "Confirm" }).click();
  await expect(bobRow.getByRole("button", { name: "Confirm" })).toBeHidden();

  // Pick a still-resolvable mock event: its home button is enabled only when the
  // event is unresolved and mock-origin. (The happy-path spec already resolved
  // one event, whose buttons are now disabled.)
  await page.getByTestId("admin-events-tab").click();
  const homeButtons = page.locator(
    '[data-testid^="admin-event-resolve-"][data-testid$="-home"]',
  );
  await expect(homeButtons.first()).toBeVisible();
  let eventId: string | undefined;
  for (let i = 0; i < (await homeButtons.count()); i++) {
    const btn = homeButtons.nth(i);
    if (await btn.isEnabled()) {
      const tid = await btn.getAttribute("data-testid");
      eventId = tid?.replace(/^admin-event-resolve-/, "").replace(/-home$/, "");
      break;
    }
  }
  expect(eventId).toBeTruthy();

  // Back to the dashboard (client-side nav keeps the in-memory session) and
  // place one bet on that event — a card click defaults to the 'home' selection.
  await page.getByTestId("dashboard-link").click();
  await page.waitForURL("**/dashboard");
  await expect(page.getByTestId("balance")).toContainText("£100.00");

  const eventCard = page.getByTestId(`event-card-${eventId}`);
  await expect(eventCard).toBeVisible();
  await eventCard.click();
  await page.getByTestId("stake-input").fill("10");
  await page.getByTestId("place-bet-button").click();
  // The held bet drops the available balance by £10 — a reliable completion sync
  // (the bet slip stays mounted off-screen, so it can't signal completion).
  await expect(page.getByTestId("balance")).toContainText("£90.00");

  // The bet shows in the dashboard's Recent Bets sidebar; deep-link through it.
  await expect(
    page.getByRole("heading", { name: "Recent Bets" }),
  ).toBeVisible();
  const recentRow = page.locator('[data-testid^="bet-row-"]').first();
  const recentTestId = await recentRow.getAttribute("data-testid");
  const betId = recentTestId?.replace(/^bet-row-/, "");
  expect(betId).toBeTruthy();
  await recentRow.click();
  await page.waitForURL("**/my-bets**");

  // The deep-linked row landed on the My Bets page, still held.
  await expect(page.getByTestId(`bet-row-${betId}`)).toContainText(/held/i);

  // Resolve the event in bob's favour (home) from a second bob session, so the
  // bettor page never leaves My Bets to drive settlement.
  const adminCtx = await browser.newContext();
  const adminPage = await adminCtx.newPage();
  await loginAs(adminPage, "bob");
  await adminPage.waitForURL("**/dashboard");
  await adminPage.getByTestId("admin-link").click();
  await adminPage.waitForURL("**/admin");
  await adminPage.getByTestId("admin-events-tab").click();
  const resolveButton = adminPage.getByTestId(
    `admin-event-resolve-${eventId}-home`,
  );
  await expect(resolveButton).toBeEnabled();
  await resolveButton.click();
  await expect(
    adminPage.getByTestId(`admin-event-status-${eventId}`),
  ).toHaveText(/resolved \(home\)/i, { timeout: 10_000 });
  await adminCtx.close();

  // A fresh load of My Bets refetches /bets and shows the settled row — the
  // page's normal query-on-load path, independent of the live socket push.
  await page.reload();
  await expect(page.getByTestId(`bet-row-${betId}`)).toContainText(/won/i, {
    timeout: 20_000,
  });

  await ctx.close();
});
