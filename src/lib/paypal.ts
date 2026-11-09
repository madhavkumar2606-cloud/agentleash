// PayPal Orders v2 client (sandbox), with a mock mode used when no credentials are set.
// Flow: create order -> payer approves at PayPal -> PayPal redirects to our return URL -> capture.

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
      intent: "CAPTURE",
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
            brand_name: "AgentLeash",
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
