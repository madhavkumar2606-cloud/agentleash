// Shared domain types for AgentLeash.

export type Currency = "USD";

/** Structured spending policy, parsed from the owner's plain-English rules. */
export interface Policy {
  currency: Currency;
  /** Hard cap for a single purchase. */
  perTransactionLimit: number;
  /** Rolling 7-day cap across all agent purchases. */
  weeklyLimit: number;
  /** Purchases at or above this amount always need the owner's approval. */
  approvalThreshold: number;
  /** Categories the agent may never buy (e.g. "alcohol", "gift cards"). */
  blockedCategories: string[];
  /** Max units of one item in a single purchase. */
  maxQuantity: number;
  /** Ask the owner before paying a merchant the agent hasn't paid before. */
  reviewNewMerchants: boolean;
}

/** The owner's standing rules for every agent purchase. */
export interface Mandate {
  id: string;
  /** Owner's rules in plain English. */
  rulesText: string;
  /** Rules parsed into a structured policy. */
  policy: Policy;
  /** How the policy was parsed. */
  parsedBy: "llm" | "heuristic";
  createdAt: string;
}

/** A purchase an AI agent wants to make, submitted to the firewall before payment. */
export interface PurchaseProposal {
  agentId: string;
  /** The task the owner gave the agent, e.g. "Buy a birthday gift for my mom…". */
  task: string;
  merchantId: string;
  merchantName: string;
  productId: string;
  title: string;
  category: string;
  unitPrice: number;
  quantity: number;
  currency: Currency;
  productUrl?: string;
  /** The agent's own explanation of why it chose this purchase. */
  agentReasoning: string;
  /** Raw text of the page(s) the agent read before deciding. Scanned for injection. */
  pageContent?: string;
}

export type CheckStatus = "pass" | "warn" | "fail";

export interface CheckResult {
  id: "policy" | "budget" | "intent" | "injection" | "merchant" | "price";
  label: string;
  status: CheckStatus;
  detail: string;
  /** Which engine produced this result. */
  source: "rules" | "llm" | "heuristic";
}

export type Verdict = "ALLOW" | "REVIEW" | "BLOCK";

export type PaymentStatus =
  | "none"
  | "awaiting_owner"
  | "awaiting_payer"
  | "captured"
  | "rejected"
  | "failed";

export interface PaymentInfo {
  status: PaymentStatus;
  orderId?: string;
  approveUrl?: string;
  captureId?: string;
  error?: string;
}

/** The firewall's decision on one proposal. Also the audit-log entry. */
export interface Decision {
  id: string;
  mandateId: string;
  verdict: Verdict;
  /** One plain-English line explaining the verdict. */
  summary: string;
  /** 0 (safe) – 100 (dangerous). */
  riskScore: number;
  checks: CheckResult[];
  proposal: PurchaseProposal;
  amount: number;
  payment: PaymentInfo;
  createdAt: string;
  updatedAt: string;
}

export interface AgentStep {
  kind: "goal" | "search" | "open" | "read" | "think" | "propose";
  text: string;
  /** Marks text the agent read that contained a hidden instruction (for the demo trace). */
  tainted?: boolean;
}
