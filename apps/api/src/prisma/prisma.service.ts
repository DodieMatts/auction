import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma/client";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(configService: ConfigService) {
    const connectionString = configService.getOrThrow<string>("DATABASE_URL");
    const max = configService.getOrThrow<number>("DATABASE_POOL_MAX");
    const connectionTimeoutMillis = configService.getOrThrow<number>(
      "DATABASE_CONNECTION_TIMEOUT_MS",
    );
    const idleTimeoutMillis = configService.getOrThrow<number>(
      "DATABASE_IDLE_TIMEOUT_MS",
    );

    const adapter = new PrismaPg({
      connectionString,
      max,
      connectionTimeoutMillis,
      idleTimeoutMillis,
    });

    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
    await this.$queryRaw`SELECT 1`;
    this.logger.log("Database connection established");
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log("Database connection closed");
  }
}
