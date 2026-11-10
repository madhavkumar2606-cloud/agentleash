import { beforeEach, describe, expect, it } from "vitest";
import { ledgerEntries } from "./ledger";
import { applyPayPalEvent, autoReleaseStaleHolds } from "./orchestrator";
import { resetState, saveDecision, state } from "./store";
import type { Decision } from "./types";

function decision(payment: Decision["payment"], amount = 79): Decision {
  const now = new Date().toISOString();
  return saveDecision({
    id: `dec_${Math.random().toString(36).slice(2)}`,
    mandateId: "m",
    verdict: "ALLOW",
    summary: "",
    riskScore: 0,
    checks: [],
    proposal: { agentId: "a", task: "t", merchantId: "m_greenleaf", merchantName: "GreenLeaf", productId: "p", title: "Kit", category: "gardening", unitPrice: amount, quantity: 1, currency: "USD", agentReasoning: "" },
    amount,
    payment,
    createdAt: now,
    updatedAt: now,
  });
}

describe("PayPal webhooks and stale holds", () => {
  beforeEach(() => resetState());

  it("records a capture event on the matching payment, once", () => {
    const d = decision({ status: "captured", orderId: "ORDER1", captureId: "CAP1" });
    const ev = { id: "WH-1", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "CAP1", amount: { value: "79.00" }, supplementary_data: { related_ids: { order_id: "ORDER1" } } } };
    expect(applyPayPalEvent(ev).matched).toBe(d.id);
    expect(applyPayPalEvent(ev).duplicate).toBe(true);
    expect(state().decisions[0].paypalEvents).toHaveLength(1);
    expect(state().decisions[0].payment.error).toBeUndefined();
  });

  it("flags a capture that differs from what was approved", () => {
    decision({ status: "captured", captureId: "CAP2" });
    applyPayPalEvent({ id: "WH-2", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "CAP2", amount: { value: "790.00" } } });
    expect(state().decisions[0].payment.error).toMatch(/approved \$79\.00/);
  });

  it("freezes agents when a buyer disputes an agent payment", () => {
    decision({ status: "captured", captureId: "CAP3" });
    applyPayPalEvent({ id: "WH-3", event_type: "CUSTOMER.DISPUTE.CREATED", resource: { id: "PP-D-1", reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", disputed_transactions: [{ seller_transaction_id: "CAP3" }] } });
    expect(state().frozenAt).toBeDefined();
    expect(state().decisions[0].dispute?.id).toBe("PP-D-1");
  });

  it("cancels holds nobody confirmed within 72 hours, and leaves fresh ones", async () => {
    const old = decision({ status: "authorized", authorizationId: "AUTH-OLD", authorizedAt: new Date(Date.now() - 73 * 3600e3).toISOString() });
    const fresh = decision({ status: "authorized", authorizationId: "AUTH-NEW", authorizedAt: new Date().toISOString() });
    const done = await autoReleaseStaleHolds();
    expect(done.map((d) => d.id)).toEqual([old.id]);
    expect(state().decisions.find((d) => d.id === old.id)?.payment).toMatchObject({ status: "voided", autoVoided: true });
    expect(state().decisions.find((d) => d.id === fresh.id)?.payment.status).toBe("authorized");
    expect(ledgerEntries().some((e) => e.type === "hold.auto_voided")).toBe(true);
  });
});
