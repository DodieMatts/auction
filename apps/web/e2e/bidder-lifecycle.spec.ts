import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { type Browser, type BrowserContext, type Page, type Response } from "@playwright/test";

import { test, expect } from "./fixtures/application-fixture";
import { createAuthenticatedContext, loginThroughUi } from "./helpers/authentication";
import { moveAuctionToCommitPhase, moveAuctionToEndedPhase, moveAuctionToRevealPhase } from "./helpers/phase-control";
import { expectPageToExclude, expectResponseToExclude } from "./helpers/privacy-assertions";
import { createTestAuction } from "./helpers/test-auctions";
import { createTestUser, type TestUser } from "./helpers/test-users";
import type { RevealReceipt } from "./helpers/receipt-files";

const forbiddenCommitmentRequestFields = [
  "amount",
  "amountCents",
  "price",
  "secret",
  "salt",
  "bidderId",
];

test("complete bidder commitment, receipt, reveal, settlement, and result workflow", async ({
  browser,
  page,
  monitorPage,
  adminUser,
  bidderUser,
  secondBidderUser,
  database,
  namespace,
}) => {
  await monitorPage(page);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "http://localhost:3119",
  });

  const charlie = await createTestUser(database, namespace, "bidder-charlie", "BIDDER");
  const delta = await createTestUser(database, namespace, "bidder-delta", "BIDDER");
  const echo = await createTestUser(database, namespace, "bidder-echo", "BIDDER");
  const auction = await createTestAuction(database, {
    namespace,
    label: "bidder browser lifecycle",
    adminId: adminUser.id,
    status: "PUBLISHED",
  });

  const commitmentPayloadProblems: string[] = [];
  const commitmentPayloads: Record<string, unknown>[] = [];
  watchCommitmentPayloads(page, commitmentPayloadProblems, commitmentPayloads);

  await loginThroughUi(page, bidderUser);
  await moveAuctionToCommitPhase(database, auction.id);

  await page.goto("/auctions");
  await expect(page.getByRole("heading", { name: "Auctions" })).toBeVisible();
  await expect(page.getByRole("heading", { name: auction.title, exact: true })).toBeVisible();
  await expect(page.getByText("Commit").first()).toBeVisible();
  await page
    .getByRole("article")
    .filter({ hasText: auction.title })
    .getByRole("link", { name: "View auction" })
    .click();
  await expect(page.getByRole("heading", { name: auction.title })).toBeVisible();
  await expect(page.getByText("Schedule and phase")).toBeVisible();
  await expect(page.getByText("Final timing is determined by the auction server.")).toBeVisible();
  await expect(page.getByText("No commitment submitted")).toBeVisible();

  const alphaFirstReceipt = await submitCommitmentThroughUi(page, "125.00");
  expectReceiptShape(alphaFirstReceipt, {
    auctionId: auction.id,
    bidderId: bidderUser.id,
    amountCents: "12500",
    bidVersion: 1,
  });
  expect(recomputeCommitment(alphaFirstReceipt)).toBe(alphaFirstReceipt.commitmentHash);
  await expect(page.getByText(alphaFirstReceipt.secret)).toHaveCount(0);
  await expect(page.getByText(alphaFirstReceipt.commitmentHash)).toHaveCount(0);
  await expect(page.getByText("Commitment active")).toBeVisible();

  const copiedFirstReceipt = await copyReceiptFromPage(page);
  expect(copiedFirstReceipt).toEqual(alphaFirstReceipt);
  await assertNoPersistentReceiptStorage(page);

  const alphaReplacementReceipt = await submitCommitmentThroughUi(page, "175.00", {
    replacement: true,
  });
  expectReceiptShape(alphaReplacementReceipt, {
    auctionId: auction.id,
    bidderId: bidderUser.id,
    amountCents: "17500",
    bidVersion: 2,
  });
  expect(alphaReplacementReceipt.bidVersion).toBeGreaterThan(alphaFirstReceipt.bidVersion);
  expect(alphaReplacementReceipt.commitmentHash).not.toBe(alphaFirstReceipt.commitmentHash);
  expect(alphaReplacementReceipt.secret).not.toBe(alphaFirstReceipt.secret);
  expect(recomputeCommitment(alphaReplacementReceipt)).toBe(alphaReplacementReceipt.commitmentHash);
  await expect(page.getByText(alphaReplacementReceipt.secret)).toHaveCount(0);
  await assertNoPersistentReceiptStorage(page);

  expect(commitmentPayloads).toHaveLength(2);
  expect(commitmentPayloadProblems).toEqual([]);

  const bravo = await createBidderParticipant(browser, monitorPage, secondBidderUser, auction.id, "150.00");
  const charlieContext = await createAuthenticatedContext(browser, charlie);
  const charliePage = await charlieContext.newPage();
  await monitorPage(charliePage);
  watchCommitmentPayloads(charliePage, commitmentPayloadProblems, commitmentPayloads);
  await charliePage.goto(`/auctions/${auction.id}`);
  const charlieReceipt = await submitCommitmentThroughUi(charliePage, "200.00");
  expectReceiptShape(charlieReceipt, {
    auctionId: auction.id,
    bidderId: charlie.id,
    amountCents: "20000",
    bidVersion: 1,
  });

  const echoParticipant = await createBidderParticipant(browser, monitorPage, echo, auction.id, "130.00");

  const deltaContext = await createAuthenticatedContext(browser, delta);
  const deltaPage = await deltaContext.newPage();
  await monitorPage(deltaPage);
  await deltaPage.goto(`/auctions/${auction.id}`);
  await expect(deltaPage.getByText("No commitment submitted")).toBeVisible();

  await moveAuctionToRevealPhase(database, auction.id);
  await page.reload();
  await charliePage.reload();
  await expect(page.getByText("Reveal available")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Import reveal receipt" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Submit commitment" })).toHaveCount(0);

  await pasteReceiptAndValidate(page, alphaFirstReceipt);
  await expect(page.getByText("This receipt is from a bid that was replaced. Use the newest receipt for the active bid.")).toBeVisible();

  for (const field of ["amountCents", "secret", "commitmentHash", "auctionId", "bidderId", "currency"] as const) {
    await pasteReceiptAndValidate(charliePage, alterReceipt(charlieReceipt, field));
    await expect(charliePage.getByText("The receipt does not match this auction.")).toBeVisible();
  }

  const alphaReveal = await revealThroughUi(page, alphaReplacementReceipt);
  await expectRevealResponse(alphaReveal, "17500");
  await expectBrowserResponseToExclude(alphaReveal, [
    alphaReplacementReceipt.secret,
    alphaReplacementReceipt.commitmentHash,
  ]);
  await expect(page.getByText("Bid revealed")).toBeVisible();
  await expect(page.getByText(alphaReplacementReceipt.secret)).toHaveCount(0);
  await expect(page.getByText(alphaReplacementReceipt.commitmentHash)).toHaveCount(0);

  await moveAuctionToRevealPhase(database, auction.id);
  await bravo.page.reload();
  const bravoReveal = await revealThroughUi(bravo.page, bravo.receipt);
  await expectRevealResponse(bravoReveal, "15000");
  await expect(bravo.page.getByText("Bid revealed")).toBeVisible();

  const mismatchedServerSecret = "B".repeat(43);
  const invalidServerReveal = await charliePage.request.post(`/api/auctions/${auction.id}/reveals`, {
    headers: { Origin: "http://localhost:3119" },
    data: {
      clientRequestId: randomUUID(),
      amountCents: charlieReceipt.amountCents,
      secret: mismatchedServerSecret,
      expectedBidVersion: 1,
    },
  });
  expect(invalidServerReveal.status()).toBe(422);
  await expectResponseToExclude(invalidServerReveal, [
    mismatchedServerSecret,
    charlieReceipt.secret,
    charlieReceipt.commitmentHash,
    "computed commitment",
    "expected commitment",
  ]);
  await charliePage.reload();
  await expect(charliePage.getByText("Invalid attempts")).toBeVisible();
  await expect(charliePage.getByText("1").first()).toBeVisible();

  await deltaPage.reload();
  await expect(deltaPage.getByText("No commitment submitted")).toBeVisible();
  await expect(deltaPage.getByRole("heading", { name: "Import reveal receipt" })).toHaveCount(0);

  await moveAuctionToEndedPhase(database, auction.id);
  const adminContext = await createAuthenticatedContext(browser, adminUser);
  const adminPage = await adminContext.newPage();
  await monitorPage(adminPage);
  const adminRequest = adminContext.request;
  const settlement = await adminRequest.post(`/api/admin/auctions/${auction.id}/settle`, {
    headers: { Origin: "http://localhost:3119" },
    data: {
      settlementRequestId: randomUUID(),
      expectedVersion: 0,
    },
  });
  expect(settlement.status()).toBe(200);
  await expectResponseToExclude(settlement, [
    alphaReplacementReceipt.secret,
    bravo.receipt.secret,
    charlieReceipt.secret,
    echoParticipant.receipt.secret,
    alphaReplacementReceipt.commitmentHash,
    bravo.receipt.commitmentHash,
    charlieReceipt.commitmentHash,
    echoParticipant.receipt.commitmentHash,
    "13000",
    "15000",
    "20000",
  ]);
  await adminPage.goto(`/admin/auctions/${auction.id}`);
  await expect(adminPage.getByRole("heading", { name: "Settlement results" })).toBeVisible();
  await expect(adminPage.getByText("Invalid bid reasons")).toBeVisible();
  await expect(adminPage.getByText("This bid was marked invalid because it was not revealed before the reveal period ended.")).toBeVisible();
  await expect(adminPage.getByText("This bid was marked invalid because the submitted receipt did not match the latest commitment.")).toBeVisible();
  await expectPageToExclude(adminPage, [
    alphaReplacementReceipt.secret,
    bravo.receipt.secret,
    charlieReceipt.secret,
    echoParticipant.receipt.secret,
    alphaReplacementReceipt.commitmentHash,
    bravo.receipt.commitmentHash,
    charlieReceipt.commitmentHash,
    echoParticipant.receipt.commitmentHash,
    "13000",
    "15000",
    "20000",
    "COMMITMENT_MISMATCH",
    "NOT_REVEALED",
  ]);

  await assertBidderResult({
    page,
    auctionId: auction.id,
    expectedOutcome: "Won",
    expectedPersonalAmount: "$175.00",
    winningAmount: "$175.00",
    hiddenText: [
      secondBidderUser.email,
      charlie.email,
      delta.email,
      echo.email,
      "$130.00",
      "$150.00",
      "$200.00",
      alphaReplacementReceipt.secret,
      alphaReplacementReceipt.commitmentHash,
    ],
  });
  await assertBidderResult({
    page: bravo.page,
    auctionId: auction.id,
    expectedOutcome: "Lost",
    expectedPersonalAmount: "$150.00",
    winningAmount: "$175.00",
    hiddenText: [
      bidderUser.email,
      charlie.email,
      delta.email,
      echo.email,
      "$130.00",
      "$200.00",
      bravo.receipt.secret,
      bravo.receipt.commitmentHash,
    ],
  });
  await assertBidderResult({
    page: charliePage,
    auctionId: auction.id,
    expectedOutcome: "Invalid",
    expectedPersonalAmount: "Not available",
    winningAmount: "$175.00",
    hiddenText: [
      bidderUser.email,
      secondBidderUser.email,
      delta.email,
      echo.email,
      "$130.00",
      "$150.00",
      "$200.00",
      charlieReceipt.secret,
      charlieReceipt.commitmentHash,
      "COMMITMENT_MISMATCH",
    ],
    invalidReason:
      "This bid was marked invalid because the submitted receipt did not match the latest commitment.",
  });
  await assertBidderResult({
    page: echoParticipant.page,
    auctionId: auction.id,
    expectedOutcome: "Invalid",
    expectedPersonalAmount: "Not available",
    winningAmount: "$175.00",
    hiddenText: [
      bidderUser.email,
      secondBidderUser.email,
      charlie.email,
      delta.email,
      "$150.00",
      "$200.00",
      echoParticipant.receipt.secret,
      echoParticipant.receipt.commitmentHash,
      "NOT_REVEALED",
    ],
    invalidReason:
      "This bid was marked invalid because it was not revealed before the reveal period ended.",
  });
  await assertBidderResult({
    page: deltaPage,
    auctionId: auction.id,
    expectedOutcome: "Not participated",
    expectedPersonalAmount: "Not available",
    winningAmount: "$175.00",
    hiddenText: [
      bidderUser.email,
      secondBidderUser.email,
      charlie.email,
      echo.email,
      "$130.00",
      "$150.00",
      "$200.00",
      alphaReplacementReceipt.secret,
      bravo.receipt.secret,
      charlieReceipt.secret,
    ],
  });

  const exactRetry = await adminRequest.post(`/api/admin/auctions/${auction.id}/settle`, {
    headers: { Origin: "http://localhost:3119" },
    data: {
      settlementRequestId: (await settlement.json()).auction.settlementRequestId ?? randomUUID(),
      expectedVersion: 0,
    },
  });
  expect([200, 409]).toContain(exactRetry.status());

  await expectPageToExclude(page, [
    "clientRequestId",
    "creationRequestId",
    "cancellationRequestId",
    "settlementRequestId",
    "commitmentHash",
    "passwordHash",
  ]);
  await assertNoPersistentReceiptStorage(page);

  await adminContext.close();
  await bravo.context.close();
  await charlieContext.close();
  await deltaContext.close();
  await echoParticipant.context.close();
});

