// In-memory app state (mandate, audit log, known merchants).
// Kept on globalThis so it survives Next.js hot reloads. Swap for a database later.

import { SEED_KNOWN_MERCHANTS } from "./catalog";
import { DEFAULT_RULES, heuristicParsePolicy } from "./firewall/rules";
import type { Decision, Mandate } from "./types";

interface State {
  mandate: Mandate;
  decisions: Decision[];
  knownMerchants: Set<string>;
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

const g = globalThis as unknown as { __agentleash?: State };

export function state(): State {
  if (!g.__agentleash) g.__agentleash = freshState();
  return g.__agentleash;
}

export function resetState() {
  g.__agentleash = freshState();
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
        (d.payment.status === "captured" || d.payment.status === "awaiting_payer") &&
        Date.parse(d.createdAt) >= weekAgo,
    )
    .reduce((sum, d) => sum + d.amount, 0);
}

export const newId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
