import { NextRequest, NextResponse } from "next/server";
import { authMode, safeEqual, SESSION_COOKIE, SESSION_MAX_AGE, sessionToken } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, "login", 5); // brute-force protection
  if (limited) return limited;
  if (authMode() !== "locked") return NextResponse.json({ error: "Login is not enabled (OWNER_PASSWORD is not set)." }, { status: 400 });

  const { password } = (await req.json().catch(() => ({}))) as { password?: unknown };
  if (typeof password !== "string" || !safeEqual(password, process.env.OWNER_PASSWORD!)) {
    return NextResponse.json({ error: "Wrong password." }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await sessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:" || (process.env.APP_URL ?? "").startsWith("https://"),
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
