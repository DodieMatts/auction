import { createHash } from "node:crypto";
import {
  BID_SECRET_BASE64URL_LENGTH,
  canonicalizeBidCommitmentV1,
  computeBidCommitmentV1,
  generateBidSecretV1,
  validateAmountCents,
  validateCommitmentHash,
  validateProtocolVersion,
  validateSecret,
} from "../dist/index.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectThrows(fn, message) {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(message);
}

const payload = {
  auctionId: "11111111-1111-4111-8111-111111111111",
  bidderId: "22222222-2222-4222-8222-222222222222",
  currency: " usd ",
  amountCents: "12500",
  secret: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi_jklmnop",
};

const expectedCanonical =
  '["auction-bid-commitment-v1",1,"11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222","USD","12500","ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi_jklmnop"]';
const expectedHash =
  "fcc6de5f47975bc6a04cde64a7b93d23c229d97553d385828d0e3c3d5fa398c2";

const canonical = canonicalizeBidCommitmentV1(payload);
assert(canonical === expectedCanonical, "canonical payload changed");

const independentHash = createHash("sha256").update(canonical, "utf8").digest("hex");
assert(independentHash === expectedHash, "independent expected hash changed");

const computedHash = await computeBidCommitmentV1(payload);
assert(computedHash === expectedHash, "computed commitment hash changed");
assert(/^[0-9a-f]{64}$/.test(computedHash), "commitment hash format invalid");

assert(
  canonicalizeBidCommitmentV1({
    ...payload,
    auctionId: payload.auctionId.toUpperCase(),
    bidderId: payload.bidderId.toUpperCase(),
    currency: "usd",
  }) === expectedCanonical,
  "UUID or currency normalization changed",
);

const secretA = generateBidSecretV1();
const secretB = generateBidSecretV1();
assert(secretA.length === BID_SECRET_BASE64URL_LENGTH, "generated secret length invalid");
assert(secretB.length === BID_SECRET_BASE64URL_LENGTH, "generated secret length invalid");
assert(/^[A-Za-z0-9_-]{43}$/.test(secretA), "generated secret format invalid");
assert(secretA !== secretB, "generated secrets repeated");

for (const invalidAmount of ["0", "01", "12.50", "+100", "1e3", "-100"]) {
  expectThrows(
    () => validateAmountCents(invalidAmount),
    `invalid amount ${invalidAmount} was accepted`,
  );
}

for (const invalidSecret of [
  "short",
  `${payload.secret}=`,
  `${payload.secret.slice(0, 42)} `,
  `${payload.secret.slice(0, 42)}+`,
]) {
  expectThrows(() => validateSecret(invalidSecret), "invalid secret was accepted");
}

expectThrows(() => validateProtocolVersion(2), "unsupported version was accepted");
expectThrows(
  () => validateCommitmentHash(expectedHash.toUpperCase()),
  "uppercase commitment hash was accepted",
);

console.log("ok - commitment protocol verification passed");
