import { randomUUID } from "node:crypto";

import { ConfigService } from "@nestjs/config";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";

import { UserStatus } from "../generated/prisma/enums";
import { UsersService } from "../users/users.service";
import type { PublicUser } from "../users/types/public-user.type";
import { PasswordService } from "./password.service";
import type { JwtPayload } from "./types/jwt-payload.type";

const invalidCredentialsMessage = "Invalid email or password";

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly passwordService: PasswordService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async login(email: string, password: string) {
    const normalizedEmail = this.normalizeEmail(email);
    const authUser =
      await this.usersService.findCredentialsByEmail(normalizedEmail);

    if (!authUser) {
      await this.passwordService.verifyAgainstDummy(password);
      throw new UnauthorizedException(invalidCredentialsMessage);
    }

    const passwordMatches = await this.passwordService.verify(
      authUser.passwordHash,
      password,
    );

    if (!passwordMatches || authUser.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException(invalidCredentialsMessage);
    }

    const expiresIn = this.configService.getOrThrow<number>(
      "JWT_ACCESS_TTL_SECONDS",
    );
    const payload: JwtPayload = {
      sub: authUser.id,
      type: "access",
      jti: randomUUID(),
    };
    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
      tokenType: "Bearer",
      expiresIn,
      user: {
        id: authUser.id,
        email: authUser.email,
        role: authUser.role,
        status: authUser.status,
      },
    };
  }

  async getCurrentUser(userId: string): Promise<PublicUser> {
    const user = await this.usersService.findPublicUserById(userId);

    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException(invalidCredentialsMessage);
    }

    return user;
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }
}
