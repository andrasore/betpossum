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

// Bob is both an admin and the bettor here: he funds himself, places the bets,
// and resolves the event. Using bob (whom no other spec places bets for) keeps
// this test independent of leftover state — alice carries a settled bet from the
// happy-path spec, so her bet counts aren't deterministic across the run.
test("recent bets caps at 5, deep-links into the enriched My Bets table, and settles", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginAs(page, "bob");
  await page.waitForURL("**/dashboard");

  // Fund bob with enough for six £10 bets (the balance is set absolutely).
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

  // Back to the dashboard (client-side nav keeps the in-memory session) and bet
  // six times on that event — every card click defaults to the 'home' selection.
  await page.locator('nav a[href="/dashboard"]').click();
  await page.waitForURL("**/dashboard");
  await expect(page.getByTestId("balance")).toHaveText("Balance: £100.00");

  const eventCard = page.getByTestId(`event-card-${eventId}`);
  await expect(eventCard).toBeVisible();
  for (let i = 0; i < 6; i++) {
    await eventCard.click();
    await page.getByTestId("stake-input").fill("10");
    await page.getByTestId("place-bet-button").click();
    // Each held bet drops the available balance by £10 — a reliable per-bet sync
    // (the bet slip stays mounted off-screen, so it can't signal completion).
    const remaining = (100 - 10 * (i + 1)).toFixed(2);
    await expect(page.getByTestId("balance")).toHaveText(
      `Balance: £${remaining}`,
    );
  }

  // The sidebar section is "Recent Bets" and caps at the 5 most recent, even
  // though bob now has 6 bets.
  await expect(
    page.getByRole("heading", { name: "Recent Bets" }),
  ).toBeVisible();
  await expect(page.locator('[data-testid^="bet-row-"]')).toHaveCount(5);

  // Grab the top (most recent) recent-bet row and click through to deep-link.
  const topRow = page.locator('[data-testid^="bet-row-"]').first();
  const topTestId = await topRow.getAttribute("data-testid");
  const betId = topTestId?.replace(/^bet-row-/, "");
  expect(betId).toBeTruthy();
  await topRow.click();
  await page.waitForURL("**/my-bets**");

  // The page is uncapped: a 6th row exists (nth is 0-based), unlike the sidebar.
  await expect(page.locator('[data-testid^="bet-row-"]').nth(5)).toBeVisible();

  // The deep-linked row is present and ENRICHED from the odds feed: its Teams
  // cell shows a real "home vs away" pairing, not the raw eventId fallback. That
  // join is the whole point — proving it succeeded is the real assertion.
  const tableRow = page.getByTestId(`bet-row-${betId}`);
  await expect(tableRow).toBeVisible();
  await expect(tableRow).toContainText(/\bvs\b/);
  await expect(tableRow).not.toContainText(eventId as string);

  // Resolve the event in bob's favour (home); the held bets settle to "Won".
  await page.getByTestId("admin-link").click();
  await page.waitForURL("**/admin");
  await page.getByTestId("admin-events-tab").click();
  const resolveButton = page.getByTestId(`admin-event-resolve-${eventId}-home`);
  await expect(resolveButton).toBeEnabled();
  await resolveButton.click();
  await expect(page.getByTestId(`admin-event-status-${eventId}`)).toHaveText(
    /resolved \(home\)/i,
    { timeout: 10_000 },
  );

  // Back on the My Bets page the row reads "Won" and, since the resolved event
  // stays in the odds store, is still joined for team names.
  await page.getByTestId("my-bets-link").click();
  await page.waitForURL("**/my-bets");
  const settledRow = page.getByTestId(`bet-row-${betId}`);
  await expect(settledRow).toContainText(/won/i, { timeout: 20_000 });
  await expect(settledRow).toContainText(/\bvs\b/);

  await ctx.close();
});
