import { NextResponse } from "next/server";

export async function POST(req) {
  const adminPassword = process.env.ADMIN_PASSWORD;
  const cookieName = process.env.ADMIN_COOKIE_NAME || "admin_session";
  if (!adminPassword) {
    return NextResponse.json({ success: false, message: "ADMIN_PASSWORD not set" }, { status: 500 });
  }

  const form = await req.formData();
  const password = form.get("password");
  const next = form.get("next") || "/admin";

  if (password !== adminPassword) {
    const resp = NextResponse.redirect(new URL(`/admin/login?error=1&next=${encodeURIComponent(next)}`, req.url));
    return resp;
  }

  const resp = NextResponse.redirect(new URL(next, req.url));
  resp.cookies.set(cookieName, adminPassword, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return resp;
}
