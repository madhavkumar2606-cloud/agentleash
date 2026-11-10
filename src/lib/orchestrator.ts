// Connects firewall decisions to PayPal payments.
//   ALLOW  -> PayPal order created right away (mock mode: paid instantly, like a saved payment method)
//   REVIEW -> waits for the owner; on approval the owner is sent to PayPal checkout
//   BLOCK  -> no payment, decision logged

import { paypalConfig } from "./config";
import { evaluate } from "./firewall";
import { evaluateToolCall } from "./guard";
import { appendLedger } from "./ledger";
import { authorizeOrder, captureAuthorization, captureOrder, createOrder, refundCapture, registerMockCapture, voidAuthorization } from "./paypal";
import { getDecision, newId, saveDecision, state, weeklySpent } from "./store";
import type { Decision, PurchaseProposal, ToolCallProposal } from "./types";

/** Kill switch: while frozen, every agent payment and refund is blocked, whatever the other checks say. */
function applyFreeze(d: Decision): Decision {
  const at = state().frozenAt;
  if (!at) return d;
  d.verdict = "BLOCK";
  d.riskScore = Math.max(d.riskScore, 100);
  d.summary = "Blocked: you froze all agent payments and refunds.";
  d.checks = [{ id: "freeze", label: "Kill switch", status: "fail", source: "rules", detail: "You froze every agent with the kill switch. Nothing moves until you unfreeze." }, ...d.checks];
  d.payment = { status: "none" };
  return d;
}

export async function submitProposal(p: PurchaseProposal, origin: string): Promise<Decision> {
  const s = state();
  const decision = applyFreeze(await evaluate(p, {
    policy: s.mandate.policy,
    weeklySpent: weeklySpent(),
    knownMerchants: s.knownMerchants,
    mandateId: s.mandate.id,
    id: newId("dec"),
  }));
  saveDecision(decision);
  if (decision.verdict === "ALLOW") await startPayment(decision, origin, { autoCapture: true });
  return decision;
}

