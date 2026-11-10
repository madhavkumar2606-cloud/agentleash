import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { authMode, safeEqual } from "./auth";
import { originOf } from "./http";
import { rateLimit } from "./rateLimit";
import { newId } from "./store";
import { checkIntent } from "./firewall/intent";

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});
const req = (host: string, ip = "1.2.3.4") =>
  new NextRequest(`http://${host}/api/x`, { headers: { host, "x-forwarded-for": ip } });

describe("auth mode", () => {
  it("is open locally, locked with a password, refuses deployed without one", () => {
    delete process.env.OWNER_PASSWORD;
    delete process.env.APP_URL;
    expect(authMode()).toBe("open");
    process.env.APP_URL = "https://x.onrender.com";
    expect(authMode()).toBe("misconfigured");
    process.env.OWNER_PASSWORD = "pw";
    expect(authMode()).toBe("locked");
  });
  it("compares secrets safely", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("origin for PayPal return links", () => {
  it("uses APP_URL when set, even if the Host header is forged", () => {
    process.env.APP_URL = "https://countersign.onrender.com/";
    expect(originOf(req("evil.com"))).toBe("https://countersign.onrender.com");
  });
  it("refuses a public Host header without APP_URL", () => {
    delete process.env.APP_URL;
    expect(() => originOf(req("evil.com"))).toThrow(/APP_URL/);
    expect(originOf(req("localhost:3000"))).toBe("http://localhost:3000");
  });
});

describe("rate limit", () => {
  it("blocks after the limit, per client", () => {
    for (let i = 0; i < 3; i++) expect(rateLimit(req("h", "9.9.9.9"), "t", 3)).toBeNull();
    expect(rateLimit(req("h", "9.9.9.9"), "t", 3)?.status).toBe(429);
    expect(rateLimit(req("h", "8.8.8.8"), "t", 3)).toBeNull();
  });
});

describe("ids", () => {
  it("are random and long", () => {
    const a = newId("dec");
    expect(a).toMatch(/^dec_[0-9a-f]{32}$/);
    expect(newId("dec")).not.toBe(a);
  });
});

describe("intent check without AI", () => {
  it("fails a purchase unrelated to the task", async () => {
    const r = await checkIntent({
      agentId: "a", task: "Buy a gardening gift for mom", merchantId: "m", merchantName: "M", productId: "p",
      title: "Gaming Mouse", category: "electronics", unitPrice: 20, quantity: 1, currency: "USD", agentReasoning: "trust me",
    });
    expect(r.status).toBe("fail");
  });
});
