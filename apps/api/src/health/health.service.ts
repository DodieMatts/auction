import { Injectable, ServiceUnavailableException } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";

type LivenessResponse = {
  status: "ok";
  checks: {
    api: "up";
  };
};

type ReadinessResponse =
  | {
      status: "ok";
      checks: {
        api: "up";
        database: "up";
      };
    }
  | {
      status: "error";
      checks: {
        api: "up";
        database: "down";
      };
    };

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  checkLiveness(): LivenessResponse {
    return {
      status: "ok",
      checks: {
        api: "up",
      },
    };
  }

  async checkReadiness(): Promise<ReadinessResponse> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;

      return {
        status: "ok",
        checks: {
          api: "up",
          database: "up",
        },
      };
    } catch {
      throw new ServiceUnavailableException({
        status: "error",
        checks: {
          api: "up",
          database: "down",
        },
      });
    }
  }
}