async function startPayment(d: Decision, origin: string, opts: { autoCapture: boolean }) {
  const p = d.proposal;
  const intent = state().mandate.policy.holdUntilDelivered ? "AUTHORIZE" : "CAPTURE";
  try {
    const order = await createOrder({
      intent,
      referenceId: d.id,
      description: `Countersign: ${p.title} from ${p.merchantName}`,
      itemName: p.title,
      unitPrice: p.unitPrice,
      quantity: p.quantity,
      currency: p.currency,
      returnUrl: `${origin}/api/paypal/return?decision=${d.id}`,
      cancelUrl: `${origin}/api/paypal/cancel?decision=${d.id}`,
    });
    d.payment = { status: "awaiting_payer", orderId: order.orderId, approveUrl: order.approveUrl, intent };
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
  appendLedger("owner.approved", { id: d.id, amount: d.amount, action: d.toolCall ? d.toolCall.tool : "purchase" });
  if (d.toolCall) {
    // Refunds Countersign runs itself. Other PayPal tools: the owner's approval lets the agent's next identical call through.
    if (d.toolCall.tool === "create_refund") return executeRefund(d);
    d.payment = { status: "approved" };
    return saveDecision(d);
  }
  return startPayment(d, origin, { autoCapture: false });
}

// ---------- PayPal MCP tool calls ----------

const DAY = 24 * 60 * 60 * 1000;

/** Agent refunds actually executed in the last 24 hours. */
export function refundedToday(now = Date.now()): number {
  return state()
    .decisions.filter((d) => d.toolCall?.tool === "create_refund" && d.payment.status === "refunded" && Date.parse(d.updatedAt) >= now - DAY)
    .reduce((s, d) => s + d.amount, 0);
}

/** Total already refunded by agents on one capture (PayPal's capture lookup doesn't return it). */
export function refundedOnCapture(captureId: string): number {
  return state()
    .decisions.filter((d) => d.toolCall?.tool === "create_refund" && d.payment.status === "refunded" && d.toolCall.args.capture_id === captureId)
    .reduce((s, d) => s + d.amount, 0);
}

const fingerprint = (tool: string, args: Record<string, unknown>) => JSON.stringify([tool, args]);

/**
 * Check a PayPal tool call. If an identical call was approved by the owner and not yet used, it goes straight through.
 * With execute=true, allowed refunds are executed by Countersign (it holds the PayPal keys).
 */
export async function submitToolCall(tc: ToolCallProposal, opts: { execute: boolean }): Promise<Decision> {
  const s = state();
  const fp = fingerprint(tc.tool, tc.args);
  const preApproved = s.frozenAt
    ? undefined
    : s.decisions.find((d) => d.toolCall && d.payment.status === "approved" && fingerprint(d.toolCall.tool, d.toolCall.args) === fp);
  if (preApproved) {
    preApproved.payment = { status: "none" }; // consumed: the agent may now run it once
    preApproved.verdict = "ALLOW";
    preApproved.summary = "Approved by you. The agent may now run this call once.";
    return saveDecision(preApproved);
  }
  const d = applyFreeze(
    await evaluateToolCall(tc, {
      policy: s.mandate.policy,
      refundedToday: refundedToday(),
      refundedOnCapture,
      mandateId: s.mandate.id,
      id: newId("dec"),
    }),
  );
  saveDecision(d);
  if (d.verdict === "ALLOW" && opts.execute && tc.tool === "create_refund") await executeRefund(d);
  return d;
}

async function executeRefund(d: Decision): Promise<Decision> {
  const args = d.toolCall!.args;
  try {
    const r = await refundCapture(
      String(args.capture_id),
      d.amount,
      d.proposal.currency,
      String(args.note_to_payer ?? "Refund issued by your support agent, checked by Countersign."),
      d.id,
    );
    d.payment = { status: "refunded", refundId: r.refundId };
  } catch (err) {
    d.payment = { status: "failed", error: (err as Error).message };
  }
  return saveDecision(d);
}

export function ownerReject(id: string): Decision {
  const d = getDecision(id);
  if (!d) throw new Error("Decision not found");
  if (d.payment.status === "awaiting_owner") {
    appendLedger("owner.rejected", { id: d.id, amount: d.amount });
    d.payment = { status: "rejected" };
    saveDecision(d);
  }
  return d;
}

export async function completeCapture(id: string): Promise<Decision> {
  const d = getDecision(id);
  if (!d || !d.payment.orderId) throw new Error("No PayPal order for this decision");
  if (d.payment.status === "captured" || d.payment.status === "authorized") return d;
  if (d.payment.intent === "AUTHORIZE") return authorizeHold(d);
  try {
    const cap = await captureOrder(d.payment.orderId);
    if (cap.status !== "COMPLETED") throw new Error(`PayPal capture status ${cap.status}`);
    // The money that moved must be exactly what the firewall approved.
    if (cap.amount !== undefined && (Number(cap.amount) !== d.amount || cap.currency !== d.proposal.currency)) {
      throw new Error(`Captured ${cap.amount} ${cap.currency}, but ${d.amount.toFixed(2)} ${d.proposal.currency} was approved`);
    }
    d.payment = { ...d.payment, status: "captured", captureId: cap.captureId, error: undefined };
    state().knownMerchants.add(d.proposal.merchantId);
    if (paypalConfig().mode === "mock") {
      registerMockCapture({ id: cap.captureId, status: "COMPLETED", amount: d.amount, currency: d.proposal.currency });
    }
  } catch (err) {
    d.payment = { ...d.payment, status: "failed", error: (err as Error).message };
  }
  return saveDecision(d);
}

/** Payer approved an AUTHORIZE order: PayPal now holds the money until the owner confirms delivery. */
async function authorizeHold(d: Decision): Promise<Decision> {
  try {
    const auth = await authorizeOrder(d.payment.orderId!);
    if (auth.status !== "CREATED" && auth.status !== "PENDING") throw new Error(`PayPal authorization status ${auth.status}`);
    if (auth.amount !== undefined && (Number(auth.amount) !== d.amount || auth.currency !== d.proposal.currency)) {
      throw new Error(`Authorized ${auth.amount} ${auth.currency}, but ${d.amount.toFixed(2)} ${d.proposal.currency} was approved`);
    }
    d.payment = { ...d.payment, status: "authorized", authorizationId: auth.authorizationId, error: undefined };
  } catch (err) {
    d.payment = { ...d.payment, status: "failed", error: (err as Error).message };
  }
  return saveDecision(d);
}

/** The item arrived: capture the held money. */
export async function confirmDelivery(id: string): Promise<Decision> {
  const d = getDecision(id);
  if (!d || d.payment.status !== "authorized" || !d.payment.authorizationId) throw new Error("There's no held payment to release for this decision");
  try {
    const cap = await captureAuthorization(d.payment.authorizationId, `capture-${d.id}`);
    if (cap.status !== "COMPLETED" && cap.status !== "PENDING") throw new Error(`PayPal capture status ${cap.status}`);
    if (cap.amount !== undefined && Number(cap.amount) !== d.amount) throw new Error(`Captured ${cap.amount}, but ${d.amount.toFixed(2)} was approved`);
    d.payment = { ...d.payment, status: "captured", captureId: cap.captureId, error: undefined };
    state().knownMerchants.add(d.proposal.merchantId);
    if (paypalConfig().mode === "mock") registerMockCapture({ id: cap.captureId, status: "COMPLETED", amount: d.amount, currency: d.proposal.currency });
  } catch (err) {
    d.payment = { ...d.payment, error: (err as Error).message };
  }
  return saveDecision(d);
}

/** Never arrived, or changed your mind: void the hold. The money never moves. */
export async function releaseHold(id: string): Promise<Decision> {
  const d = getDecision(id);
  if (!d || d.payment.status !== "authorized" || !d.payment.authorizationId) throw new Error("There's no held payment to release for this decision");
  try {
    await voidAuthorization(d.payment.authorizationId);
    d.payment = { ...d.payment, status: "voided", error: undefined };
  } catch (err) {
    d.payment = { ...d.payment, error: (err as Error).message };
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
