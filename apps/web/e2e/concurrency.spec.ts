import { test, expect } from "./fixtures/application-fixture";
import { loginThroughUi } from "./helpers/authentication";
import { createTestAuction } from "./helpers/test-auctions";

test("same-origin concurrent draft updates produce one success and one conflict", async ({
  page,
  monitorPage,
  adminUser,
  namespace,
  database,
}) => {
  await monitorPage(page);
  await loginThroughUi(page, adminUser);
  const auction = await createTestAuction(database, {
    namespace,
    label: "concurrent draft",
    adminId: adminUser.id,
    status: "DRAFT",
  });

  const baseBody = {
    expectedVersion: 0,
    currency: "USD",
    startTime: new Date(Date.now() + 60 * 60_000).toISOString(),
    revealTime: new Date(Date.now() + 120 * 60_000).toISOString(),
    endTime: new Date(Date.now() + 180 * 60_000).toISOString(),
  };
  const [first, second] = await Promise.all([
    page.request.patch(`/api/admin/auctions/${auction.id}`, {
      headers: { Origin: "http://localhost:3119" },
      data: { ...baseBody, title: `${auction.title} A` },
    }),
    page.request.patch(`/api/admin/auctions/${auction.id}`, {
      headers: { Origin: "http://localhost:3119" },
      data: { ...baseBody, title: `${auction.title} B` },
    }),
  ]);
  expect([first.status(), second.status()].sort()).toEqual([200, 409]);

  const stored = await database.query<{ version: number; title: string }>(
    `SELECT "version", "title" FROM "Auction" WHERE "id" = $1`,
    [auction.id],
  );
  expect(stored.rows[0].version).toBe(1);
  expect([`${auction.title} A`, `${auction.title} B`]).toContain(stored.rows[0].title);
});
