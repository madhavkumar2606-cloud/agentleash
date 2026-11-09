// Owner authentication. Works in both the Edge (middleware) and Node runtimes (Web Crypto only).
//
//   OWNER_PASSWORD unset, APP_URL unset  -> "open": local development, no login
//   OWNER_PASSWORD set                   -> "locked": dashboard, rules, approvals need the owner session
//   APP_URL set, OWNER_PASSWORD unset    -> "misconfigured": deployed without a password; owner routes refuse to run

export const SESSION_COOKIE = "al_owner";
export const SESSION_MAX_AGE = 7 * 24 * 60 * 60;

export type AuthMode = "open" | "locked" | "misconfigured";

export function authMode(): AuthMode {
  if (process.env.OWNER_PASSWORD) return "locked";
  return process.env.APP_URL ? "misconfigured" : "open";
}

const enc = new TextEncoder();

/** Session token = HMAC-SHA256(password, fixed label). Changing the password logs everyone out. */
export async function sessionToken(): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(process.env.OWNER_PASSWORD ?? ""), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("agentleash-owner-session-v1"));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function isValidSession(cookie: string | undefined): Promise<boolean> {
  if (!cookie || !process.env.OWNER_PASSWORD) return false;
  return safeEqual(cookie, await sessionToken());
}
