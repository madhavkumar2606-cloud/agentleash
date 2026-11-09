// Protects the owner's dashboard (/app), rules, approvals and agent runs.
// Public on purpose: the landing page (/), /login, /api/login, PayPal return/cancel (verified by order token),
// /api/firewall/check (has its own API key), and /mock-paypal (disabled in sandbox mode).

import { NextRequest, NextResponse } from "next/server";
import { authMode, isValidSession, SESSION_COOKIE } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  const mode = authMode();
  if (mode === "open") return NextResponse.next();

  const isApi = req.nextUrl.pathname.startsWith("/api/");
  if (mode === "misconfigured") {
    const msg = "AgentLeash is deployed without OWNER_PASSWORD. Set it in your hosting environment variables.";
    return isApi
      ? NextResponse.json({ error: msg }, { status: 503 })
      : new NextResponse(msg, { status: 503, headers: { "Content-Type": "text/plain" } });
  }

  if (await isValidSession(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();

  if (isApi) return NextResponse.json({ error: "Log in as the owner first." }, { status: 401 });
  const login = req.nextUrl.clone();
  login.pathname = "/login";
  login.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/app", "/app/:path*", "/approve/:path*", "/api/state", "/api/mandate", "/api/reset", "/api/agent/:path*", "/api/decisions/:path*"],
};
