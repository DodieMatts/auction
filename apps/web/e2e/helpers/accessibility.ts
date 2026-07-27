import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export async function expectNoSeriousAccessibilityViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const seriousOrCritical = results.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact ?? ""),
  );
  expect(seriousOrCritical, JSON.stringify(seriousOrCritical, null, 2)).toEqual([]);
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasOverflow).toBe(false);
}
