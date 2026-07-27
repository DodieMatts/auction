import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

import type { TestUser } from "./test-users";

export async function loginThroughUi(page: Page, user: TestUser): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(user.role === "ADMIN" ? /\/admin$/ : /\/auctions$/);
}

export async function createAuthenticatedContext(
  browser: Browser,
  user: TestUser,
): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL: "http://localhost:3119",
    locale: "en-US",
    timezoneId: "America/New_York",
    acceptDownloads: true,
  });
  const page = await context.newPage();
  await loginThroughUi(page, user);
  await page.close();
  return context;
}

export async function logoutThroughUi(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
}
