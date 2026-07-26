import { InternalServerErrorException } from "@nestjs/common";

import type { Prisma } from "../generated/prisma/client";

export async function getDatabaseTime(
  transaction: Prisma.TransactionClient,
): Promise<Date> {
  const rows = await transaction.$queryRaw<Array<{ now: Date }>>`
    SELECT CURRENT_TIMESTAMP AS "now"
  `;
  const databaseNow = rows[0]?.now;

  if (!(databaseNow instanceof Date) || Number.isNaN(databaseNow.getTime())) {
    throw new InternalServerErrorException("Database time unavailable");
  }

  return databaseNow;
}
