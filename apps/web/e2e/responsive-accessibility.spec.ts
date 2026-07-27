import { test, expect } from "./fixtures/application-fixture";
import { expectNoHorizontalOverflow, expectNoSeriousAccessibilityViolations } from "./helpers/accessibility";
import { loginThroughUi } from "./helpers/authentication";
import { createTestAuction } from "./helpers/test-auctions";

const viewports = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
];

test("responsive layouts and automated accessibility checks", async ({
  page,
  monitorPage,
  adminUser,
  bidderUser,
  database,
  namespace,
}) => {
  await monitorPage(page);

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /Sign in/i })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectNoSeriousAccessibilityViolations(page);
  }

  await loginThroughUi(page, adminUser);
  const auction = await createTestAuction(database, {
    namespace,
    label: "responsive detail",
    adminId: adminUser.id,
    status: "DRAFT",
  });

  for (const path of ["/admin", "/admin/auctions", "/admin/auctions/new", `/admin/auctions/${auction.id}`]) {
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto(path);
      await expect(page.locator("main").last()).toBeVisible();
      await expect(page.getByLabel("Current session").getByText(adminUser.email)).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectNoSeriousAccessibilityViolations(page);
    }
  }

  await page.context().clearCookies();
  await loginThroughUi(page, bidderUser);
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/auctions");
    await expect(page.locator("main").last()).toBeVisible();
    await expect(page.getByLabel("Current session").getByText(bidderUser.email)).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectNoSeriousAccessibilityViolations(page);
  }
});

test("status labels include text, not color alone", async ({ page, adminUser, monitorPage }) => {
  await monitorPage(page);
  await loginThroughUi(page, adminUser);
  await expect(page.getByText("Active")).toBeVisible();
  await expect(page.getByText("Administrator", { exact: true }).first()).toBeVisible();
});