async function createBidderParticipant(
  browser: Browser,
  monitorPage: (page: Page) => Promise<void>,
  user: TestUser,
  auctionId: string,
  amount: string,
): Promise<{ context: BrowserContext; page: Page; receipt: RevealReceipt }> {
  const context = await createAuthenticatedContext(browser, user);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "http://localhost:3119",
  });
  const page = await context.newPage();
  await monitorPage(page);
  await page.goto(`/auctions/${auctionId}`);
  const receipt = await submitCommitmentThroughUi(page, amount);
  return { context, page, receipt };
}

async function submitCommitmentThroughUi(
  page: Page,
  amount: string,
  options: { replacement?: boolean } = {},
): Promise<RevealReceipt> {
  await page.getByLabel("Bid amount").fill(amount);
  if (options.replacement) {
    await expect(page.getByText("You already submitted a bid for this auction. Submitting a new bid will replace your previous bid. Your previous receipt will no longer work, so make sure you save the new receipt.")).toBeVisible();
    await page.getByLabel("I understand this new bid replaces my previous bid and the previous receipt will no longer work.").check();
  }
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/auctions/") &&
      response.url().endsWith("/commitments") &&
      response.request().method() === "POST",
  );
  const buttonName = options.replacement ? "Replace commitment" : "Submit commitment";
  await page.getByRole("button", { name: buttonName }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  await expect(page.getByRole("heading", { name: "Save this receipt now." })).toBeVisible();
  if (options.replacement) {
    await expect(page.getByText("New bid submitted. Save the new receipt; the previous receipt will no longer work.")).toBeVisible();
  }
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download receipt" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  return JSON.parse(await readFile(path as string, "utf8")) as RevealReceipt;
}

