import { afterEach, describe, expect, it } from "vitest";
import { submitToolCall } from "./orchestrator";
import { registerMockCapture } from "./paypal";
import { resetState, setFrozen } from "./store";

const refund = (value: string) => ({
  agentId: "t",
  tool: "create_refund",
  args: { capture_id: "CAP-FREEZE", amount: { currency_code: "USD", value } },
  task: "Resolve the ticket about order CAP-FREEZE",
  context: "One pot arrived chipped, could I get $5 back?",
  agentReasoning: "Small fair refund.",
});

describe("kill switch", () => {
  afterEach(() => resetState());

  it("blocks a refund that would otherwise be allowed, and nothing is executed", async () => {
    registerMockCapture({ id: "CAP-FREEZE", status: "COMPLETED", amount: 79, currency: "USD" });
    setFrozen(true);
    const d = await submitToolCall(refund("5.00"), { execute: true });
    expect(d.verdict).toBe("BLOCK");
    expect(d.checks[0].id).toBe("freeze");
    expect(d.payment.status).toBe("none");
  });

  it("unfreezing lets the same refund through", async () => {
    registerMockCapture({ id: "CAP-FREEZE", status: "COMPLETED", amount: 79, currency: "USD" });
    setFrozen(true);
    setFrozen(false);
    const d = await submitToolCall(refund("5.00"), { execute: true });
    expect(d.verdict).toBe("ALLOW");
    expect(d.payment.status).toBe("refunded");
  });
});
