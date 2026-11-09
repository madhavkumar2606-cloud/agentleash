import { describe, expect, it } from "vitest";
import { evaluateToolCall } from ".";
import { DEFAULT_RULES, heuristicParsePolicy } from "../firewall/rules";
import { registerMockCapture } from "../paypal";
import { runSupportAgent, SUPPORT_SCENARIOS } from "../supportAgent";
import type { ToolCallProposal } from "../types";

const policy = heuristicParsePolicy(DEFAULT_RULES);
const ctx = (over: Partial<{ refundedToday: number; already: number }> = {}) => ({
  policy,
  refundedToday: over.refundedToday ?? 0,
  refundedOnCapture: () => over.already ?? 0,
  mandateId: "m",
  id: "d",
});

describe("support agent scenarios (scripted, mock PayPal)", () => {
  for (const s of SUPPORT_SCENARIOS) {
    it(`${s.id} → ${s.expected}`, async () => {
      const run = await runSupportAgent(s.id, false);
      expect(run.call).not.toBeNull();
      const d = await evaluateToolCall(run.call!, ctx());
      expect(d.verdict, d.summary).toBe(s.expected);
    });
  }

  it("poisoned ticket: injection, over-refund and rules all fail", async () => {
    const run = await runSupportAgent("poisoned", false);
    const d = await evaluateToolCall(run.call!, ctx());
    const status = Object.fromEntries(d.checks.map((c) => [c.id, c.status]));
    expect(status.injection).toBe("fail");
    expect(status.paypal).toBe("fail");
    expect(status.refund).toBe("fail");
    expect(d.summary).toMatch(/hijacked/);
    expect(d.amount).toBe(500);
  });
});

describe("refund verification against PayPal", () => {
  const base: ToolCallProposal = {
    agentId: "a",
    tool: "create_refund",
    args: { capture_id: "CAPTESTAAAA00001", amount: { currency_code: "USD", value: "20.00" } },
    task: "Resolve ticket about order CAPTESTAAAA00001",
    agentReasoning: "Customer asked for $20 back.",
  };
  registerMockCapture({ id: "CAPTESTAAAA00001", status: "COMPLETED", amount: 30, currency: "USD" });

  it("blocks a refund on a payment that doesn't exist", async () => {
    const d = await evaluateToolCall({ ...base, args: { ...base.args, capture_id: "NOPE000000000000" } }, ctx());
    expect(d.verdict).toBe("BLOCK");
    expect(d.checks.find((c) => c.id === "paypal")?.detail).toMatch(/no payment/);
  });

  it("blocks refunding more than is left after earlier refunds", async () => {
    const d = await evaluateToolCall(base, ctx({ already: 15 }));
    expect(d.verdict).toBe("BLOCK");
    expect(d.checks.find((c) => c.id === "paypal")?.detail).toMatch(/more than the \$15\.00/);
  });

  it("a full refund (no amount) resolves to what's left", async () => {
    const d = await evaluateToolCall({ ...base, args: { capture_id: "CAPTESTAAAA00001" } }, ctx());
    expect(d.amount).toBe(30);
    expect(d.verdict).toBe("ALLOW");
  });

  it("enforces the daily refund limit", async () => {
    const d = await evaluateToolCall(base, ctx({ refundedToday: 290 }));
    expect(d.verdict).toBe("BLOCK");
    expect(d.checks.find((c) => c.id === "refund")?.detail).toMatch(/daily limit/);
  });

  it("other money tools go to the owner", async () => {
    const d = await evaluateToolCall(
      { ...base, tool: "accept_dispute_claim", args: { dispute_id: "PP-D-1", note: "ok" }, task: "Handle dispute PP-D-1" },
      ctx(),
    );
    expect(d.verdict).toBe("REVIEW");
  });
});
