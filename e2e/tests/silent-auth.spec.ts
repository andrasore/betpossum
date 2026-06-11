import { expect, type Page, test } from "@playwright/test";

async function loginAs(page: Page, username: string): Promise<void> {
  await page.goto("/");
  await page.getByTestId("login-button").click();
  await page.locator("#username").fill(username);
  await page.locator("#password").fill("password");
  await page.locator("#kc-login").click();
}

test("session survives a reload via silent renew (tokens are memory-only)", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await loginAs(page, "alice");
  await page.waitForURL("**/dashboard");
  await expect(page.getByTestId("logout-button")).toBeVisible({
    timeout: 15_000,
  });

  // Tokens live only in JS memory, so the reload starts with no session. The
  // app must restore it silently (hidden prompt=none iframe) against Keycloak's
  // SSO cookie — without bouncing the user back through the KC login form.
  await page.reload();
  await page.waitForURL("**/dashboard");
  await expect(page.getByTestId("logout-button")).toBeVisible({
    timeout: 15_000,
  });
  // We stayed signed in: the Keycloak login form was never re-rendered.
  await expect(page.locator("#kc-login")).toHaveCount(0);

  await ctx.close();
});
