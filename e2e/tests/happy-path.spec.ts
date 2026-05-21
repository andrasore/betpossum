import {
  expect,
  type Page,
  request as playwrightRequest,
  test,
} from "@playwright/test";

const GATEWAY_URL = "http://localhost:18080";

async function loginAs(page: Page, username: string): Promise<void> {
  await page.goto("/");
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
  await aliceWarmupCtx.close();

  const bobCtx = await browser.newContext();
  const bobPage = await bobCtx.newPage();
  await loginAs(bobPage, "bob");
  await bobPage.waitForURL("**/admin");

  const aliceRow = bobPage.locator("tr", { hasText: "alice@example.com" });
  await expect(aliceRow).toBeVisible();
  await aliceRow.getByRole("spinbutton").fill("100");
  await aliceRow.getByRole("button", { name: "Confirm" }).click();
  await expect(aliceRow.getByRole("button", { name: "Confirm" })).toBeHidden();

  // Grab bob's admin token before tearing down his context — we use it later
  // to drive event resolution via the admin REST API.
  const bobToken = await bobPage.evaluate(() => localStorage.getItem("token"));
  expect(bobToken, "bob should have a token").toBeTruthy();
  await bobCtx.close();

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

  // Resolve the event in alice's favour via the admin endpoint.
  const apiContext = await playwrightRequest.newContext();
  const resp = await apiContext.post(
    `${GATEWAY_URL}/admin/events/${eventId}/result`,
    {
      headers: {
        Authorization: `Bearer ${bobToken}`,
        "Content-Type": "application/json",
      },
      data: { outcome: "home" },
    },
  );
  expect(resp.status(), await resp.text()).toBe(201);
  await apiContext.dispose();

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
