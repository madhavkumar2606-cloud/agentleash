// The Countersign firewall: every purchase an AI agent wants to make is checked here
// before any money moves. Returns ALLOW / REVIEW / BLOCK with plain-English reasons.

import { merchantById, findProduct } from "../catalog";
import type { CheckResult, Decision, Policy, PurchaseProposal, Verdict } from "../types";
import { checkInjection } from "./injection";
import { checkIntent } from "./intent";

const SYNONYMS: Record<string, string[]> = {
  alcohol: ["alcohol", "wine", "beer", "liquor", "spirits", "whisky", "vodka"],
  "gift cards": ["gift card", "gift cards", "voucher", "vouchers"],
  "gift card": ["gift card", "gift cards", "voucher"],
  gambling: ["gambling", "casino", "betting", "lottery"],
  tobacco: ["tobacco", "cigarette", "vape"],
};

export function matchesBlocked(p: Pick<PurchaseProposal, "category" | "title">, blocked: string[]): string | undefined {
  const hay = `${p.category} ${p.title}`.toLowerCase();
  return blocked.find((b) => {
    const terms = SYNONYMS[b.toLowerCase()] ?? [b.toLowerCase(), b.toLowerCase().replace(/s$/, "")];
    return terms.some((t) => hay.includes(t));
  });
}

export function checkPolicy(p: PurchaseProposal, policy: Policy): CheckResult {
  const amount = p.unitPrice * p.quantity;
  const problems: string[] = [];
  const blocked = matchesBlocked(p, policy.blockedCategories);
  if (blocked) problems.push(`"${blocked}" is on your blocked list`);
  if (amount > policy.perTransactionLimit)
    problems.push(`$${amount.toFixed(2)} is over your $${policy.perTransactionLimit} per-purchase limit`);
  if (p.quantity > policy.maxQuantity) problems.push(`${p.quantity} units is over your max of ${policy.maxQuantity}`);
  if (problems.length)
    return { id: "policy", label: "Your rules", status: "fail", source: "rules", detail: cap(problems.join("; ")) + "." };
  if (amount >= policy.approvalThreshold)
    return {
      id: "policy",
      label: "Your rules",
      status: "warn",
      source: "rules",
      detail: `$${amount.toFixed(2)} is over $${policy.approvalThreshold}, so you asked to approve it yourself.`,
    };
  return { id: "policy", label: "Your rules", status: "pass", source: "rules", detail: "Within all of your spending rules." };
}

export function checkBudget(p: PurchaseProposal, policy: Policy, spent: number): CheckResult {
  const amount = p.unitPrice * p.quantity;
  const after = spent + amount;
  if (after > policy.weeklyLimit)
    return {
      id: "budget",
      label: "Weekly budget",
      status: "fail",
      source: "rules",
      detail: `Would bring this week's agent spending to $${after.toFixed(2)}, over your $${policy.weeklyLimit} weekly limit.`,
    };
  if (after > policy.weeklyLimit * 0.8)
    return {
      id: "budget",
      label: "Weekly budget",
      status: "warn",
      source: "rules",
      detail: `Uses most of your weekly budget ($${after.toFixed(2)} of $${policy.weeklyLimit}).`,
    };
  return {
    id: "budget",
    label: "Weekly budget",
    status: "pass",
    source: "rules",
    detail: `$${after.toFixed(2)} of $${policy.weeklyLimit} used this week after this purchase.`,
  };
}

export function checkMerchant(p: PurchaseProposal, policy: Policy, known: Set<string>): CheckResult {
  const m = merchantById(p.merchantId);
  if (!m)
    return {
      id: "merchant",
      label: "Seller trust",
      status: "warn",
      source: "rules",
      detail: `No payment history for "${p.merchantName}".`,
    };
  const pct = (m.disputeRate * 100).toFixed(1);
  if (m.disputeRate > 0.08 || (m.ageDays < 30 && m.rating < 3.5))
    return {
      id: "merchant",
      label: "Seller trust",
      status: "fail",
      source: "rules",
      detail: `${m.name} is risky: ${m.ageDays} days old, ${pct}% of payments disputed, rated ${m.rating}.`,
    };
  if (policy.reviewNewMerchants && !known.has(m.id))
    return {
      id: "merchant",
      label: "Seller trust",
      status: "warn",
      source: "rules",
      detail: `You haven't paid ${m.name} before, and you asked to check new sellers.`,
    };
  return {
    id: "merchant",
    label: "Seller trust",
    status: "pass",
    source: "rules",
    detail: `${m.name}: ${(m.ageDays / 365).toFixed(1)} years selling, ${pct}% disputes, rated ${m.rating}.`,
  };
}

