// Shared domain types for Countersign.

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
  /** Refunds at or above this amount need the owner's approval (merchant side). */
  refundApprovalThreshold: number;
  /** Hard cap for a single refund. */
  maxRefund: number;
  /** Cap on all agent-issued refunds in one day. */
  dailyRefundLimit: number;
  /** Pay with a PayPal authorization hold; money moves only when the owner confirms delivery. */
  holdUntilDelivered: boolean;
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
  id: "policy" | "budget" | "intent" | "injection" | "merchant" | "price" | "paypal" | "refund" | "freeze";
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
  | "refunded"
  | "approved"
  | "authorized"
  | "voided"
  | "rejected"
  | "failed";

export interface PaymentInfo {
  status: PaymentStatus;
  orderId?: string;
  approveUrl?: string;
  captureId?: string;
  refundId?: string;
  /** "AUTHORIZE" when the payment is held by PayPal until delivery. */
  intent?: "CAPTURE" | "AUTHORIZE";
  authorizationId?: string;
  /** When PayPal started holding the money (for the automatic release of stale holds). */
  authorizedAt?: string;
  /** Set when the hold was cancelled automatically because delivery was never confirmed. */
  autoVoided?: boolean;
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
  /** For purchases: what the agent wants to buy. For PayPal tool calls: a display summary of the call. */
  proposal: PurchaseProposal;
  /** Set when this decision is about a PayPal MCP tool call (e.g. create_refund) rather than a purchase. */
  toolCall?: { tool: string; args: Record<string, unknown>; context?: string };
  amount: number;
  payment: PaymentInfo;
  /** Owner actions on this decision signed by a pinned device, newest last. */
  countersigns?: { action: string; deviceId: string; label: string; fingerprint: string; at: string }[];
  /** Verified PayPal webhook events about this payment, oldest first. */
  paypalEvents?: { id: string; type: string; at: string; summary: string }[];
  /** A buyer opened a dispute on this payment (from a verified webhook). */
  dispute?: { id: string; reason?: string; status?: string; at: string };
  createdAt: string;
  updatedAt: string;
}

export interface AgentStep {
  kind: "goal" | "search" | "open" | "read" | "think" | "propose" | "tool";
  text: string;
  /** Marks text the agent read that contained a hidden instruction (for the demo trace). */
  tainted?: boolean;
}

/** PayPal MCP / Agent Toolkit tool names that move money. Everything else is read-only. */
export const GUARDED_TOOLS = [
  "create_refund",
  "pay_order",
  "create_order",
  "accept_dispute_claim",
  "send_invoice",
  "cancel_sent_invoice",
  "create_subscription",
  "cancel_subscription",
] as const;
export type GuardedTool = (typeof GUARDED_TOOLS)[number];

/** A money-moving PayPal tool call an agent wants to make, checked before it runs. */
export interface ToolCallProposal {
  agentId: string;
  tool: string;
  /** The tool's arguments, exactly as the agent would send them to PayPal. */
  args: Record<string, unknown>;
  /** The job the agent was given, e.g. "Resolve support ticket #4812". */
  task: string;
  /** Untrusted text the agent read: emails, tickets, chat, web pages. Scanned for injection. */
  context?: string;
  agentReasoning: string;
}

