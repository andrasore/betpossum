import { expect, type Page, test } from "@playwright/test";

test("anonymous visitor sees odds on /dashboard without being redirected", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/dashboard");
  // Dashboard renders for unauthenticated users — no redirect to /login.
  await page.waitForURL("**/dashboard");
  // Public odds endpoint hydrates at least one event card.
  await expect(
    page.locator('[data-testid^="event-card-"]').first(),
  ).toBeVisible({ timeout: 15_000 });
  // Navbar shows the sign-in button, confirming we're not logged in.
  // (The bet slip's logged-out affordances — disabled stake, sign-in button in
  // place of Place Bet — are covered by BetSlip.test.tsx in the frontend.)
  await expect(page.getByTestId("login-button")).toBeVisible();
  await ctx.close();
});

async function loginAs(page: Page, username: string): Promise<void> {
  await page.goto("/");
  await page.getByTestId("login-button").click();
  await page.locator("#username").fill(username);
  await page.locator("#password").fill("password");
  await page.locator("#kc-login").click();
}

test("alice logs in, places a bet, the event resolves, and the bet settles as won", async ({
  browser,
}) => {
  // Alice's DB user row is created lazily on her first authed call (see
  // jwt.strategy.ts), so we have to log her in once before bob can see her in
  // the admin user list.
  const aliceWarmupCtx = await browser.newContext();
  const aliceWarmupPage = await aliceWarmupCtx.newPage();
  await loginAs(aliceWarmupPage, "alice");
  await aliceWarmupPage.waitForURL("**/dashboard");
  // Wait until the client session has resolved (signalled by the account menu
  // appearing). At that point the dashboard hooks have fired their
  // authed requests, which is what creates Alice's row lazily in core.
  await expect(aliceWarmupPage.getByTestId("account-menu")).toBeVisible({
    timeout: 15_000,
  });
  await aliceWarmupCtx.close();

  const bobCtx = await browser.newContext();
  const bobPage = await bobCtx.newPage();
  await loginAs(bobPage, "bob");
  await bobPage.waitForURL("**/dashboard");
  await bobPage.getByTestId("admin-link").click();
  await bobPage.waitForURL("**/admin");

  const aliceRow = bobPage.locator("tr", { hasText: "alice@example.com" });
  await expect(aliceRow).toBeVisible();
  await aliceRow.getByRole("spinbutton").fill("100");
  await aliceRow.getByRole("button", { name: "Confirm" }).click();
  await expect(aliceRow.getByRole("button", { name: "Confirm" })).toBeHidden();

  const aliceCtx = await browser.newContext();
  const alicePage = await aliceCtx.newPage();
  await loginAs(alicePage, "alice");
  await alicePage.waitForURL("**/dashboard");

  const firstCard = alicePage.locator('[data-testid^="event-card-"]').first();
  await expect(firstCard).toBeVisible();

  // Capture the event id from the card's testid so we can resolve it later.
  const cardTestId = await firstCard.getAttribute("data-testid");
  expect(cardTestId).toMatch(/^event-card-/);
  const eventId = cardTestId?.replace(/^event-card-/, "");

  await firstCard.click();

  await alicePage.getByTestId("stake-input").fill("10");
  await alicePage.getByTestId("place-bet-button").click();

  const betRow = alicePage.locator('[data-testid^="bet-row-"]').first();
  await expect(betRow).toBeVisible();
  // Default selection on first click is 'home' — held state visible.
  await expect(betRow).toContainText(/held/i);

  // Started at £100, staked £10 → £90 held until settlement.
  await expect(alicePage.getByTestId("balance")).toHaveText("Balance: £90.00");

  // Resolve the event in alice's favour by clicking the Home button on
  // the row in bob's Events admin tab.
  await bobPage.getByTestId("admin-events-tab").click();
  const resolveButton = bobPage.getByTestId(
    `admin-event-resolve-${eventId}-home`,
  );
  await expect(resolveButton).toBeVisible();
  await resolveButton.click();
  await expect(bobPage.getByTestId(`admin-event-status-${eventId}`)).toHaveText(
    /resolved \(home\)/i,
    { timeout: 10_000 },
  );
  await bobCtx.close();

  // Bet row flips to "Won" via the socket-driven useBets revalidation.
  await expect(betRow).toContainText(/won/i, { timeout: 20_000 });

  // Balance: stake released (back to £100) + profit (stake * (odds - 1)) > £100.
  await expect
    .poll(
      async () => {
        const text = await alicePage.getByTestId("balance").textContent();
        const match = text?.match(/£([\d.]+)/);
        return match ? parseFloat(match[1]) : NaN;
      },
      { timeout: 20_000 },
    )
    .toBeGreaterThan(100);

  await aliceCtx.close();
});
