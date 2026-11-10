// "Ask your audit log": turns a plain-English question into AG Grid filters and sorting.
// Gemini returns a constrained JSON plan; a rules parser is the fallback (and runs without an AI key).

import { z } from "zod";
import { llmConfig } from "./config";
import { llmJson } from "./llm";

export const AUDIT_COLUMNS = ["kind", "verdict", "amount", "risk", "agent", "action", "payment", "why"] as const;
const OPS = ["contains", "equals", "greaterThan", "lessThan", "greaterThanOrEqual", "lessThanOrEqual"] as const;

export const AuditPlan = z.object({
  filters: z
    .array(z.object({ column: z.enum(AUDIT_COLUMNS), op: z.enum(OPS), value: z.union([z.string().max(80), z.number()]) }))
    .max(5),
  sort: z.object({ column: z.enum(AUDIT_COLUMNS), dir: z.enum(["asc", "desc"]) }).nullable(),
  explanation: z.string().max(200),
});
export type AuditPlan = z.infer<typeof AuditPlan> & { by: "ai" | "rules" };

const SCHEMA_HELP = [
  "Columns and values:",
  '- kind: "Purchase", "Refund" or "PayPal action"',
  '- verdict: "Allowed", "Needs approval" or "Blocked"',
  "- amount: dollars (number)",
  "- risk: 0-100 (number)",
  '- agent: agent id text, e.g. "shopping-agent", "support-agent", "mcp-agent"',
  "- action: what the agent tried, e.g. \"Refund $500.00 on payment ...\" or \"1 × Garden Gift eCard\"",
  '- payment: e.g. "Paid via PayPal", "Refunded via PayPal", "No payment", "Waiting for your approval"',
  '- why: AgentLeash\'s one-line reason, e.g. "Blocked: hidden instructions in a message hijacked the agent..."',
].join("\n");

export async function planAuditQuery(question: string): Promise<AuditPlan> {
  if (llmConfig().provider !== "mock") {
    const out = await llmJson(
      AuditPlan,
      "You turn a shop owner's question about their AI agents' payment audit log into grid filters and sorting. Use only the columns listed. " +
        "Use contains for text, number ops for amount and risk. If the question can't be answered with filters, return no filters and say so in explanation.",
      `${SCHEMA_HELP}\n\nQuestion: ${question}\n\nReturn JSON: {"filters": [{"column", "op", "value"}], "sort": {"column", "dir"} | null, "explanation": "one short sentence describing what is shown"}`,
    );
    if (out) return { ...out, by: "ai" };
  }
  return { ...rulesPlan(question), by: "rules" };
}

/** Keyword fallback. Handles the common questions without an AI call. */
export function rulesPlan(q: string): z.infer<typeof AuditPlan> {
  const t = q.toLowerCase();
  const filters: z.infer<typeof AuditPlan>["filters"] = [];
  const said: string[] = [];
  const add = (f: z.infer<typeof AuditPlan>["filters"][number], what: string) => {
    filters.push(f);
    said.push(what);
  };
  if (/\bblock/.test(t)) add({ column: "verdict", op: "equals", value: "Blocked" }, "blocked");
  else if (/held|approv|review|waiting/.test(t)) add({ column: "verdict", op: "equals", value: "Needs approval" }, "held for approval");
  else if (/allowed|went through|succeeded/.test(t)) add({ column: "verdict", op: "equals", value: "Allowed" }, "allowed");
  if (/refund/.test(t)) add({ column: "kind", op: "equals", value: "Refund" }, "refunds");
  else if (/purchase|bought|buy|order/.test(t)) add({ column: "kind", op: "equals", value: "Purchase" }, "purchases");
  if (/inject|hijack|hidden|trick|attack/.test(t)) add({ column: "why", op: "contains", value: "hidden" }, "caused by hidden instructions");
  if (/gift ?card/.test(t)) add({ column: "action", op: "contains", value: "Gift" }, "for gift cards");
  const over = t.match(/(?:over|above|more than|greater than|>)\s*\$?(\d+(?:\.\d+)?)/);
  const under = t.match(/(?:under|below|less than|<)\s*\$?(\d+(?:\.\d+)?)/);
  if (over) add({ column: "amount", op: "greaterThan", value: Number(over[1]) }, `over $${over[1]}`);
  if (under) add({ column: "amount", op: "lessThan", value: Number(under[1]) }, `under $${under[1]}`);
  let sort: z.infer<typeof AuditPlan>["sort"] = null;
  if (/biggest|largest|highest|most expensive|top/.test(t)) sort = { column: "amount", dir: "desc" };
  else if (/risk/.test(t)) sort = { column: "risk", dir: "desc" };
  const verdict = filters.find((f) => f.column === "verdict")?.value;
  const kind = filters.find((f) => f.column === "kind")?.value;
  const noun = kind === "Refund" ? "refunds" : kind === "Purchase" ? "purchases" : "attempts";
  const adj = verdict === "Blocked" ? "blocked " : verdict === "Allowed" ? "allowed " : "";
  const extra = said.filter((w) => !["blocked", "allowed", "refunds", "purchases"].includes(w));
  const head = verdict === "Needs approval" ? `${noun} waiting for your approval` : `${adj}${noun}`;
  const order = sort ? `, ${sort.column === "amount" ? "largest" : "riskiest"} first` : "";
  return {
    filters,
    sort,
    explanation:
      filters.length || sort
        ? `Showing ${head}${extra.filter((w) => w !== "held for approval").map((w) => ` ${w}`).join(",")}${order}.`
        : 'I couldn\'t turn that into a filter. Try "blocked refunds over $50".',
  };
}
