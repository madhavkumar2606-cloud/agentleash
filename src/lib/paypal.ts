// PayPal Orders v2 client (sandbox), with a mock mode used when no credentials are set.
// Flow: create order -> payer approves at PayPal -> PayPal redirects to our return URL -> capture.

import { benchScope } from "./benchContext";
import { paypalConfig } from "./config";

let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  const cfg = paypalConfig();
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const res = await fetch(`${cfg.baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal auth failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.value;
}

export interface CreateOrderInput {
  referenceId: string;
  description: string;
  itemName: string;
  unitPrice: number;
  quantity: number;
  currency: string;
  returnUrl: string;
  cancelUrl: string;
  /** AUTHORIZE: PayPal holds the money; capture it later (on delivery) or void it. */
  intent?: "CAPTURE" | "AUTHORIZE";
}

export interface CreatedOrder {
  orderId: string;
  approveUrl: string;
}

const money = (n: number) => n.toFixed(2);

export async function createOrder(input: CreateOrderInput): Promise<CreatedOrder> {
  const cfg = paypalConfig();
  const total = input.unitPrice * input.quantity;

  if (cfg.mode === "mock") {
    const orderId = "MOCK-" + Math.random().toString(36).slice(2, 10).toUpperCase();
    const approveUrl = `${new URL(input.returnUrl).origin}/mock-paypal?token=${orderId}&return=${encodeURIComponent(
      input.returnUrl,
    )}&amount=${money(total)}&item=${encodeURIComponent(input.itemName)}`;
    return { orderId, approveUrl };
  }

  const res = await fetch(`${cfg.baseUrl}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": input.referenceId,
    },
    body: JSON.stringify({
      intent: input.intent ?? "CAPTURE",
      purchase_units: [
        {
          reference_id: input.referenceId,
          description: input.description.slice(0, 127),
          custom_id: input.referenceId,
          amount: {
            currency_code: input.currency,
            value: money(total),
            breakdown: { item_total: { currency_code: input.currency, value: money(total) } },
          },
          items: [
            {
              name: input.itemName.slice(0, 127),
              quantity: String(input.quantity),
              unit_amount: { currency_code: input.currency, value: money(input.unitPrice) },
            },
          ],
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "Countersign",
            user_action: "PAY_NOW",
            shipping_preference: "NO_SHIPPING",
            return_url: input.returnUrl,
            cancel_url: input.cancelUrl,
          },
        },
      },
    }),
  });
  if (!res.ok) throw new Error(`PayPal create order failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  const approve = (data.links as { rel: string; href: string }[]).find(
    (l) => l.rel === "payer-action" || l.rel === "approve",
  );
  if (!approve) throw new Error("PayPal order has no approval link");
  return { orderId: data.id, approveUrl: approve.href };
}

export async function captureOrder(
  orderId: string,
): Promise<{ captureId: string; status: string; amount?: string; currency?: string }> {
  const cfg = paypalConfig();
  if (cfg.mode === "mock") {
    return { captureId: "MOCKCAP-" + orderId.slice(5), status: "COMPLETED" };
  }
  const res = await fetch(`${cfg.baseUrl}/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": `capture-${orderId}`,
    },
  });
  if (!res.ok) throw new Error(`PayPal capture failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  const capture = data?.purchase_units?.[0]?.payments?.captures?.[0];
  return { captureId: capture?.id ?? "", status: data.status, amount: capture?.amount?.value, currency: capture?.amount?.currency_code };
}

// ---- Captures and refunds (used to verify and execute agent refunds) ----

export interface CaptureInfo {
  id: string;
  status: string; // COMPLETED | PARTIALLY_REFUNDED | REFUNDED | PENDING | DECLINED
  amount: number;
  currency: string;
}

/** Mock-mode registry of captures, filled when demo purchases are paid. */
const g = globalThis as unknown as { __mockCaptures?: Map<string, CaptureInfo> };
const mockCaptures = () => (g.__mockCaptures ??= new Map());
export function registerMockCapture(c: CaptureInfo) {
  mockCaptures().set(c.id, c);
}

/** Look up a capture in PayPal. Returns null if PayPal says it doesn't exist. */
export async function getCapture(captureId: string): Promise<CaptureInfo | null> {
  const fixture = benchScope.getStore()?.captures;
  if (fixture) return fixture.get(captureId) ?? null;
  const cfg = paypalConfig();
  if (cfg.mode === "mock") return mockCaptures().get(captureId) ?? null;
  const res = await fetch(`${cfg.baseUrl}/v2/payments/captures/${encodeURIComponent(captureId)}`, {
    headers: { Authorization: `Bearer ${await accessToken()}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`PayPal capture lookup failed (${res.status}): ${await res.text()}`);
  const d = await res.json();
  return { id: d.id, status: d.status, amount: Number(d.amount?.value ?? 0), currency: d.amount?.currency_code ?? "USD" };
}

