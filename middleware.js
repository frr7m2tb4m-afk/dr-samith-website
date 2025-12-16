import { NextResponse } from "next/server";

export function middleware(request) {
  const { pathname } = request.nextUrl;
  const adminPassword = process.env.ADMIN_PASSWORD;
  const cookieName = process.env.ADMIN_COOKIE_NAME || "admin_session";

  // Allow login page and static assets
  if (!pathname.startsWith("/admin")) return NextResponse.next();
  if (pathname.startsWith("/admin/login")) return NextResponse.next();

  const session = request.cookies.get(cookieName)?.value;
  if (adminPassword && session === adminPassword) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/admin/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/admin/:path*"],
};
