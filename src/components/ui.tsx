import type { CheckStatus, PaymentStatus, Verdict } from "@/lib/types";

export const usd = (n: number) => `$${n.toFixed(2)}`;

const VERDICT_STYLE: Record<Verdict, string> = {
  ALLOW: "bg-allow-bg text-allow ring-allow/25",
  REVIEW: "bg-review-bg text-review ring-review/25",
  BLOCK: "bg-block-bg text-block ring-block/25",
};
const VERDICT_TEXT: Record<Verdict, string> = { ALLOW: "Allowed", REVIEW: "Needs approval", BLOCK: "Blocked" };

export function VerdictBadge({ verdict, size = "sm" }: { verdict: Verdict; size?: "sm" | "lg" }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold ring-1 ring-inset ${VERDICT_STYLE[verdict]} ${
        size === "lg" ? "px-3.5 py-1.5 text-base" : "px-2.5 py-0.5 text-xs"
      }`}
    >
      <VerdictIcon verdict={verdict} />
      {VERDICT_TEXT[verdict]}
    </span>
  );
}

function VerdictIcon({ verdict }: { verdict: Verdict }) {
  const common = { width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 2, "aria-hidden": true };
  if (verdict === "ALLOW") return <svg {...common}><path d="M3 8.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (verdict === "REVIEW") return <svg {...common}><circle cx="8" cy="8" r="6" /><path d="M8 4.5V8l2 1.5" strokeLinecap="round" /></svg>;
  return <svg {...common}><circle cx="8" cy="8" r="6" /><path d="M4 12L12 4" strokeLinecap="round" /></svg>;
}

const CHECK_STYLE: Record<CheckStatus, { text: string; cls: string; sym: string }> = {
  pass: { text: "Pass", cls: "text-allow bg-allow-bg", sym: "✓" },
  warn: { text: "Flag", cls: "text-review bg-review-bg", sym: "!" },
  fail: { text: "Fail", cls: "text-block bg-block-bg", sym: "✕" },
};

export function CheckPill({ status }: { status: CheckStatus }) {
  const s = CHECK_STYLE[status];
  return (
    <span className={`inline-flex h-6 w-14 shrink-0 items-center justify-center gap-1 rounded-md text-xs font-semibold ${s.cls}`}>
      <span aria-hidden>{s.sym}</span>
      {s.text}
    </span>
  );
}

export const PAYMENT_TEXT: Record<PaymentStatus, string> = {
  none: "No payment",
  awaiting_owner: "Waiting for your approval",
  awaiting_payer: "Waiting for PayPal checkout",
  captured: "Paid via PayPal",
  refunded: "Refunded via PayPal",
  approved: "Approved: agent may proceed",
  authorized: "Held by PayPal until delivery",
  voided: "Hold cancelled, nothing paid",
  rejected: "Declined",
  failed: "Payment failed",
};

export function PaymentChip({ status }: { status: PaymentStatus }) {
  const cls =
    status === "captured" || status === "refunded" || status === "authorized"
      ? "text-pp bg-[#e6eefb]"
      : status === "failed" || status === "rejected" || status === "voided"
        ? "text-muted bg-line/60"
        : status === "none"
          ? "text-muted"
          : "text-review bg-review-bg";
  return <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${cls}`}>{PAYMENT_TEXT[status]}</span>;
}

export function PayPalMark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-bold italic tracking-tight ${className}`}>
      <span className="text-pp">Pay</span>
      <span className="text-pp-light">Pal</span>
    </span>
  );
}
