import type { NextRequest } from "next/server";

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const PRIVATE_LAN = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)[\d.]+(:\d+)?$/;

/**
 * Public origin of this app, used for PayPal return/cancel URLs.
 * On a public host this MUST come from APP_URL: deriving it from the Host header would let a
 * forged header point PayPal's return link at another site.
 */
export function originOf(req: NextRequest): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const host = req.headers.get("host") ?? "localhost:3000";
  const devLan = process.env.NODE_ENV !== "production" && PRIVATE_LAN.test(host);
  if (!LOCAL.test(host) && !devLan) {
    throw new Error("Set APP_URL to this app's public URL (e.g. https://countersign.onrender.com).");
  }
  return `http://${host}`;
}
