import { NextRequest, NextResponse } from "next/server";
import { applyPayPalEvent, type PayPalEvent } from "@/lib/orchestrator";
import { verifyWebhookSignature } from "@/lib/paypal";

export const dynamic = "force-dynamic";

/**
 * PayPal webhook receiver. Public on purpose (PayPal calls it), so nothing is trusted until PayPal's
 * verify-webhook-signature API confirms the event was signed for our PAYPAL_WEBHOOK_ID.
 */
export async function POST(req: NextRequest) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return NextResponse.json({ error: "PAYPAL_WEBHOOK_ID is not set" }, { status: 503 });
  const text = await req.text();
  if (text.length > 200_000) return NextResponse.json({ error: "Too large" }, { status: 413 });
  let event: PayPalEvent;
  try {
    event = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Not JSON" }, { status: 400 });
  }
  if (!event?.id || !event.event_type) return NextResponse.json({ error: "Not a PayPal event" }, { status: 400 });
  const ok = await verifyWebhookSignature(req.headers, event, webhookId).catch(() => false);
  if (!ok) return NextResponse.json({ error: "Signature check failed" }, { status: 401 });
  return NextResponse.json(applyPayPalEvent(event));
}
