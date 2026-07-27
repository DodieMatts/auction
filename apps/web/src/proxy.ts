import { NextResponse, type NextRequest } from "next/server";

import { AUTH_COOKIE_NAME, LOGIN_PATH } from "@/lib/auth/auth-constants";

export function proxy(request: NextRequest) {
  if (request.cookies.has(AUTH_COOKIE_NAME)) {
    return NextResponse.next();
  }

  const loginUrl = new URL(LOGIN_PATH, request.url);
  loginUrl.searchParams.set(
    "next",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/admin/:path*", "/auctions/:path*"],
};
