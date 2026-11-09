import Link from "next/link";
import { notFound } from "next/navigation";
import { FlowBar } from "@/components/FlowBar";
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
      <p className="text-xs font-medium uppercase tracking-wide text-muted">AgentLeash · purchase request</p>
      <h1 className="mt-2 text-2xl font-semibold leading-tight tracking-tight">
        Your agent wants to spend <span className="tabular-nums">{usd(d.amount)}</span>
      </h1>

      <section className="receipt-shadow mt-5">
        <div className="receipt px-5 pb-7 pt-7">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Purchase check</p>
            <p className="font-mono text-xs text-muted">#{d.id.slice(4, 12)} · risk {d.riskScore}/100</p>
          </div>
          <div className="-rotate-[8deg]">
            <Stamp verdict={d.payment.status === "captured" ? "ALLOW" : d.verdict} />
          </div>
        </div>
        <hr className="my-4 border-t-2 border-dashed border-line" />
        <PriceLine left={`${p.quantity} × ${p.title}`} right={usd(d.amount)} />
        <p className="text-sm text-muted">{p.merchantName}</p>
        <dl className="mt-4 space-y-3 text-sm">
          <div>
            <dt className="text-xs text-muted">Your task</dt>
            <dd>{p.task}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Why the agent picked it</dt>
            <dd>{p.agentReasoning}</dd>
          </div>
        </dl>
        <FlowBar verdict={d.verdict} payment={d.payment.status} amount={d.amount} />
        </div>
      </section>

      {flagged.length > 0 && (
        <section className="mt-4 rounded-xl border border-line bg-card p-5">
          <h2 className="text-sm font-semibold">What AgentLeash flagged</h2>
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
          <ApproveActions id={d.id} amount={d.amount} />
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