export function checkPrice(p: PurchaseProposal): CheckResult {
  const product = findProduct(p.merchantId, p.title);
  if (!product)
    return { id: "price", label: "Fair price", status: "pass", source: "rules", detail: "No market price to compare against." };
  const ratio = p.unitPrice / product.marketPrice;
  if (ratio > 2)
    return {
      id: "price",
      label: "Fair price",
      status: "fail",
      source: "rules",
      detail: `$${p.unitPrice} is ${ratio.toFixed(1)}x the usual price (~$${product.marketPrice}).`,
    };
  if (ratio > 1.4)
    return {
      id: "price",
      label: "Fair price",
      status: "warn",
      source: "rules",
      detail: `$${p.unitPrice} is ${Math.round((ratio - 1) * 100)}% above the usual price (~$${product.marketPrice}).`,
    };
  return { id: "price", label: "Fair price", status: "pass", source: "rules", detail: `In line with the usual price (~$${product.marketPrice}).` };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Order in which failures are explained in the one-line summary (most important first).
const PRIORITY: CheckResult["id"][] = ["injection", "intent", "paypal", "refund", "policy", "price", "merchant", "budget"];

export function decide(
  checks: CheckResult[],
  p?: Pick<PurchaseProposal, "title" | "quantity"> & { action?: string },
): { verdict: Verdict; riskScore: number; summary: string } {
  const sorted = [...checks].sort((a, b) => PRIORITY.indexOf(a.id) - PRIORITY.indexOf(b.id));
  const fails = sorted.filter((c) => c.status === "fail");
  const warns = sorted.filter((c) => c.status === "warn");

  let risk = Math.min(100, fails.length * 30 + warns.length * 12);
  if (fails.some((c) => c.id === "injection")) risk = Math.max(risk, 95);

  if (fails.length) {
    const summary =
      fails[0].id === "injection"
        ? p?.action
          ? `Blocked: hidden instructions in a message hijacked the agent. It tried to ${p.action} instead of doing its task.`
          : `Blocked: a web page hijacked the agent with hidden instructions. It tried to buy ${p ? `${p.quantity} × ${p.title}` : "something else"} instead of doing your task.`
        : "Blocked: " + fails[0].detail;
    return { verdict: "BLOCK", riskScore: Math.max(risk, 60), summary };
  }
  if (warns.length) return { verdict: "REVIEW", riskScore: Math.max(risk, 25), summary: "Needs your approval: " + warns[0].detail };
  return { verdict: "ALLOW", riskScore: risk, summary: "Approved: matches your task and all of your rules." };
}

export async function evaluate(
  p: PurchaseProposal,
  ctx: { policy: Policy; weeklySpent: number; knownMerchants: Set<string>; mandateId: string; id: string },
): Promise<Decision> {
  const [injection, intent] = await Promise.all([checkInjection(p), checkIntent(p)]);
  const checks: CheckResult[] = [
    injection,
    intent,
    checkPolicy(p, ctx.policy),
    checkPrice(p),
    checkMerchant(p, ctx.policy, ctx.knownMerchants),
    checkBudget(p, ctx.policy, ctx.weeklySpent),
  ];
  const { verdict, riskScore, summary } = decide(checks, p);
  const now = new Date().toISOString();
  return {
    id: ctx.id,
    mandateId: ctx.mandateId,
    verdict,
    summary,
    riskScore,
    checks,
    proposal: p,
    amount: Math.round(p.unitPrice * p.quantity * 100) / 100,
    payment: { status: verdict === "REVIEW" ? "awaiting_owner" : "none" },
    createdAt: now,
    updatedAt: now,
  };
}
