import { beforeEach, describe, expect, it } from "vitest";
import { verifyInBrowser } from "./canonical";
import { appendLedger, ledgerEntries, tamperForDemo, verifyLedger } from "./ledger";
import { submitProposal } from "./orchestrator";
import { resetState, setFrozen } from "./store";

const proposal = {
  agentId: "t",
  task: "Buy a $25 gift for my sister",
  merchantId: "m_cozy",
  merchantName: "CozyCo",
  title: "Scented candle",
  category: "gifts",
  unitPrice: 25,
  quantity: 1,
  currency: "USD",
  agentReasoning: "Fits the budget",
};

describe("tamper-evident ledger", () => {
  beforeEach(() => resetState());

  it("chains decisions, payments and the kill switch, and verifies", async () => {
    await submitProposal(proposal as never, "http://x");
    setFrozen(true);
    setFrozen(false);
    const types = ledgerEntries().map((e) => e.type);
    expect(types[0]).toBe("demo.reset");
    expect(types).toContain("decision");
    expect(types).toContain("kill_switch.on");
    expect(verifyLedger().ok).toBe(true);
    // The browser re-computes the same hashes with Web Crypto.
    expect((await verifyInBrowser(ledgerEntries())).ok).toBe(true);
  });

  it("detects a quietly edited entry, on the server and in the browser", async () => {
    await submitProposal(proposal as never, "http://x");
    appendLedger("note", { after: true });
    const changed = tamperForDemo()!;
    const v = verifyLedger();
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(changed.seq);
    expect((await verifyInBrowser(ledgerEntries())).brokenAt).toBe(changed.seq);
  });

  it("detects a deleted entry", () => {
    appendLedger("a", { n: 1 });
    appendLedger("b", { n: 2 });
    appendLedger("c", { n: 3 });
    const without = ledgerEntries().filter((e) => e.type !== "b");
    expect(verifyLedger(without).ok).toBe(false);
  });
});