async function copyReceiptFromPage(page: Page): Promise<RevealReceipt> {
  await page.getByRole("button", { name: "Copy receipt" }).click();
  await expect(page.getByText("Receipt copied. Store it somewhere secure.")).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  await page.evaluate(() => navigator.clipboard.writeText(""));
  return JSON.parse(copied) as RevealReceipt;
}

async function pasteReceiptAndValidate(page: Page, receipt: RevealReceipt): Promise<void> {
  await page.getByLabel("Receipt JSON").fill(JSON.stringify(receipt, null, 2));
  await page.getByRole("button", { name: "Validate receipt" }).click();
}

async function revealThroughUi(page: Page, receipt: RevealReceipt): Promise<Response> {
  await pasteReceiptAndValidate(page, receipt);
  await expect(page.getByText("Receipt is ready to reveal.")).toBeVisible();
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/auctions/") &&
      response.url().endsWith("/reveals") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Reveal bid" }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  return response;
}

async function assertBidderResult({
  page,
  auctionId,
  expectedOutcome,
  expectedPersonalAmount,
  winningAmount,
  hiddenText,
  invalidReason,
}: {
  page: Page;
  auctionId: string;
  expectedOutcome: string;
  expectedPersonalAmount: string;
  winningAmount: string;
  hiddenText: string[];
  invalidReason?: string;
}) {
  await page.goto(`/auctions/${auctionId}`);
  await expect(page.getByRole("heading", { name: "Final outcome" })).toBeVisible();
  await expect(page.getByText(expectedOutcome).first()).toBeVisible();
  await expect(page.getByText(winningAmount).first()).toBeVisible();
  await expect(page.getByText(expectedPersonalAmount).first()).toBeVisible();
  await expect(page.getByText("Total bids")).toBeVisible();
  await expect(page.getByText("Valid reveals")).toBeVisible();
  await expect(page.getByText("Invalid bids")).toBeVisible();
  if (invalidReason) {
    expect(await page.getByText(invalidReason).count()).toBeGreaterThan(0);
  }
  for (const value of hiddenText) {
    await expect(page.getByText(value)).toHaveCount(0);
  }
}

