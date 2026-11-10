import Link from "next/link";
import { notFound } from "next/navigation";
import { FlowBar } from "@/components/FlowBar";
import HoldActions from "@/components/HoldActions";
import { PriceLine, Stamp } from "@/components/Receipt";
import { CheckPill, PaymentChip, PayPalMark, usd } from "@/components/ui";
import { getDecision } from "@/lib/store";
import ApproveActions from "./ApproveActions";

export const dynamic = "force-dynamic";

export default async function ApprovePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = getDecision(id);
  if (!d) notFound();
  const p = d.proposal;
  const flagged = d.checks.filter((c) => c.status !== "pass");

  return (
    <main className="mx-auto min-h-screen max-w-md px-5 pb-16 pt-8">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">Countersign · approval request</p>
      <h1 className="mt-2 text-2xl font-semibold leading-tight tracking-tight">
        {d.toolCall?.tool === "create_refund" ? (
          <>
            Your support agent wants to refund <span className="tabular-nums">{usd(d.amount)}</span>
          </>
        ) : d.toolCall ? (
          <>Your agent wants to run {d.toolCall.tool.replace(/_/g, " ")}</>
        ) : (
          <>
            Your agent wants to spend <span className="tabular-nums">{usd(d.amount)}</span>
          </>
        )}
      </h1>

      <section className="receipt-shadow mt-5">
        <div className="receipt px-5 pb-7 pt-7">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">{d.toolCall ? (d.toolCall.tool === "create_refund" ? "Refund check" : "PayPal action check") : "Purchase check"}</p>
            <p className="font-mono text-xs text-muted">#{d.id.slice(4, 12)} · risk {d.riskScore}/100</p>
          </div>
          <div className="-rotate-[8deg]">
            <Stamp verdict={["captured", "refunded", "approved", "authorized"].includes(d.payment.status) ? "ALLOW" : d.verdict} />
          </div>
        </div>
        <hr className="my-4 border-t-2 border-dashed border-line" />
        <PriceLine left={d.toolCall ? p.title : `${p.quantity} × ${p.title}`} right={usd(d.amount)} />
        <p className="text-sm text-muted">{p.merchantName}</p>
        <dl className="mt-4 space-y-3 text-sm">
          <div>
            <dt className="text-xs text-muted">Your task</dt>
            <dd>{p.task}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Why the agent chose this</dt>
            <dd>{p.agentReasoning}</dd>
          </div>
        </dl>
        <FlowBar verdict={d.verdict} payment={d.payment.status} amount={d.amount} />
        </div>
      </section>

      {flagged.length > 0 && (
        <section className="mt-4 rounded-xl border border-line bg-card p-5">
          <h2 className="text-sm font-semibold">What Countersign flagged</h2>
          <ul className="mt-3 space-y-3">
            {flagged.map((c) => (
              <li key={c.id} className="flex gap-3">
                <CheckPill status={c.status} />
                <p className="text-sm leading-snug">{c.detail}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6">
        {d.verdict === "REVIEW" && d.payment.status === "awaiting_owner" ? (
          <ApproveActions id={d.id} amount={d.amount} kind={d.toolCall ? (d.toolCall.tool === "create_refund" ? "refund" : "tool") : "purchase"} />
        ) : d.payment.status === "refunded" ? (
          <div className="rounded-xl bg-allow-bg p-5 text-allow">
            <p className="text-lg font-semibold">Refunded through PayPal ✓</p>
            <p className="mt-1 font-mono text-xs">Refund {d.payment.refundId}</p>
          </div>
        ) : d.payment.status === "approved" ? (
          <div className="rounded-xl bg-allow-bg p-5 text-allow">
            <p className="text-lg font-semibold">Approved ✓</p>
            <p className="mt-1 text-sm">The agent may now run this PayPal call once.</p>
          </div>
        ) : d.payment.status === "authorized" ? (
          <div className="space-y-3">
            <div className="rounded-xl bg-[#e6eefb] p-5 text-pp">
              <p className="text-lg font-semibold">PayPal is holding {usd(d.amount)}</p>
              <p className="mt-1 text-sm">Nothing has been paid yet. Release it when the item arrives, or cancel the hold.</p>
              <p className="mt-1 font-mono text-xs">Authorization {d.payment.authorizationId}</p>
            </div>
            <HoldActions id={d.id} amount={d.amount} />
          </div>
        ) : d.payment.status === "voided" ? (
          <div className="rounded-xl bg-line/50 p-5">
            <p className="text-lg font-semibold">Hold cancelled</p>
            <p className="mt-1 text-sm text-muted">PayPal released the hold. {usd(d.amount)} never left your account.</p>
          </div>
        ) : d.payment.status === "captured" ? (
          <div className="rounded-xl bg-allow-bg p-5 text-allow">
            <p className="text-lg font-semibold">Paid with PayPal ✓</p>
            <p className="mt-1 font-mono text-xs">Capture {d.payment.captureId}</p>
          </div>
        ) : d.verdict === "BLOCK" ? (
          <div className="rounded-xl bg-block-bg p-5 text-block">
            <p className="font-semibold">Blocked. No money moved.</p>
            <p className="mt-1 text-sm">{d.summary}</p>
          </div>
        ) : d.payment.status === "awaiting_payer" && d.payment.approveUrl ? (
          <a
            href={d.payment.approveUrl}
            className="block rounded-xl bg-[#ffc439] px-4 py-3.5 text-center font-semibold text-ink"
          >
            Continue to <PayPalMark />
          </a>
        ) : (
          <div className="flex items-center gap-2">
            <PaymentChip status={d.payment.status} />
            {d.payment.error && <span className="text-xs text-block">{d.payment.error}</span>}
          </div>
        )}
      </section>

      <Link href="/app" className="mt-8 inline-block text-sm text-muted underline underline-offset-2">
        Back to dashboard
      </Link>
    </main>
  );
}
