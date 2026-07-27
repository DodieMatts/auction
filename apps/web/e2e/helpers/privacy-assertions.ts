import { expect, type APIResponse, type Page } from "@playwright/test";

export const forbiddenPrivacyTerms = [
  "passwordHash",
  "DATABASE_URL",
  "JWT_ACCESS_SECRET",
  "PrismaClientKnownRequestError",
  "stack",
  "creationRequestId",
  "cancellationRequestId",
  "settlementRequestId",
];

export async function expectPageToExclude(page: Page, values: string[]): Promise<void> {
  const html = await page.locator("body").innerText();
  for (const value of [...forbiddenPrivacyTerms, ...values]) {
    if (value) expect(html).not.toContain(value);
  }
}

export async function expectResponseToExclude(
  response: APIResponse,
  values: string[],
): Promise<void> {
  const text = await response.text();
  for (const value of [...forbiddenPrivacyTerms, ...values]) {
    if (value) expect(text).not.toContain(value);
  }
}

export async function expectNoPersistentBrowserStorage(page: Page): Promise<void> {
  const storage = await page.evaluate(async () => {
    const indexedDbNames =
      "databases" in indexedDB ? await indexedDB.databases() : [];
    return {
      localStorageLength: localStorage.length,
      sessionStorageLength: sessionStorage.length,
      cookie: document.cookie,
      indexedDbCount: indexedDbNames.length,
    };
  });
  expect(storage.localStorageLength).toBe(0);
  expect(storage.sessionStorageLength).toBe(0);
  expect(storage.cookie).not.toContain("auction_session");
  expect(storage.indexedDbCount).toBe(0);
}
