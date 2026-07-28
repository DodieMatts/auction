import { test, expect } from "./fixtures/application-fixture";
import { loginThroughUi, logoutThroughUi } from "./helpers/authentication";
import { createTestUser, suspendTestUser } from "./helpers/test-users";
import { expectNoPersistentBrowserStorage } from "./helpers/privacy-assertions";

test("public pages, login, cookies, roles, logout, and suspended access", async ({
  page,
  monitorPage,
  adminUser,
  bidderUser,
  database,
  namespace,
}) => {
  await monitorPage(page);

  await page.goto("/");
  await expect(page.getByText("Auction House").first()).toBeVisible();

  await page.goto("/login");
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();

  await page.getByLabel("Email").fill("unknown@example.test");
  await page.getByLabel("Password").fill("WrongPassword123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("form").getByRole("alert")).toContainText("Sign in failed");
  await expect(page.locator("form").getByRole("alert")).not.toContainText("unknown");

  await loginThroughUi(page, adminUser);
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByLabel("Current session").getByText(adminUser.email)).toBeVisible();
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((cookie) => cookie.name === "auction_session");
  expect(sessionCookie).toBeDefined();
  expect(sessionCookie?.httpOnly).toBe(true);
  expect(sessionCookie?.secure).toBe(true);
  expect(sessionCookie?.sameSite).toBe("Lax");
  expect(sessionCookie?.path).toBe("/");
  await expectNoPersistentBrowserStorage(page);

  await page.goto("/auctions");
  await expect(page).toHaveURL(/\/admin$/);

  await logoutThroughUi(page);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login/);

  await loginThroughUi(page, bidderUser);
  await expect(page).toHaveURL(/\/auctions$/);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/auctions$/);

  const suspendedUser = await createTestUser(database, namespace, "suspended-browser", "BIDDER");
  await page.context().clearCookies();
  await loginThroughUi(page, suspendedUser);
  await suspendTestUser(database, suspendedUser.id);
  await page.goto("/auctions");
  await expect(page).toHaveURL(/\/login/);

  await page.goto("/login?next=https://example.com/");
  await page.getByLabel("Email").fill(adminUser.email);
  await page.getByLabel("Password").fill(adminUser.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin$/);
});

test("invalid session cookies redirect protected pages", async ({ page, monitorPage }) => {
  await monitorPage(page);
  await page.context().addCookies([
    {
      name: "auction_session",
      value: "invalid.jwt.value",
      domain: "localhost",
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login/);
});
