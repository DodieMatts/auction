import { Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";
import type { AuthUser } from "./types/auth-user.type";
import type { PublicUser } from "./types/public-user.type";

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findCredentialsByEmail(email: string): Promise<AuthUser | null> {
    return this.prisma.user.findUnique({
      where: {
        email: this.normalizeEmail(email),
      },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        role: true,
        status: true,
      },
    });
  }

  async findPublicUserById(id: string): Promise<PublicUser | null> {
    return this.prisma.user.findUnique({
      where: {
        id,
      },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }
}