/** Refund a capture (full or partial). Idempotent per requestId. */
export async function refundCapture(
  captureId: string,
  amount: number,
  currency: string,
  note: string,
  requestId: string,
): Promise<{ refundId: string; status: string }> {
  const cfg = paypalConfig();
  if (cfg.mode === "mock") {
    const c = mockCaptures().get(captureId);
    if (c) c.status = amount >= c.amount ? "REFUNDED" : "PARTIALLY_REFUNDED";
    return { refundId: "MOCKREF-" + Math.random().toString(36).slice(2, 10).toUpperCase(), status: "COMPLETED" };
  }
  const res = await fetch(`${cfg.baseUrl}/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": requestId,
    },
    body: JSON.stringify({
      amount: { value: amount.toFixed(2), currency_code: currency },
      note_to_payer: note.slice(0, 255),
    }),
  });
  if (!res.ok) throw new Error(`PayPal refund failed (${res.status}): ${await res.text()}`);
  const d = await res.json();
  return { refundId: d.id, status: d.status };
}

// ---- Authorization holds: the money is held by PayPal until the owner confirms delivery ----

/** Authorize an approved order (intent AUTHORIZE). Returns the authorization that holds the funds. */
export async function authorizeOrder(
  orderId: string,
): Promise<{ authorizationId: string; status: string; amount?: string; currency?: string; expiresAt?: string }> {
  const cfg = paypalConfig();
  if (cfg.mode === "mock") return { authorizationId: "MOCKAUTH-" + orderId.slice(5), status: "CREATED" };
  const res = await fetch(`${cfg.baseUrl}/v2/checkout/orders/${orderId}/authorize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": `authorize-${orderId}`,
    },
  });
  if (!res.ok) throw new Error(`PayPal authorization failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  const auth = data?.purchase_units?.[0]?.payments?.authorizations?.[0];
  return { authorizationId: auth?.id ?? "", status: auth?.status ?? data.status, amount: auth?.amount?.value, currency: auth?.amount?.currency_code, expiresAt: auth?.expiration_time };
}

/** Capture a held authorization: the money moves now. Idempotent per requestId. */
export async function captureAuthorization(authorizationId: string, requestId: string): Promise<{ captureId: string; status: string; amount?: string; currency?: string }> {
  const cfg = paypalConfig();
  if (cfg.mode === "mock") return { captureId: "MOCKCAP-" + authorizationId.slice(9), status: "COMPLETED" };
  const res = await fetch(`${cfg.baseUrl}/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": requestId,
    },
    body: JSON.stringify({ final_capture: true }),
  });
  if (!res.ok) throw new Error(`PayPal capture failed (${res.status}): ${await res.text()}`);
  const d = await res.json();
  return { captureId: d.id, status: d.status, amount: d.amount?.value, currency: d.amount?.currency_code };
}

/** Release a held authorization: the money never moves. */
export async function voidAuthorization(authorizationId: string): Promise<void> {
  const cfg = paypalConfig();
  if (cfg.mode === "mock") return;
  const res = await fetch(`${cfg.baseUrl}/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
  });
  if (!res.ok && res.status !== 204) throw new Error(`PayPal void failed (${res.status}): ${await res.text()}`);
}
