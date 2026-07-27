const displayAmountPattern = /^(?:[1-9]\d*|0)(?:\.\d{1,2})?$/;

export function parseDisplayAmountToCents(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || !displayAmountPattern.test(trimmed)) {
    throw new Error("Enter a positive amount with up to two decimal places.");
  }
  const [majorPart, rawMinorPart = ""] = trimmed.split(".");
  const major = BigInt(majorPart);
  const minor = BigInt(rawMinorPart.padEnd(2, "0"));
  const cents = major * BigInt(100) + minor;
  if (cents <= BigInt(0)) {
    throw new Error("Enter an amount greater than zero.");
  }
  return cents.toString();
}

export function formatCentsForDisplay(amountCents: string): string {
  const cents = BigInt(amountCents);
  const major = cents / BigInt(100);
  const minor = cents % BigInt(100);
  return `${major.toString()}.${minor.toString().padStart(2, "0")}`;
}
