import { timingSafeEqual } from "node:crypto";

const commitmentHashPattern = /^[0-9a-f]{64}$/;

export function constantTimeCommitmentHashEquals(
  firstHash: string,
  secondHash: string,
): boolean {
  if (
    typeof firstHash !== "string" ||
    typeof secondHash !== "string" ||
    !commitmentHashPattern.test(firstHash) ||
    !commitmentHashPattern.test(secondHash)
  ) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(firstHash, "hex"),
    Buffer.from(secondHash, "hex"),
  );
}