async function expectBrowserResponseToExclude(response: Response, forbidden: string[]): Promise<void> {
  const body = await response.text();
  for (const value of forbidden) {
    expect(body).not.toContain(value);
  }
}

async function expectRevealResponse(response: Response, amountCents: string): Promise<void> {
  const body = (await response.json()) as {
    reveal?: { amountCents?: unknown };
    bid?: { status?: unknown };
  };
  expect(body.bid?.status).toBe("REVEALED");
  expect(body.reveal?.amountCents).toBe(amountCents);
}

function watchCommitmentPayloads(
  page: Page,
  problems: string[],
  payloads: Record<string, unknown>[],
): void {
  page.on("request", (request) => {
    if (
      !request.url().includes("/api/auctions/") ||
      !request.url().endsWith("/commitments") ||
      request.method() !== "POST"
    ) {
      return;
    }
    const payload = request.postDataJSON() as Record<string, unknown>;
    payloads.push(payload);
    const keys = Object.keys(payload).sort();
    const allowed = ["clientRequestId", "commitmentHash", "expectedBidVersion", "protocolVersion"];
    for (const key of keys) {
      if (!allowed.includes(key)) problems.push(`unexpected commitment field: ${key}`);
    }
    for (const key of forbiddenCommitmentRequestFields) {
      if (key in payload) problems.push(`forbidden commitment field: ${key}`);
    }
  });
}

