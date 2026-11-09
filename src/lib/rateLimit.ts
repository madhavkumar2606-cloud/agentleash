// Simple fixed-window rate limiter, per client IP and bucket. In-memory: fine for a single
// instance (the hackathon deployment); use Redis or similar if you run several instances.

import { NextRequest, NextResponse } from "next/server";

const hits = new Map<string, { count: number; resetAt: number }>();

export function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}

/** Returns a 429 response if this client is over the limit, otherwise null. */
export function rateLimit(req: NextRequest, bucket: string, max: number, windowMs = 60_000): NextResponse | null {
  const now = Date.now();
  const key = `${bucket}:${clientIp(req)}`;
  const entry = hits.get(key);
  if (!entry || entry.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    return null;
  }
  entry.count++;
  if (entry.count <= max) return null;
  const retry = Math.ceil((entry.resetAt - now) / 1000);
  return NextResponse.json(
    { error: `Too many requests. Try again in ${retry}s.` },
    { status: 429, headers: { "Retry-After": String(retry) } },
  );
}
