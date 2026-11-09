// Turns the owner's plain-English rules into a structured Policy.
// Uses the LLM when configured; the regex parser is both the fallback and a safety floor.

import { z } from "zod";
import { llmJson } from "../llm";
import type { Policy } from "../types";

export const DEFAULT_RULES =
  "Never spend more than $100 on one purchase. Keep total agent spending under $250 a week. " +
  "Ask me before anything over $60. No alcohol, gift cards, or gambling. Max 2 of any item. " +
  "Check with me before paying a new seller.";

export const DEFAULT_POLICY: Policy = {
  currency: "USD",
  perTransactionLimit: 100,
  weeklyLimit: 250,
  approvalThreshold: 60,
  blockedCategories: [],
  maxQuantity: 2,
  reviewNewMerchants: true,
};

const num = (s: string | undefined) => (s ? Number(s.replace(/,/g, "")) : undefined);
const AMT = String.raw`\$?\s?(\d[\d,]*(?:\.\d+)?)`;

export function heuristicParsePolicy(text: string): Policy {
  const t = text.toLowerCase();
  const policy: Policy = { ...DEFAULT_POLICY, blockedCategories: [] };

  const perTxn =
    t.match(new RegExp(String.raw`(?:more than|over|above|max(?:imum)?(?: of)?|up to|at most)\s*${AMT}\s*(?:on|per|for|in)\s*(?:one|a single|any single|each|any|a)?\s*(?:purchase|order|item|transaction|thing)`)) ??
    t.match(new RegExp(String.raw`${AMT}\s*(?:per|each|a)\s*(?:purchase|order|transaction)`));
  if (perTxn) policy.perTransactionLimit = num(perTxn[1])!;

  const weekly =
    t.match(new RegExp(String.raw`${AMT}\s*(?:a|per|each|every)\s*week`)) ??
    t.match(new RegExp(String.raw`weekly[^.$\d]*${AMT}`));
  if (weekly) policy.weeklyLimit = num(weekly[1])!;

  const approval = t.match(
    new RegExp(String.raw`(?:ask|check with|confirm with|ping|notify) me (?:before|for|on) (?:anything|any purchase|purchases|orders|spending)?\s*(?:over|above|more than|of)\s*${AMT}`),
  );
  if (approval) policy.approvalThreshold = num(approval[1])!;

  const qty = t.match(/max(?:imum)?\s*(\d+)\s*(?:of|units|pieces|items)/) ?? t.match(/no more than\s*(\d+)\s*(?:of|units)/);
  if (qty) policy.maxQuantity = Number(qty[1]);

  for (const m of t.matchAll(/(?:^|[.;]\s*)(?:no|never buy|don't buy|do not buy|block|avoid)\s+([^.;]+)/g)) {
    const list = m[1]
      .split(/,|\bor\b|\band\b|\//)
      .map((s) => s.replace(/^(any|anything|with)\s+/, "").trim())
      .filter((s) => s && s.length < 30 && !/\d|\$|seller|merchant|more than/.test(s));
    policy.blockedCategories.push(...list);
  }
  policy.blockedCategories = [...new Set(policy.blockedCategories)];

  policy.reviewNewMerchants = /new (?:seller|merchant|store|shop)/.test(t);
  return policy;
}

const PolicySchema = z.object({
  perTransactionLimit: z.number().positive(),
  weeklyLimit: z.number().positive(),
  approvalThreshold: z.number().nonnegative(),
  blockedCategories: z.array(z.string()),
  maxQuantity: z.number().int().positive(),
  reviewNewMerchants: z.boolean(),
});

export async function parsePolicy(text: string): Promise<{ policy: Policy; parsedBy: "llm" | "heuristic" }> {
  const heuristic = heuristicParsePolicy(text);
  const llm = await llmJson(
    PolicySchema,
    "You convert a person's plain-English spending rules for their AI shopping agent into JSON. " +
      "Amounts are USD numbers. If a rule is not stated, use these defaults: " +
      JSON.stringify(DEFAULT_POLICY) +
      ". blockedCategories are short lowercase category names (e.g. \"alcohol\", \"gift cards\").",
    `Rules:\n"""${text}"""\nReturn JSON with keys perTransactionLimit, weeklyLimit, approvalThreshold, blockedCategories, maxQuantity, reviewNewMerchants.`,
  );
  if (!llm) return { policy: heuristic, parsedBy: "heuristic" };
  // Safety floor: blocked categories found by either parser are kept.
  return {
    policy: {
      currency: "USD",
      ...llm,
      blockedCategories: [...new Set([...llm.blockedCategories.map((c) => c.toLowerCase()), ...heuristic.blockedCategories])],
    },
    parsedBy: "llm",
  };
}
