// Connects firewall decisions to PayPal payments.
//   ALLOW  -> PayPal order created right away (mock mode: paid instantly, like a saved payment method)
//   REVIEW -> waits for the owner; on approval the owner is sent to PayPal checkout
//   BLOCK  -> no payment, decision logged

import { paypalConfig } from "./config";
import { evaluate } from "./firewall";
import { captureOrder, createOrder } from "./paypal";
import { getDecision, newId, saveDecision, state, weeklySpent } from "./store";
import type { Decision, PurchaseProposal } from "./types";

export async function submitProposal(p: PurchaseProposal, origin: string): Promise<Decision> {
  const s = state();
  const decision = await evaluate(p, {
    policy: s.mandate.policy,
    weeklySpent: weeklySpent(),
    knownMerchants: s.knownMerchants,
    mandateId: s.mandate.id,
    id: newId("dec"),
  });
  saveDecision(decision);
  if (decision.verdict === "ALLOW") await startPayment(decision, origin, { autoCapture: true });
  return decision;
}

async function startPayment(d: Decision, origin: string, opts: { autoCapture: boolean }) {
  const p = d.proposal;
  try {
    const order = await createOrder({
      referenceId: d.id,
      description: `AgentLeash: ${p.title} from ${p.merchantName}`,
      itemName: p.title,
      unitPrice: p.unitPrice,
      quantity: p.quantity,
      currency: p.currency,
      returnUrl: `${origin}/api/paypal/return?decision=${d.id}`,
      cancelUrl: `${origin}/api/paypal/cancel?decision=${d.id}`,
    });
    d.payment = { status: "awaiting_payer", orderId: order.orderId, approveUrl: order.approveUrl };
    saveDecision(d);
    // Mock mode stands in for a vaulted payment method: allowed purchases settle with no checkout step.
    if (opts.autoCapture && paypalConfig().mode === "mock") await completeCapture(d.id);
  } catch (err) {
    d.payment = { status: "failed", error: (err as Error).message };
    saveDecision(d);
  }
  return d;
}

export async function ownerApprove(id: string, origin: string): Promise<Decision> {
  const d = getDecision(id);
  if (!d) throw new Error("Decision not found");
  if (d.verdict !== "REVIEW" || d.payment.status !== "awaiting_owner") return d;
  return startPayment(d, origin, { autoCapture: false });
}

export function ownerReject(id: string): Decision {
  const d = getDecision(id);
  if (!d) throw new Error("Decision not found");
  if (d.payment.status === "awaiting_owner") {
    d.payment = { status: "rejected" };
    saveDecision(d);
  }
  return d;
}

export async function completeCapture(id: string): Promise<Decision> {
  const d = getDecision(id);
  if (!d || !d.payment.orderId) throw new Error("No PayPal order for this decision");
  if (d.payment.status === "captured") return d;
  try {
    const cap = await captureOrder(d.payment.orderId);
    if (cap.status !== "COMPLETED") throw new Error(`PayPal capture status ${cap.status}`);
    // The money that moved must be exactly what the firewall approved.
    if (cap.amount !== undefined && (Number(cap.amount) !== d.amount || cap.currency !== d.proposal.currency)) {
      throw new Error(`Captured ${cap.amount} ${cap.currency}, but ${d.amount.toFixed(2)} ${d.proposal.currency} was approved`);
    }
    d.payment = { ...d.payment, status: "captured", captureId: cap.captureId };
    state().knownMerchants.add(d.proposal.merchantId);
  } catch (err) {
    d.payment = { ...d.payment, status: "failed", error: (err as Error).message };
  }
  return saveDecision(d);
}

export function cancelPayment(id: string): Decision | undefined {
  const d = getDecision(id);
  if (d && d.payment.status === "awaiting_payer") {
    d.payment = { ...d.payment, status: "rejected", error: "Checkout cancelled at PayPal" };
    saveDecision(d);
  }
  return d;
}
