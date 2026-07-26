import { Body, Controller, Get, Header, Post } from "@nestjs/common";

import { CurrentUser } from "./decorators/current-user.decorator";
import { Public } from "./decorators/public.decorator";
import { LoginDto } from "./dto/login.dto";
import { AuthService } from "./auth.service";
import type { PublicUser } from "../users/types/public-user.type";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post("login")
  @Header("Cache-Control", "no-store")
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto.email, loginDto.password);
  }

  @Get("me")
  @Header("Cache-Control", "no-store")
  getCurrentUser(@CurrentUser() user: PublicUser) {
    return user;
  }
}
