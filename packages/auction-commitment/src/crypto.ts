import { BID_SECRET_BYTE_LENGTH } from "./constants";
import { canonicalizeBidCommitmentV1 } from "./canonicalize";
import type { BidCommitmentPayloadV1 } from "./types";

const base64UrlAlphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function bytesToBase64Url(bytes: Uint8Array): string {
  let output = "";

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const hasSecond = index + 1 < bytes.length;
    const hasThird = index + 2 < bytes.length;
    const value =
      (first << 16) | ((hasSecond ? second : 0) << 8) | (hasThird ? third : 0);

    output += base64UrlAlphabet[(value >> 18) & 63];
    output += base64UrlAlphabet[(value >> 12) & 63];
    if (hasSecond) output += base64UrlAlphabet[(value >> 6) & 63];
    if (hasThird) output += base64UrlAlphabet[value & 63];
  }

  return output;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function getCrypto(): Crypto {
  if (!globalThis.crypto?.getRandomValues || !globalThis.crypto?.subtle) {
    throw new Error("Web Crypto API is unavailable");
  }

  return globalThis.crypto;
}

export function generateBidSecretV1(): string {
  const bytes = new Uint8Array(BID_SECRET_BYTE_LENGTH);
  getCrypto().getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export async function computeBidCommitmentV1(
  payload: BidCommitmentPayloadV1,
): Promise<string> {
  const canonicalPayload = canonicalizeBidCommitmentV1(payload);
  const data = new TextEncoder().encode(canonicalPayload);
  const digest = await getCrypto().subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(digest));
}