function expectReceiptShape(
  receipt: RevealReceipt,
  expected: {
    auctionId: string;
    bidderId: string;
    amountCents: string;
    bidVersion: number;
  },
): void {
  expect(receipt.format).toBe("auction-bid-reveal-receipt");
  expect(receipt.receiptVersion).toBe(1);
  expect(receipt.protocolVersion).toBe(1);
  expect(receipt.auctionId).toBe(expected.auctionId);
  expect(receipt.bidderId).toBe(expected.bidderId);
  expect(receipt.currency).toBe("USD");
  expect(receipt.amountCents).toBe(expected.amountCents);
  expect(receipt.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(receipt.commitmentHash).toMatch(/^[0-9a-f]{64}$/);
  expect(receipt.bidId).toMatch(/^[0-9a-f-]{36}$/);
  expect(receipt.bidVersion).toBe(expected.bidVersion);
  expect(Date.parse(receipt.committedAt)).not.toBeNaN();
  expect(Date.parse(receipt.createdAt)).not.toBeNaN();
}

function alterReceipt(receipt: RevealReceipt, field: keyof RevealReceipt): RevealReceipt {
  const altered = { ...receipt };
  if (field === "amountCents") altered.amountCents = "99999";
  if (field === "secret") altered.secret = "C".repeat(43);
  if (field === "commitmentHash") altered.commitmentHash = "a".repeat(64);
  if (field === "auctionId") altered.auctionId = randomUUID();
  if (field === "bidderId") altered.bidderId = randomUUID();
  if (field === "currency") altered.currency = "EUR";
  return altered;
}

function recomputeCommitment(receipt: RevealReceipt): string {
  const payload = JSON.stringify([
    "auction-bid-commitment-v1",
    1,
    receipt.auctionId,
    receipt.bidderId,
    receipt.currency,
    receipt.amountCents,
    receipt.secret,
  ]);
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

async function assertNoPersistentReceiptStorage(page: Page): Promise<void> {
  const storage = await page.evaluate(async () => {
    const indexedDatabaseNames =
      typeof indexedDB.databases === "function"
        ? (await indexedDB.databases()).map((database) => database.name ?? "")
        : [];
    return {
      localStorageLength: localStorage.length,
      sessionStorageLength: sessionStorage.length,
      cookie: document.cookie,
      indexedDatabaseNames,
    };
  });
  expect(storage.localStorageLength).toBe(0);
  expect(storage.sessionStorageLength).toBe(0);
  expect(storage.cookie).not.toContain("auction_session");
  expect(storage.indexedDatabaseNames).toEqual([]);
}
