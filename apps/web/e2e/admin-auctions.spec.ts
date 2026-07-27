import { randomUUID } from "node:crypto";

import { test, expect } from "./fixtures/application-fixture";
import { loginThroughUi } from "./helpers/authentication";
import { createTestAuction } from "./helpers/test-auctions";
import { moveAuctionToEndedPhase } from "./helpers/phase-control";
import { expectPageToExclude } from "./helpers/privacy-assertions";

test("administrator dashboard, draft lifecycle, cancellation, and settlement", async ({
  page,
  monitorPage,
  adminUser,
  namespace,
  database,
}) => {
  await monitorPage(page);
  await loginThroughUi(page, adminUser);
  await expect(page.getByRole("heading", { name: "Administrator dashboard" })).toBeVisible();
  await expect(page.getByLabel("Current session").getByText(adminUser.email)).toBeVisible();
  await expect(page.getByText("Administrator", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Auctions", exact: true })).toBeVisible();

  const title = `${namespace} browser draft`;
  await page.getByRole("link", { name: "Create auction" }).click();
  await expect(page.getByRole("heading", { name: "Create draft auction" })).toBeVisible();
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Currency").fill("USD");
  await page.getByLabel("Description").fill(`${title} description`);
  await page.getByLabel("Start time").fill(localInputMinutesFromNow(60));
  await page.getByLabel("Reveal time").fill(localInputMinutesFromNow(120));
  await page.getByLabel("End time").fill(localInputMinutesFromNow(180));
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/\/admin\/auctions\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText("○ Draft").first()).toBeVisible();
  await expectPageToExclude(page, ["creationRequestId", "cancellationRequestId"]);

  const editedTitle = `${title} edited`;
  await page.getByLabel("Title").fill(editedTitle);
  await page.getByLabel("Description").fill(`${editedTitle} description`);
  await page.getByLabel("Start time").fill(localInputMinutesFromNow(75));
  await page.getByLabel("Reveal time").fill(localInputMinutesFromNow(135));
  await page.getByLabel("End time").fill(localInputMinutesFromNow(195));
  await page.getByRole("button", { name: "Update draft" }).click();
  await expect(page.getByText("Draft auction updated.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: editedTitle })).toBeVisible();
  await expect(page.getByText(title, { exact: true })).toHaveCount(0);

  const auctionId = page.url().split("/").pop() ?? "";
  const stale = await page.request.patch(`/api/admin/auctions/${auctionId}`, {
    headers: { Origin: "http://localhost:3119" },
    data: {
      expectedVersion: 0,
      title: `${editedTitle} stale`,
    },
  });
  expect(stale.status()).toBe(409);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Auction published.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Published")).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish" })).toHaveCount(0);

  await page.goto("/admin/auctions?status=PUBLISHED");
  await expect(page.getByText(editedTitle)).toBeVisible();

  const cancelAuction = await createTestAuction(database, {
    namespace,
    label: "future cancel",
    adminId: adminUser.id,
    status: "PUBLISHED",
  });
  await page.goto(`/admin/auctions/${cancelAuction.id}`);
  await page.getByLabel("Cancellation reason").fill("E2E cancellation reason");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Auction cancelled.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("× Cancelled").first()).toBeVisible();
  await expect(page.getByText("E2E cancellation reason")).toBeVisible();

  const settleAuction = await createTestAuction(database, {
    namespace,
    label: "ended settlement",
    adminId: adminUser.id,
    status: "PUBLISHED",
  });
  await moveAuctionToEndedPhase(database, settleAuction.id);
  await page.goto(`/admin/auctions/${settleAuction.id}`);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Settle" }).click();
  await expect(page.getByText("Auction settled.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("✓ Settled").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "No winner" })).toBeVisible();

  const retry = await page.request.post(`/api/admin/auctions/${settleAuction.id}/settle`, {
    headers: { Origin: "http://localhost:3119" },
    data: {
      settlementRequestId: randomUUID(),
      expectedVersion: 0,
    },
  });
  expect([200, 409]).toContain(retry.status());
});

function localInputMinutesFromNow(minutes: number): string {
  const date = new Date(Date.now() + minutes * 60_000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
