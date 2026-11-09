import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckPill, PaymentChip, PayPalMark, usd, VerdictBadge } from "@/components/ui";
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

      <section className="mt-5 rounded-xl border border-line bg-card p-5">
        <p className="font-semibold">
          {p.quantity} × {p.title}
        </p>
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
        <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
          <VerdictBadge verdict={d.verdict} />
          <span className="text-xs text-muted">Risk {d.riskScore}/100</span>
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
