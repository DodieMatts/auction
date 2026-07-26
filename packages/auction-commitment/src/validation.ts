import {
  BID_SECRET_BASE64URL_LENGTH,
  COMMITMENT_PROTOCOL_VERSION,
} from "./constants";

const canonicalUuidPattern =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
const currencyPattern = /^[A-Z]{3}$/;
const amountCentsPattern = /^[1-9][0-9]*$/;
const secretPattern = /^[A-Za-z0-9_-]{43}$/;
const commitmentHashPattern = /^[0-9a-f]{64}$/;

export function normalizeUuid(value: string, fieldName = "UUID"): string {
  if (typeof value !== "string" || !canonicalUuidPattern.test(value)) {
    throw new Error(`${fieldName} must be a canonical UUID string`);
  }

  return value.toLowerCase();
}

export function normalizeCurrency(value: string): string {
  if (typeof value !== "string") {
    throw new Error("Currency must be a string");
  }

  const normalizedCurrency = value.trim().toUpperCase();

  if (!currencyPattern.test(normalizedCurrency)) {
    throw new Error("Currency must be a three-letter ASCII code");
  }

  return normalizedCurrency;
}

export function validateAmountCents(value: string): string {
  if (typeof value !== "string" || !amountCentsPattern.test(value)) {
    throw new Error("Amount cents must be a positive decimal integer string");
  }

  return value;
}

export function validateSecret(value: string): string {
  if (
    typeof value !== "string" ||
    value.length !== BID_SECRET_BASE64URL_LENGTH ||
    !secretPattern.test(value)
  ) {
    throw new Error("Secret must be a 43-character unpadded base64url string");
  }

  return value;
}

export function validateCommitmentHash(value: string): string {
  if (typeof value !== "string" || !commitmentHashPattern.test(value)) {
    throw new Error("Commitment hash must be 64 lowercase hexadecimal characters");
  }

  return value;
}

export function validateProtocolVersion(value: number): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value !== COMMITMENT_PROTOCOL_VERSION
  ) {
    throw new Error("Unsupported commitment protocol version");
  }

  return value;
}
