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
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2034"
  );
}
