"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Scenario } from "@/lib/agent";
import type { AgentStep, Decision, Mandate } from "@/lib/types";
import { QrCode } from "./QrCode";
import { CheckPill, PaymentChip, PayPalMark, usd, VerdictBadge } from "./ui";

interface AppState {
  mandate: Mandate;
  decisions: Decision[];
  weeklySpent: number;
  scenarios: Scenario[];
  modes: { paypal: "mock" | "sandbox"; llm: string; model: string };
}

interface Run {
  scenario: Pick<Scenario, "id" | "label" | "task">;
  steps: AgentStep[];
  decisionId: string | null;
  agentMode: "live" | "scripted";
  profile?: "careful" | "naive";
}

const STEP_LABEL: Record<AgentStep["kind"], string> = {
  goal: "Task",
  search: "Search",
  open: "Open",
  read: "Read",
  think: "Think",
  propose: "Wants to pay",
};

export default function Dashboard() {
  const [data, setData] = useState<AppState>();
  const [run, setRun] = useState<Run>();
  const [shown, setShown] = useState(0);
  const [busy, setBusy] = useState<string>();
  const [rules, setRules] = useState("");
  const [savingRules, setSavingRules] = useState(false);
  const [error, setError] = useState<string>();
  const [origin, setOrigin] = useState("");
  const [live, setLive] = useState(true);
  const [customTask, setCustomTask] = useState("");
  const rulesTouched = useRef(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/state", { cache: "no-store" });
    if (!res.ok) return;
    const next: AppState = await res.json();
    setData(next);
    if (!rulesTouched.current) setRules(next.mandate.rulesText);
  }, []);

  useEffect(() => {
    setOrigin(window.location.origin);
    refresh();
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
  }, [refresh]);

  // Reveal the agent trace one step at a time, then the firewall decision.
  useEffect(() => {
    if (!run || shown > run.steps.length) return;
    const t = setTimeout(() => setShown((n) => n + 1), shown === 0 ? 150 : 420);
    return () => clearTimeout(t);
  }, [run, shown]);

  async function runAgent(input: { scenario: string } | { task: string }) {
    setBusy("scenario" in input ? input.scenario : "custom");
    setError(undefined);
    setRun(undefined);
    setShown(0);
    try {
      const res = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, live }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Run failed");
      setRun({
        scenario: body.scenario,
        steps: body.steps,
        decisionId: body.decision?.id ?? null,
        agentMode: body.agentMode,
        profile: body.profile,
      });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  }

  async function saveRules() {
    setSavingRules(true);
    setError(undefined);
    try {
      const res = await fetch("/api/mandate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rulesText: rules }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not save rules");
      rulesTouched.current = false;
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingRules(false);
    }
  }

  async function reset() {
    await fetch("/api/reset", { method: "POST" });
    rulesTouched.current = false;
    setRun(undefined);
    await refresh();
  }

  if (!data) {
    return <main className="grid min-h-screen place-items-center text-muted">Loading AgentLeash…</main>;
  }

  const decision = run?.decisionId ? data.decisions.find((d) => d.id === run.decisionId) : undefined;
  const hasLlm = data.modes.llm !== "mock";
  const traceDone = run ? shown > run.steps.length : false;
  const p = data.mandate.policy;
  const spentPct = Math.min(100, (data.weeklySpent / p.weeklyLimit) * 100);
  const blockedCount = data.decisions.filter((d) => d.verdict === "BLOCK").length;
  const savedAmount = data.decisions.filter((d) => d.verdict === "BLOCK").reduce((s, d) => s + d.amount, 0);

  return (
    <main className="mx-auto max-w-7xl px-5 pb-20 pt-6 sm:px-8">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-5">
        <div className="flex items-center gap-3">
          <Logo />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">AgentLeash</h1>
            <p className="text-sm text-muted">
              A firewall between your AI agents and your <PayPalMark /> account.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <ModeBadge label="PayPal" value={data.modes.paypal === "sandbox" ? "Sandbox" : "Mock"} live={data.modes.paypal === "sandbox"} />
          <ModeBadge label="AI checks" value={data.modes.llm === "mock" ? "Heuristic" : data.modes.model} live={data.modes.llm !== "mock"} />
          <button onClick={reset} className="rounded-md px-2.5 py-1 font-medium text-muted hover:bg-line/60 hover:text-ink">
            Reset demo
          </button>
        </div>
      </header>

      {error && (
        <div role="alert" className="mt-4 rounded-lg bg-block-bg px-4 py-3 text-sm text-block">
          {error}
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[340px_1fr]">
        {/* Left: owner's rules + spend */}
        <aside className="space-y-6">
          <section className="rounded-xl border border-line bg-card p-5">
            <h2 className="text-sm font-semibold">Your rules</h2>
            <p className="mt-1 text-xs text-muted">Plain English. AgentLeash turns them into checks.</p>
            <label htmlFor="rules" className="sr-only">
              Spending rules for your AI agents
            </label>
            <textarea
              id="rules"
              value={rules}
              onChange={(e) => {
                rulesTouched.current = true;
                setRules(e.target.value);
              }}
              rows={6}
              className="mt-3 w-full resize-y rounded-lg border border-line bg-paper p-3 text-sm leading-relaxed outline-none focus:border-ink"
            />
            <button
              onClick={saveRules}
              disabled={savingRules || rules.trim().length < 5}
              className="mt-2 w-full rounded-lg bg-ink px-3 py-2 text-sm font-medium text-paper disabled:opacity-50"
            >
              {savingRules ? "Saving rules…" : "Save rules"}
            </button>

            <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
              <Rule k="Per purchase" v={`≤ $${p.perTransactionLimit}`} />
              <Rule k="Per week" v={`≤ $${p.weeklyLimit}`} />
              <Rule k="Ask me over" v={`$${p.approvalThreshold}`} />
              <Rule k="Max quantity" v={String(p.maxQuantity)} />
              <Rule k="New sellers" v={p.reviewNewMerchants ? "Ask me" : "Allowed"} />
              <Rule k="Parsed by" v={data.mandate.parsedBy === "llm" ? "AI" : "Rules engine"} />
            </dl>
            {p.blockedCategories.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {p.blockedCategories.map((c) => (
                  <span key={c} className="rounded-md bg-block-bg px-2 py-0.5 text-xs font-medium text-block">
                    No {c}
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-line bg-card p-5">
            <h2 className="text-sm font-semibold">This week</h2>
            <p className="mt-2 text-2xl font-semibold tabular-nums">
              {usd(data.weeklySpent)} <span className="text-sm font-normal text-muted">of ${p.weeklyLimit}</span>
            </p>
            <div
              className="mt-2 h-2 overflow-hidden rounded-full bg-line"
              role="progressbar"
              aria-valuenow={Math.round(spentPct)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Weekly agent spending"
            >
              <div className="h-full rounded-full bg-ink transition-all" style={{ width: `${spentPct}%` }} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted">Purchases blocked</p>
                <p className="font-semibold tabular-nums">{blockedCount}</p>
              </div>
              <div>
                <p className="text-xs text-muted">Money protected</p>
                <p className="font-semibold tabular-nums text-allow">{usd(savedAmount)}</p>
              </div>
            </div>
          </section>
        </aside>

        {/* Right: run the agent */}
        <div className="space-y-6">
          <section>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold">Run the shopping agent</h2>
                <p className="text-xs text-muted">Each scenario is a different way an agent can go wrong.</p>
              </div>
              <label className={`inline-flex items-center gap-2 text-xs ${hasLlm ? "" : "opacity-50"}`}>
                <input
                  type="checkbox"
                  checked={hasLlm && live}
                  disabled={!hasLlm}
                  onChange={(e) => setLive(e.target.checked)}
                  className="h-4 w-4 accent-ink"
                />
                <span>
                  Live AI agent{" "}
                  <span className="text-muted">{hasLlm ? "(a real model decides)" : "(add an AI key to enable)"}</span>
                </span>
              </label>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {data.scenarios.map((s) => (
                <button
                  key={s.id}
                  onClick={() => runAgent({ scenario: s.id })}
                  disabled={!!busy}
                  className={`group flex flex-col items-start justify-start rounded-xl border bg-card p-4 text-left transition hover:-translate-y-0.5 hover:border-ink disabled:opacity-60 ${
                    run?.scenario.id === s.id ? "border-ink" : "border-line"
                  }`}
                >
                  <p className="text-sm font-semibold">{busy === s.id ? "Running…" : s.label}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{s.blurb}</p>
                </button>
              ))}
            </div>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (customTask.trim().length >= 5) runAgent({ task: customTask.trim() });
              }}
            >
              <label htmlFor="task" className="sr-only">
                Give the agent your own task
              </label>
              <input
                id="task"
                value={customTask}
                onChange={(e) => setCustomTask(e.target.value)}
                disabled={!hasLlm || !!busy}
                placeholder={hasLlm ? "Or give the agent your own task, e.g. \"Get my dad a planter under $40\"" : "Custom tasks need an AI key (LLM_PROVIDER + LLM_API_KEY)"}
                className="min-w-0 flex-1 rounded-lg border border-line bg-card px-3 py-2 text-sm outline-none focus:border-ink disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={!hasLlm || !!busy || customTask.trim().length < 5}
                className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-50"
              >
                {busy === "custom" ? "Running…" : "Run"}
              </button>
            </form>
          </section>

          {!run && (
            <section className="rounded-xl border border-dashed border-line p-10 text-center">
              <p className="font-medium">Pick a scenario to watch the agent shop.</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted">
                The agent browses a store and asks to pay. AgentLeash checks the purchase against your task and rules
                before PayPal moves any money. Try <strong>Hijacked by a web page</strong> first.
              </p>
            </section>
          )}

          {run && (
            <div className="grid gap-6 xl:grid-cols-2">
              {/* Agent trace */}
              <section className="rounded-xl border border-line bg-ink p-5 text-paper">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold">
                    {run.agentMode === "live" ? "Live AI agent" : "Scripted demo agent"}
                    {run.profile && (
                      <span className="ml-2 whitespace-nowrap rounded bg-paper/15 px-1.5 py-0.5 text-[11px] font-medium text-paper/80">
                        {run.profile === "naive" ? "naive (simulated weak agent)" : "careful"}
                      </span>
                    )}
                  </h2>
                  <span className="font-mono text-xs text-paper/60">{traceDone ? "waiting for firewall" : "browsing…"}</span>
                </div>
                <ol className="mt-4 space-y-3 font-mono text-[13px] leading-relaxed">
                  {run.steps.slice(0, shown).map((s, i) => (
                    <li key={i} className="rise flex gap-3">
                      <span className={`w-24 shrink-0 text-xs uppercase tracking-wide ${s.kind === "propose" ? "text-[#f5c26b]" : "text-paper/50"}`}>
                        {STEP_LABEL[s.kind]}
                      </span>
                      <span className={s.tainted ? "rounded bg-block/25 px-1.5 py-0.5 text-[#ffb4a9]" : ""}>
                        <TaintedText text={s.text} tainted={!!s.tainted} />
                      </span>
                    </li>
                  ))}
                </ol>
              </section>

              {/* Firewall decision */}
              <section className="rounded-xl border border-line bg-card p-5" aria-live="polite">
                {traceDone && !run.decisionId ? (
                  <div className="grid h-full min-h-48 place-items-center text-center text-sm text-muted">
                    The agent decided not to buy anything, so there was nothing to check.
                  </div>
                ) : !traceDone || !decision ? (
                  <div className="grid h-full min-h-48 place-items-center text-sm text-muted">Checking purchase…</div>
                ) : (
                  <DecisionCard d={decision} origin={origin} />
                )}
              </section>
            </div>
          )}

          {/* Audit log */}
          <section className="rounded-xl border border-line bg-card">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="text-sm font-semibold">Audit log</h2>
              <p className="text-xs text-muted">Every purchase any agent attempted</p>
            </div>
            {data.decisions.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted">No purchases yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-muted">
                    <tr>
                      <th className="px-5 py-2 font-medium">Time</th>
                      <th className="px-3 py-2 font-medium">Purchase</th>
                      <th className="px-3 py-2 text-right font-medium">Amount</th>
                      <th className="px-3 py-2 font-medium">Verdict</th>
                      <th className="px-3 py-2 font-medium">Payment</th>
                      <th className="px-5 py-2 font-medium">Why</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.decisions.map((d) => (
                      <tr key={d.id} className="border-t border-line align-top">
                        <td className="whitespace-nowrap px-5 py-3 tabular-nums text-muted">
                          {new Date(d.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </td>
                        <td className="px-3 py-3">
                          <p className="font-medium">
                            {d.proposal.quantity} × {d.proposal.title}
                          </p>
                          <p className="text-xs text-muted">{d.proposal.merchantName}</p>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">{usd(d.amount)}</td>
                        <td className="px-3 py-3">
                          <VerdictBadge verdict={d.verdict} />
                        </td>
                        <td className="px-3 py-3">
                          {d.payment.status === "awaiting_owner" ? (
                            <a href={`/approve/${d.id}`} className="text-xs font-medium text-review underline underline-offset-2">
                              Review now
                            </a>
                          ) : (
                            <PaymentChip status={d.payment.status} />
                          )}
                        </td>
                        <td className="max-w-sm px-5 py-3 text-xs leading-relaxed text-muted">{d.summary}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

function DecisionCard({ d, origin }: { d: Decision; origin: string }) {
  const approveUrl = `${origin}/approve/${d.id}`;
  return (
    <div className="rise">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">AgentLeash verdict</p>
          <div className="mt-2">
            <VerdictBadge verdict={d.verdict} size="lg" />
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted">Risk</p>
          <p className={`text-2xl font-semibold tabular-nums ${d.riskScore >= 60 ? "text-block" : d.riskScore >= 25 ? "text-review" : "text-allow"}`}>
            {d.riskScore}
            <span className="text-sm font-normal text-muted">/100</span>
          </p>
        </div>
      </div>

      <p className="mt-3 text-[15px] font-medium leading-snug">{d.summary}</p>
      <p className="mt-1 text-sm text-muted">
        {d.proposal.quantity} × {d.proposal.title} · {d.proposal.merchantName} · <span className="tabular-nums">{usd(d.amount)}</span>
      </p>

      <ul className="mt-4 divide-y divide-line border-y border-line">
        {d.checks.map((c) => (
          <li key={c.id} className="flex gap-3 py-2.5">
            <CheckPill status={c.status} />
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {c.label}
                {c.source === "llm" && <span className="ml-2 rounded bg-line/70 px-1.5 py-px text-[10px] font-semibold text-muted">AI</span>}
              </p>
              <p className="text-xs leading-relaxed text-muted">{c.detail}</p>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-4">
        {d.verdict === "BLOCK" && (
          <p className="text-sm text-muted">
            No PayPal order was created. <span className="font-medium text-ink">{usd(d.amount)}</span> never left your account.
          </p>
        )}
        {d.verdict === "ALLOW" && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <PaymentChip status={d.payment.status} />
            {d.payment.orderId && <span className="font-mono text-xs text-muted">Order {d.payment.orderId}</span>}
            {d.payment.status === "awaiting_payer" && d.payment.approveUrl && (
              <a href={d.payment.approveUrl} className="font-medium text-pp-light underline underline-offset-2">
                Complete PayPal checkout
              </a>
            )}
            {d.payment.error && <span className="text-xs text-block">{d.payment.error}</span>}
          </div>
        )}
        {d.verdict === "REVIEW" && (
          <div className="flex items-center gap-4 rounded-lg bg-review-bg/60 p-3">
            {d.payment.status === "awaiting_owner" ? (
              <>
                <QrCode value={approveUrl} size={104} />
                <div className="text-sm">
                  <p className="font-medium">Scan to approve on your phone</p>
                  <p className="mt-1 text-xs text-muted">Or open the approval page here:</p>
                  <a href={`/approve/${d.id}`} className="mt-2 inline-block rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-paper">
                    Review purchase
                  </a>
                </div>
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <PaymentChip status={d.payment.status} />
                {d.payment.orderId && <span className="font-mono text-xs text-muted">Order {d.payment.orderId}</span>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Shows page text, with the hidden <span> payload stripped of markup and highlighted. */
function TaintedText({ text, tainted }: { text: string; tainted: boolean }) {
  if (!tainted) return <>{text}</>;
  const m = text.match(/<span[^>]*>([\s\S]*?)<\/span>/);
  if (!m) return <>{text}</>;
  const [before, after] = text.split(m[0]);
  return (
    <>
      {before}
      <span className="mt-1 block rounded border border-[#ffb4a9]/40 p-2 text-[#ffd7d0]">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[#ff8a7a]">Hidden on page (display:none)</span>
        {m[1]}
      </span>
      {after.replace(/​/g, "")}
    </>
  );
}

function Rule({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-md bg-paper px-2.5 py-1.5">
      <dt className="text-muted">{k}</dt>
      <dd className="font-semibold tabular-nums">{v}</dd>
    </div>
  );
}

function ModeBadge({ label, value, live }: { label: string; value: string; live: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-card px-2 py-1">
      <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-allow" : "bg-review"}`} aria-hidden />
      <span className="text-muted">{label}:</span>
      <span className="font-medium">{value}</span>
    </span>
  );
}

function Logo() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden>
      <rect width="36" height="36" rx="9" fill="#16150f" />
      <path d="M11 13.5c0-3 2.4-5.5 5.5-5.5S22 10.5 22 13.5V16" stroke="#f6f4ef" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <rect x="8.5" y="16" width="16" height="12" rx="3" fill="#f6f4ef" />
      <circle cx="16.5" cy="22" r="1.8" fill="#16150f" />
      <path d="M24.5 22h3.5" stroke="#0070e0" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}
