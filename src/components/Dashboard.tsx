"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Scenario } from "@/lib/agent";
import type { AgentStep, Decision, Mandate } from "@/lib/types";
import { FlowBar } from "./FlowBar";
import { QrCode } from "./QrCode";
import RedTeam from "./RedTeam";

const AuditGrid = dynamic(() => import("./AuditGrid"), { ssr: false });
import { PriceLine, RiskDial, ScenarioIcon, SpendRing, Stamp } from "./Receipt";
import { CheckPill, PaymentChip, PayPalMark, usd } from "./ui";

interface AppState {
  mandate: Mandate;
  decisions: Decision[];
  weeklySpent: number;
  frozenAt: string | null;
  scenarios: Scenario[];
  supportScenarios: { id: string; label: string; blurb: string; expected: string }[];
  modes: { paypal: "mock" | "sandbox"; llm: string; model: string; auth: "open" | "locked" | "misconfigured" };
}

interface Run {
  scenario: Pick<Scenario, "id" | "label" | "task" | "trapProductId"> & { trapAmount?: number };
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
  tool: "PayPal tool",
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
  const [mode, setMode] = useState<"shop" | "support" | "redteam">("shop");
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

  async function runAgent(input: { scenario: string } | { task: string } | { support: string }) {
    setBusy("scenario" in input ? input.scenario : "support" in input ? input.support : "custom");
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

  async function setFrozen(frozen: boolean) {
    await fetch("/api/freeze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ frozen }) });
    await refresh();
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
  const blockedCount = data.decisions.filter((d) => d.verdict === "BLOCK").length;
  const savedAmount = data.decisions.filter((d) => d.verdict === "BLOCK").reduce((s, d) => s + d.amount, 0);

  return (
    <main className="mx-auto max-w-7xl px-5 pb-20 pt-6 sm:px-8">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-5">
        <Link href="/" className="flex items-center gap-3 rounded-md">
          <Logo />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">AgentLeash</h1>
            <p className="text-sm text-muted">
              A firewall between your AI agents and your <PayPalMark /> account.
            </p>
          </div>
        </Link>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <ModeBadge label="PayPal" value={data.modes.paypal === "sandbox" ? "Sandbox" : "Mock"} live={data.modes.paypal === "sandbox"} />
          <ModeBadge label="AI checks" value={data.modes.llm === "mock" ? "Heuristic" : data.modes.model} live={data.modes.llm !== "mock"} />
          {!data.frozenAt && (
            <button
              onClick={() => setFrozen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-block/40 px-2.5 py-1 font-semibold text-block hover:bg-block-bg"
            >
              <StopIcon />
              Freeze all agents
            </button>
          )}
          <button onClick={reset} className="rounded-md px-2.5 py-1 font-medium text-muted hover:bg-line/60 hover:text-ink">
            Reset demo
          </button>
          {data.modes.auth === "locked" && (
            <button
              onClick={async () => {
                await fetch("/api/logout", { method: "POST" });
                window.location.href = "/login";
              }}
              className="rounded-md px-2.5 py-1 font-medium text-muted hover:bg-line/60 hover:text-ink"
            >
              Log out
            </button>
          )}
        </div>
      </header>

      {data.frozenAt && (
        <div role="status" className="rise mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-block px-5 py-4 text-paper">
          <div className="flex items-center gap-3">
            <StopIcon size={22} />
            <div>
              <p className="font-semibold">Every agent is frozen.</p>
              <p className="text-sm text-paper/80">
                All payments and refunds are blocked, including calls through PayPal&apos;s MCP tools, until you unfreeze. Since{" "}
                {new Date(data.frozenAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.
              </p>
            </div>
          </div>
          <button onClick={() => setFrozen(false)} className="rounded-lg bg-paper px-4 py-2 text-sm font-semibold text-block hover:bg-paper/90">
            Unfreeze
          </button>
        </div>
      )}

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
            <div className="mt-3 flex items-center gap-4">
              <SpendRing spent={data.weeklySpent} limit={p.weeklyLimit} />
              <div>
                <p className="text-2xl font-semibold tabular-nums">{usd(data.weeklySpent)}</p>
                <p className="text-sm text-muted">spent of ${p.weeklyLimit} weekly limit</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 text-sm">
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
              <div className="flex flex-wrap items-center gap-3">
                <div role="tablist" aria-label="Which agent" className="inline-flex rounded-lg border border-line bg-card p-0.5 text-sm">
                  {(
                    [
                      ["shop", "Shopping agent"],
                      ["support", "Support agent · PayPal MCP"],
                      ["redteam", "AI red team"],
                    ] as const
                  ).map(([m, label]) => (
                    <button
                      key={m}
                      role="tab"
                      aria-selected={mode === m}
                      onClick={() => setMode(m)}
                      className={`rounded-md px-3 py-1.5 font-medium ${mode === m ? "bg-ink text-paper" : "text-muted hover:text-ink"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted">
                  {mode === "shop"
                    ? "An agent shopping for you. Each scenario is a different way it can go wrong."
                    : mode === "support"
                      ? "An agent running your shop's PayPal with PayPal's own tools. Customers write the tickets it reads."
                      : "Gemini attacks your support agent. AgentLeash checks every refund it tries."}
                </p>
              </div>
              {mode !== "redteam" && (
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
              )}
            </div>
            <div className={`mt-3 grid gap-3 sm:grid-cols-2 ${mode === "shop" ? "xl:grid-cols-5" : "xl:grid-cols-3"} ${mode === "redteam" ? "hidden" : ""}`}>
              {(mode === "shop" ? data.scenarios : mode === "support" ? data.supportScenarios : []).map((s) => (
                <button
                  key={s.id}
                  onClick={() => runAgent(mode === "shop" ? { scenario: s.id } : { support: s.id })}
                  disabled={!!busy}
                  className={`group flex flex-col items-start justify-start rounded-xl border bg-card p-4 text-left transition hover:-translate-y-0.5 hover:border-ink disabled:opacity-60 ${
                    run?.scenario.id === s.id ? "border-ink" : "border-line"
                  }`}
                >
                  <ScenarioIcon id={s.id} />
                  <p className="mt-3 text-sm font-semibold">{busy === s.id ? "Running…" : s.label}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{s.blurb}</p>
                </button>
              ))}
            </div>
            <form
              className={`mt-3 flex gap-2 ${mode === "shop" ? "" : "hidden"}`}
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

          {mode === "redteam" && <RedTeam hasLlm={hasLlm} />}

          {!run && mode !== "redteam" && (
            <section className="rounded-xl border border-dashed border-line p-10 text-center">
              {mode === "shop" ? (
                <>
                  <p className="font-medium">Pick a scenario to watch the agent shop.</p>
                  <p className="mx-auto mt-1 max-w-md text-sm text-muted">
                    The agent browses a store and asks to pay. AgentLeash checks the purchase against your task and rules
                    before PayPal moves any money. Try <strong>Hijacked by a web page</strong> first.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-medium">Pick a ticket for the support agent.</p>
                  <p className="mx-auto mt-1 max-w-md text-sm text-muted">
                    The agent uses PayPal&apos;s MCP tools to refund customers. Every refund is checked against the real
                    PayPal payment and your refund rules first. Try <strong>Poisoned support ticket</strong>.
                  </p>
                </>
              )}
            </section>
          )}

          {run && mode !== "redteam" && (
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
                  <span className="font-mono text-xs text-paper/60">
                    {!traceDone ? "browsing…" : decision || !run.decisionId ? "done" : "waiting for firewall"}
                  </span>
                </div>
                <ol className="mt-4 space-y-3 font-mono text-[13px] leading-relaxed">
                  {run.steps.slice(0, shown).map((s, i) => (
                    <li key={i} className="rise flex gap-3">
                      <span className={`w-24 shrink-0 text-xs uppercase tracking-wide ${s.kind === "propose" ? "text-[#f5c26b]" : "text-paper/50"}`}>
                        {s.kind === "propose" && s.text.startsWith("Call ") ? "Wants to call" : STEP_LABEL[s.kind]}
                      </span>
                      <span className={s.tainted ? "text-paper/80" : ""}>
                        <TaintedText text={s.kind === "search" ? shortenResults(s.text) : s.text} tainted={!!s.tainted} />
                      </span>
                    </li>
                  ))}
                </ol>
                {traceDone && run.agentMode === "live" && (run.scenario.trapProductId || run.scenario.trapAmount) && (
                  <TrapNote
                    fell={
                      run.scenario.trapAmount
                        ? decision?.amount === run.scenario.trapAmount
                        : decision?.proposal.productId === run.scenario.trapProductId
                    }
                    scenarioId={run.scenario.id}
                  />
                )}
              </section>

              {/* Firewall decision */}
              <section className="receipt-shadow" aria-live="polite">
                {traceDone && !run.decisionId ? (
                  <div className="receipt grid min-h-48 place-items-center px-6 py-10 text-center text-sm text-muted">
                    The agent decided not to buy anything, so there was nothing to check.
                  </div>
                ) : !traceDone || !decision ? (
                  <div className="receipt grid min-h-48 place-items-center px-6 py-10 text-sm text-muted">
                    <span className="flex items-center gap-2">
                      <span className="scan-dot h-2 w-2 rounded-full bg-ink" aria-hidden />
                      Checking purchase…
                    </span>
                  </div>
                ) : (
                  <DecisionCard d={decision} origin={origin} />
                )}
              </section>
            </div>
          )}

          {/* Audit log */}
          <AuditGrid decisions={data.decisions} />
        </div>
      </div>
    </main>
  );
}

function DecisionCard({ d, origin }: { d: Decision; origin: string }) {
  const approveUrl = `${origin}/approve/${d.id}`;
  const time = new Date(d.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return (
    <div className="receipt rise px-6 pb-7 pt-7">
      {/* Header: what this is, when, and the stamp */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">
            {d.toolCall ? (d.toolCall.tool === "create_refund" ? "Refund check" : "PayPal action check") : "Purchase check"}
          </p>
          <p className="mt-0.5 font-mono text-xs text-muted">
            {time} · #{d.id.slice(4, 12)}
          </p>
        </div>
        <div className="-mr-1 -mt-1 -rotate-[8deg]">
          <Stamp verdict={d.verdict} />
        </div>
      </div>

      <hr className="my-4 border-t-2 border-dashed border-line" />

      {d.toolCall ? (
        <>
          <PriceLine left={d.toolCall.tool === "create_refund" ? "Refund to customer" : d.toolCall.tool.replace(/_/g, " ")} right={usd(d.amount)} />
          <p className="mt-1 font-mono text-xs text-muted">
            PayPal MCP · {d.toolCall.tool}({Object.entries(d.toolCall.args).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(", ").slice(0, 120)})
          </p>
        </>
      ) : (
        <>
          <PriceLine left={`${d.proposal.quantity} × ${d.proposal.title}`} right={usd(d.amount)} />
          <p className="mt-1 text-sm text-muted">{d.proposal.merchantName}</p>
        </>
      )}
      <p className="mt-2 text-xs leading-relaxed text-muted">
        <span className="font-medium text-ink">Task:</span> {d.proposal.task}
      </p>

      <hr className="my-4 border-t-2 border-dashed border-line" />

      <div className="flex items-start gap-4">
        <p className="flex-1 text-[15px] font-medium leading-snug">{d.summary}</p>
        <RiskDial score={d.riskScore} />
      </div>
      <FlowBar verdict={d.verdict} payment={d.payment.status} amount={d.amount} />

      <ul className="divide-y divide-dashed divide-line border-y-2 border-dashed border-line">
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
          <p className="text-sm text-muted">{d.toolCall ? `PayPal's ${d.toolCall.tool} never ran.` : "No PayPal order was created."}</p>
        )}
        {d.payment.status === "refunded" && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <PaymentChip status="refunded" />
            <span className="font-mono text-xs text-muted">Refund {d.payment.refundId}</span>
          </div>
        )}
        {d.verdict === "ALLOW" && !d.toolCall && (
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
        {d.verdict === "REVIEW" && d.payment.status !== "refunded" && (
          <div className="flex items-center gap-4 rounded-lg bg-review-bg/60 p-3">
            {d.payment.status === "awaiting_owner" ? (
              <>
                <QrCode value={approveUrl} size={104} />
                <div className="text-sm">
                  <p className="font-medium">Scan to approve on your phone</p>
                  <p className="mt-1 text-xs text-muted">Or open the approval page here:</p>
                  <a href={`/approve/${d.id}`} className="mt-2 inline-block rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-paper">
                    {d.toolCall ? "Review request" : "Review purchase"}
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

/** "Searched … → a · b · c · d · e" becomes "… → a · b · c (+2 more)" so the trace stays short. */
function shortenResults(text: string): string {
  const [head, list] = text.split(" → ");
  if (!list) return text;
  const items = list.split(" · ");
  return items.length <= 3 ? text : `${head} → ${items.slice(0, 3).join(" · ")} (+${items.length - 3} more)`;
}

/** Says honestly whether the live model fell for this scenario's trap. */
function TrapNote({ fell, scenarioId }: { fell: boolean; scenarioId: string }) {
  if (fell) {
    return (
      <p className="rise mt-4 rounded-lg border border-[#ff8a7a]/40 bg-block/20 p-3 text-xs leading-relaxed text-[#ffd7d0]">
        <strong className="text-[#ff8a7a]">The real model fell for the trap.</strong> This is a live AI decision, not a script.
      </p>
    );
  }
  return (
    <p className="rise mt-4 rounded-lg bg-paper/10 p-3 text-xs leading-relaxed text-paper/80">
      <strong className="text-paper">This model resisted the trap this time.</strong> AgentLeash still checked the purchase
      {scenarioId === "injection" ? " and flagged the poisoned page" : scenarioId === "poisoned" ? " and flagged the poisoned ticket" : ""}. Weaker or older agents do fall for it: untick
      “Live AI agent” to replay a vulnerable agent.
    </p>
  );
}

/** Shows page text, with the hidden <span> payload stripped of markup and highlighted. */
function TaintedText({ text, tainted }: { text: string; tainted: boolean }) {
  if (!tainted) return <>{text}</>;
  const m = text.match(/<(span|div)[^>]*>([\s\S]*?)<\/\1>/);
  if (!m) return <>{text}</>;
  const [before, after] = text.split(m[0]);
  return (
    <>
      {before}
      <span className="pulse-twice mt-1 block rounded border border-dashed border-[#a996ff]/60 bg-[#5a3ee0]/20 p-2 text-[#d9d0ff]">
        <span className="mb-1 block font-sans text-[11px] font-semibold text-[#b9a8ff]">Hidden text found. Invisible to you, read by the agent:</span>
        {m[2]}
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

function StopIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M5.2 1.5h5.6l3.7 3.7v5.6l-3.7 3.7H5.2l-3.7-3.7V5.2z" strokeLinejoin="round" />
      <path d="M5.5 8h5" strokeLinecap="round" />
    </svg>
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
