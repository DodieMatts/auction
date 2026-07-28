import { test as base, expect, type Page } from "@playwright/test";

import {
  cleanupTestNamespace,
  createDatabaseClient,
  type DatabaseClient,
} from "../helpers/database";
import { createNamespace } from "../helpers/test-identifiers";
import { createTestUser, type TestUser } from "../helpers/test-users";

type ApplicationFixtures = {
  monitorPage: (page: Page) => Promise<void>;
};

type ApplicationWorkerFixtures = {
  namespace: string;
  database: DatabaseClient;
  adminUser: TestUser;
  bidderUser: TestUser;
  secondBidderUser: TestUser;
};

type MonitoredPage = {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  blockedRequests: string[];
};

export const test = base.extend<ApplicationFixtures, ApplicationWorkerFixtures>({
  namespace: [
    async ({}, run) => {
      await run(process.env.E2E_NAMESPACE ?? createNamespace("playwright"));
    },
    { scope: "worker" },
  ],
  database: [
    async ({ namespace }, run) => {
      const client = await createDatabaseClient();
      await cleanupTestNamespace(client, namespace);
      await run(client);
      await cleanupTestNamespace(client, namespace);
      await client.end();
    },
    { scope: "worker" },
  ],
  adminUser: [
    async ({ database, namespace }, run) => {
      await run(await createTestUser(database, namespace, "admin", "ADMIN"));
    },
    { scope: "worker" },
  ],
  bidderUser: [
    async ({ database, namespace }, run) => {
      await run(await createTestUser(database, namespace, "bidder-alpha", "BIDDER"));
    },
    { scope: "worker" },
  ],
  secondBidderUser: [
    async ({ database, namespace }, run) => {
      await run(await createTestUser(database, namespace, "bidder-bravo", "BIDDER"));
    },
    { scope: "worker" },
  ],
  monitorPage: async ({}, run) => {
    const monitoredPages = new Map<Page, MonitoredPage>();

    await run(async (page) => {
      const state: MonitoredPage = {
        consoleErrors: [],
        pageErrors: [],
        failedRequests: [],
        blockedRequests: [],
      };
      monitoredPages.set(page, state);

      page.on("console", (message) => {
        if (
          message.type() === "error" &&
          !/^Failed to load resource: the server responded with a status of (401|403|404|409|422)/.test(
            message.text(),
          )
        ) {
          state.consoleErrors.push(message.text());
        }
      });
      page.on("pageerror", (error) => state.pageErrors.push(error.message));
      page.on("requestfailed", (request) => {
        const url = new URL(request.url());
        const failure = request.failure();
        if (
          url.hostname === "localhost" &&
          failure?.errorText !== "net::ERR_ABORTED"
        ) {
          state.failedRequests.push(request.url());
        }
      });
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.port === "3120") {
          state.blockedRequests.push(request.url());
        }
      });
    });

    for (const state of monitoredPages.values()) {
      expect(state.consoleErrors, "unexpected console.error output").toEqual([]);
      expect(state.pageErrors, "unexpected page errors").toEqual([]);
      expect(state.failedRequests, "unexpected failed requests").toEqual([]);
      expect(state.blockedRequests, "unexpected external or direct backend browser requests").toEqual([]);
    }
  },
});

export { expect };
