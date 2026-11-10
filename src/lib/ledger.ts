// Tamper-evident ledger: every decision, payment change, rules change, freeze and signed approval
// is appended to a SHA-256 hash chain. Changing any past entry breaks every link after it.

import { createHash } from "node:crypto";
import { entryPreimage, GENESIS, type LedgerEntry } from "./canonical";
import type { Decision } from "./types";

interface LedgerState {
  entries: LedgerEntry[];
  /** Last recorded payment status per decision, to log changes only. */
  lastStatus: Map<string, string>;
}

const g = globalThis as unknown as { __countersignLedger?: LedgerState };
const L = (): LedgerState => (g.__countersignLedger ??= { entries: [], lastStatus: new Map() });

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

export function appendLedger(type: string, data: Record<string, unknown>): LedgerEntry {
  const l = L();
  const prev = l.entries[l.entries.length - 1];
  const base = { seq: (prev?.seq ?? 0) + 1, at: new Date().toISOString(), type, data: JSON.parse(JSON.stringify(data)), prevHash: prev?.hash ?? GENESIS };
  const entry = { ...base, hash: sha256(entryPreimage(base)) };
  l.entries.push(entry);
  if (l.entries.length > 5000) l.entries.splice(0, l.entries.length - 5000); // demo memory cap; verify starts from the first kept link
  return entry;
}

/** Called on every saveDecision: logs the decision once, then each payment status change. */
export function recordDecision(d: Decision) {
  const l = L();
  const last = l.lastStatus.get(d.id);
  if (last === undefined) {
    appendLedger("decision", {
      id: d.id,
      agent: d.proposal.agentId,
      action: d.toolCall ? d.toolCall.tool : "purchase",
      what: d.toolCall ? d.proposal.title : `${d.proposal.quantity} × ${d.proposal.title}`,
      payee: d.toolCall ? "PayPal MCP" : d.proposal.merchantName,
      amount: d.amount,
      currency: d.proposal.currency,
      verdict: d.verdict,
      risk: d.riskScore,
      failed: d.checks.filter((c) => c.status === "fail").map((c) => c.id),
      flagged: d.checks.filter((c) => c.status === "warn").map((c) => c.id),
    });
  }
  if (last !== d.payment.status && !(last === undefined && d.payment.status === "none")) {
    const p = d.payment;
    appendLedger(`payment.${p.status}`, {
      id: d.id,
      amount: d.amount,
      orderId: p.orderId,
      authorizationId: p.authorizationId,
      captureId: p.captureId,
      refundId: p.refundId,
      error: p.error,
    });
  }
  l.lastStatus.set(d.id, d.payment.status);
}

export function ledgerEntries(): LedgerEntry[] {
  return L().entries;
}

export function verifyLedger(entries = L().entries): { ok: boolean; count: number; head: string; brokenAt?: number } {
  let prev = entries[0]?.prevHash ?? GENESIS;
  for (const e of entries) {
    if (e.prevHash !== prev || sha256(entryPreimage(e)) !== e.hash) return { ok: false, count: entries.length, head: prev, brokenAt: e.seq };
    prev = e.hash;
  }
  return { ok: true, count: entries.length, head: prev };
}

/** Demo only: quietly change one past entry, the way an attacker with database access might. */
export function tamperForDemo(): LedgerEntry | undefined {
  const target = [...L().entries].reverse().find((e) => typeof e.data.amount === "number");
  if (!target) return undefined;
  target.data = { ...target.data, amount: Number(target.data.amount) + 1000, verdict: target.data.verdict ? "ALLOW" : undefined };
  return target;
}

export function resetLedger() {
  g.__countersignLedger = { entries: [], lastStatus: new Map() };
}
