import { afterEach, describe, expect, it } from "vitest";
import { runScenario } from "./agent";
import { heuristicParsePolicy } from "./firewall/rules";
import { confirmDelivery, releaseHold, submitProposal } from "./orchestrator";
import { resetState, state } from "./store";

const ORIGIN = "http://localhost:3000";

describe("hold payments until delivery (PayPal authorization)", () => {
  afterEach(() => resetState());

  it("parses the rule from plain English", () => {
    expect(heuristicParsePolicy("Hold agent payments until I confirm delivery.").holdUntilDelivered).toBe(true);
    expect(heuristicParsePolicy("Only pay once it arrives.").holdUntilDelivered).toBe(true);
    expect(heuristicParsePolicy("Never spend more than $100.").holdUntilDelivered).toBe(false);
  });

  it("an allowed purchase is held, then paid when the owner confirms delivery", async () => {
    state().mandate.policy.holdUntilDelivered = true;
    const d = await submitProposal(runScenario("clean").proposal, ORIGIN);
    expect(d.verdict).toBe("ALLOW");
    expect(d.payment.status).toBe("authorized");
    expect(d.payment.intent).toBe("AUTHORIZE");
    const paid = await confirmDelivery(d.id);
    expect(paid.payment.status).toBe("captured");
    expect(paid.payment.captureId).toBeTruthy();
  });

  it("cancelling the hold means nothing is paid", async () => {
    state().mandate.policy.holdUntilDelivered = true;
    const d = await submitProposal(runScenario("clean").proposal, ORIGIN);
    const voided = await releaseHold(d.id);
    expect(voided.payment.status).toBe("voided");
    await expect(confirmDelivery(d.id)).rejects.toThrow();
  });

  it("without the rule, purchases are paid right away as before", async () => {
    const d = await submitProposal(runScenario("clean").proposal, ORIGIN);
    expect(d.payment.status).toBe("captured");
  });
});
