import { Prisma } from "../generated/prisma/client";

type TransactionRunner = {
  $transaction<T>(
    callback: (transaction: Prisma.TransactionClient) => Promise<T>,
    options: { isolationLevel: Prisma.TransactionIsolationLevel },
  ): Promise<T>;
};

const maxAttempts = 3;

export async function serializableTransaction<T>(
  prisma: TransactionRunner,
  callback: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  let attempt = 0;

  while (attempt < maxAttempts) {
    try {
      return await prisma.$transaction(callback, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      attempt += 1;

      if (!isTransactionConflict(error) || attempt >= maxAttempts) {
        throw error;
      }
    }
  }

  throw new Error("Serializable transaction retry failed");
}

function isTransactionConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  if ("code" in error && (error.code === "P2034" || error.code === "40001")) {
    return true;
  }

  if (
    "cause" in error &&
    typeof error.cause === "object" &&
    error.cause !== null &&
    isTransactionConflict(error.cause)
  ) {
    return true;
  }

  if (
    "originalCode" in error &&
    (error.originalCode === "40001" || error.originalCode === "40P01")
  ) {
    return true;
  }

  if ("kind" in error && error.kind === "TransactionWriteConflict") {
    return true;
  }

  if ("originalMessage" in error && typeof error.originalMessage === "string") {
    return isTransactionConflictMessage(error.originalMessage);
  }

  if ("message" in error && typeof error.message === "string") {
    return isTransactionConflictMessage(error.message);
  }

  return false;
}

function isTransactionConflictMessage(message: string): boolean {
  return (
    message.includes("could not serialize access") ||
    message.includes("write conflict") ||
    message.includes("deadlock") ||
    message.includes("TransactionWriteConflict")
  );
}
