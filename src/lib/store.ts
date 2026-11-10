// In-memory app state (mandate, audit log, known merchants).
// Kept on globalThis so it survives Next.js hot reloads. Swap for a database later.

import { SEED_KNOWN_MERCHANTS } from "./catalog";
import { llmConfig } from "./config";
import { DEFAULT_RULES, heuristicParsePolicy, parsePolicy } from "./firewall/rules";
import type { Decision, Mandate } from "./types";

interface State {
  aiParseStarted?: boolean;
  mandate: Mandate;
  decisions: Decision[];
  knownMerchants: Set<string>;
  /** Kill switch: when set, every agent payment and refund is blocked. */
  frozenAt?: string;
}

function freshState(): State {
  return {
    mandate: {
      id: "mandate_default",
      rulesText: DEFAULT_RULES,
      policy: heuristicParsePolicy(DEFAULT_RULES),
      parsedBy: "heuristic",
      createdAt: new Date().toISOString(),
    },
    decisions: [],
    knownMerchants: new Set(SEED_KNOWN_MERCHANTS),
  };
}

const g = globalThis as unknown as { __countersign?: State };

export function state(): State {
  if (!g.__countersign) g.__countersign = freshState();
  const s = g.__countersign;
  // With an AI provider configured, re-parse the default rules with AI once, in the background.
  if (!s.aiParseStarted && s.mandate.parsedBy === "heuristic" && llmConfig().provider !== "mock") {
    s.aiParseStarted = true;
    const { id, rulesText } = s.mandate;
    parsePolicy(rulesText)
      .then(({ policy, parsedBy }) => {
        // Only apply if the owner hasn't saved new rules in the meantime.
        if (s.mandate.id === id && parsedBy === "llm") s.mandate = { ...s.mandate, policy, parsedBy };
      })
      .catch(() => {});
  }
  return s;
}

export function resetState() {
  g.__countersign = freshState();
}

export function getDecision(id: string) {
  return state().decisions.find((d) => d.id === id);
}

export function saveDecision(d: Decision) {
  const s = state();
  const i = s.decisions.findIndex((x) => x.id === d.id);
  d.updatedAt = new Date().toISOString();
  if (i === -1) s.decisions.unshift(d);
  else s.decisions[i] = d;
  return d;
}

/** Money committed in the last 7 days: captured, or sent to PayPal for payment. */
export function weeklySpent(now = Date.now()): number {
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  return state()
    .decisions.filter(
      (d) =>
        (d.payment.status === "captured" || d.payment.status === "awaiting_payer" || d.payment.status === "authorized") &&
        Date.parse(d.createdAt) >= weekAgo,
    )
    .reduce((sum, d) => sum + d.amount, 0);
}

export function setFrozen(on: boolean) {
  state().frozenAt = on ? new Date().toISOString() : undefined;
}

/** Random, unguessable IDs (decision IDs appear in approval links). */
export const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
