import { randomUUID } from "node:crypto";

export const e2ePrefix = "e2e";

export function createNamespace(label: string): string {
  return `${e2ePrefix}-${label}-${randomUUID()}`;
}

export function createEmail(namespace: string, label: string): string {
  return `${namespace}-${label}@example.test`;
}

export function createTitle(namespace: string, label: string): string {
  return `${namespace} ${label}`;
}
