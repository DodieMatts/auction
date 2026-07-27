import { test, expect } from "./fixtures/application-fixture";
import { loginThroughUi } from "./helpers/authentication";
import { createTestAuction } from "./helpers/test-auctions";
import {
  expectNoPersistentBrowserStorage,
  expectPageToExclude,
  expectResponseToExclude,
} from "./helpers/privacy-assertions";

test("authenticated pages and JSON responses do not expose private values", async ({
  page,
  monitorPage,
  adminUser,
  bidderUser,
  namespace,
  database,
}) => {
  await monitorPage(page);
  await loginThroughUi(page, adminUser);
  const auction = await createTestAuction(database, {
    namespace,
    label: "privacy",
    adminId: adminUser.id,
    status: "DRAFT",
  });

  await page.goto(`/admin/auctions/${auction.id}`);
  await expectPageToExclude(page, [
    adminUser.id,
    adminUser.password,
    bidderUser.password,
    "commitmentHash",
    "secret",
  ]);
  await expectNoPersistentBrowserStorage(page);

  const adminJson = await page.request.get(`/api/admin/auctions/${auction.id}`);
  expect(adminJson.status()).toBe(200);
  await expectResponseToExclude(adminJson, [
    adminUser.password,
    bidderUser.password,
    "commitmentHash",
    "secret",
  ]);

  await page.context().clearCookies();
  await loginThroughUi(page, bidderUser);
  await page.goto("/auctions");
  await expectPageToExclude(page, [bidderUser.id, bidderUser.password, adminUser.password]);
  await expectNoPersistentBrowserStorage(page);
});
