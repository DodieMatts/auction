import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Reflector } from "@nestjs/core";

import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import type { JwtPayload } from "../types/jwt-payload.type";
import type { AuthenticatedRequest } from "../types/authenticated-request.type";
import { UsersService } from "../../users/users.service";
import { UserStatus } from "../../generated/prisma/enums";

const unauthorizedMessage = "Unauthorized";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly reflector: Reflector,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractBearerToken(request);
    const payload = await this.verifyToken(token);

    if (payload.type !== "access" || !uuidPattern.test(payload.sub)) {
      throw new UnauthorizedException(unauthorizedMessage);
    }

    const user = await this.usersService.findPublicUserById(payload.sub);

    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException(unauthorizedMessage);
    }

    request.user = user;

    return true;
  }

  private extractBearerToken(request: AuthenticatedRequest): string {
    const authorization = request.headers.authorization;

    if (!authorization || Array.isArray(authorization)) {
      throw new UnauthorizedException(unauthorizedMessage);
    }

    const parts = authorization.split(" ");

    if (parts.length !== 2 || parts[0] !== "Bearer" || !parts[1]) {
      throw new UnauthorizedException(unauthorizedMessage);
    }

    return parts[1];
  }

  private async verifyToken(token: string): Promise<JwtPayload> {
    try {
      return await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.configService.getOrThrow<string>("JWT_ACCESS_SECRET"),
        issuer: this.configService.getOrThrow<string>("JWT_ISSUER"),
        audience: this.configService.getOrThrow<string>("JWT_AUDIENCE"),
        algorithms: ["HS256"],
      });
    } catch {
      throw new UnauthorizedException(unauthorizedMessage);
    }
  }
}
