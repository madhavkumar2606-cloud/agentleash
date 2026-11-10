"use client";

import dynamic from "next/dynamic";
import { Logo } from "./Logo";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Scenario } from "@/lib/agent";
import type { AgentStep, Decision, Mandate } from "@/lib/types";
import { FlowBar } from "./FlowBar";
import GuideBar from "./GuideBar";
import HoldActions from "./HoldActions";
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
  const [editingRules, setEditingRules] = useState(false);
  const [showGuide, setShowGuide] = useState(true);
  const [redTeamDone, setRedTeamDone] = useState(false);
  const rulesTouched = useRef(false);
  const outcomeRef = useRef<HTMLDivElement>(null);

  // Remember guide progress and visibility for this viewer (best effort; storage can be unavailable).
  useEffect(() => {
    try {
      setShowGuide(localStorage.getItem("al:guide") !== "hidden");
      setRedTeamDone(localStorage.getItem("al:redteam") === "done");
    } catch {}
  }, []);
  const hideGuide = (hide: boolean) => {
    setShowGuide(!hide);
    try {
      localStorage.setItem("al:guide", hide ? "hidden" : "shown");
    } catch {}
  };
  const markRedTeamDone = useCallback(() => {
    setRedTeamDone(true);
    try {
      localStorage.setItem("al:redteam", "done");
    } catch {}
  }, []);

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

  // When a run starts, bring the result area into view so nobody has to hunt for it.
  useEffect(() => {
    if (!run || shown !== 1) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    outcomeRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }, [run, shown]);

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

  async function toggleHold(on: boolean) {
    const base = rules.replace(/\s*Hold agent payments until I confirm delivery\.?/gi, "").trim();
    const next = on ? `${base} Hold agent payments until I confirm delivery.` : base;
    setRules(next);
    await saveRules(next);
  }

  async function saveRules(text = rules) {
    setSavingRules(true);
    setError(undefined);
    try {
      const res = await fetch("/api/mandate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rulesText: text }),
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
    return <main className="grid min-h-screen place-items-center text-muted">Loading Countersign…</main>;
  }

  const decision = run?.decisionId ? data.decisions.find((d) => d.id === run.decisionId) : undefined;
  const hasLlm = data.modes.llm !== "mock";
  const traceDone = run ? shown > run.steps.length : false;
  const p = data.mandate.policy;
  const blockedCount = data.decisions.filter((d) => d.verdict === "BLOCK").length;
  const savedAmount = data.decisions.filter((d) => d.verdict === "BLOCK").reduce((s, d) => s + d.amount, 0);
  const ds = data.decisions;
  const guide = [
    {
      title: "Watch an attack get stopped",
      hint: "A product page hides a note telling the shopping agent to buy a gift card instead.",
      action: "Run the hijack",
      done: ds.some((d) => !d.toolCall && d.verdict === "BLOCK" && d.checks.some((c) => c.id === "injection" && c.status !== "pass")),
      onRun: () => {
        setMode("shop");
        runAgent({ scenario: "injection" });
      },
    },
    {
      title: "Approve a payment from your phone",
      hint: `A $79 gift is over your $${p.approvalThreshold} limit, so Countersign asks you first. Approve it and pay with PayPal.`,
      action: "Buy the $79 gift",
      done: ds.some((d) => !d.toolCall && d.verdict === "REVIEW" && ["captured", "authorized"].includes(d.payment.status)),
      onRun: () => {
        setMode("shop");
        runAgent({ scenario: "bigticket" });
      },
    },
    {
      title: "Protect your shop's refunds",
      hint: "A customer ticket hides a $500 refund request. The support agent refunds the payment from step 2.",
      action: "Run the poisoned ticket",
      done: ds.some((d) => d.toolCall && d.verdict === "BLOCK"),
      onRun: () => {
        setMode("support");
        runAgent({ support: "poisoned" });
      },
    },
    {
      title: "Attack your own agent",
      hint: "Gemini writes new attacks on your support agent. See what gets through, and how to fix it.",
      action: "Open the red team",
      done: redTeamDone,
      onRun: () => setMode("redteam"),
    },
  ];

  return (
    <main className="mx-auto max-w-7xl px-5 pb-20 pt-6 sm:px-8">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-5">
        <Link href="/" className="flex items-center gap-3 rounded-md">
          <Logo />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Countersign</h1>
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
        <aside className="order-2 space-y-6 lg:order-1">
          <section className="rounded-xl border border-line bg-card p-5">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">Your rules</h2>
              <span className="text-[11px] text-muted">{data.mandate.parsedBy === "llm" ? "Read by AI" : "Read by the rules engine"}</span>
            </div>
            {editingRules ? (
              <>
                <p className="mt-1 text-xs text-muted">Write them in plain English. Countersign turns them into checks.</p>
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
                  rows={7}
                  autoFocus
                  className="mt-3 w-full resize-y rounded-lg border border-line bg-paper p-3 text-sm leading-relaxed outline-none focus:border-ink"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={async () => {
                      await saveRules();
                      setEditingRules(false);
                    }}
                    disabled={savingRules || rules.trim().length < 5}
                    className="flex-1 rounded-lg bg-ink px-3 py-2 text-sm font-medium text-paper disabled:opacity-50"
                  >
                    {savingRules ? "Saving rules…" : "Save rules"}
                  </button>
                  <button
                    onClick={() => {
                      rulesTouched.current = false;
                      setRules(data.mandate.rulesText);
                      setEditingRules(false);
                    }}
                    className="rounded-lg border border-line px-3 py-2 text-sm font-medium"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="mt-1 text-xs text-muted">Every agent payment and refund is checked against these.</p>
                <ul id="rules-summary" className="mt-3 space-y-1.5 text-sm">
                  <RuleLine>Up to ${p.perTransactionLimit} per purchase, ${p.weeklyLimit} a week</RuleLine>
                  <RuleLine>Ask me before anything over ${p.approvalThreshold}</RuleLine>
                  <RuleLine>No more than {p.maxQuantity} of any item</RuleLine>
                  {p.reviewNewMerchants && <RuleLine>Ask me before paying a new seller</RuleLine>}
                  <RuleLine>Refunds over ${p.refundApprovalThreshold} need my approval</RuleLine>
                  <RuleLine>
                    Never refund more than ${p.maxRefund} at once, or ${p.dailyRefundLimit} a day
                  </RuleLine>
                </ul>
                {p.blockedCategories.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-muted">Never buy</span>
                    {p.blockedCategories.map((c) => (
                      <span key={c} className="rounded-md bg-block-bg px-2 py-0.5 text-xs font-medium text-block">
                        {c}
                      </span>
                    ))}
                  </div>
                )}
                <button onClick={() => setEditingRules(true)} className="mt-3 w-full rounded-lg border border-line px-3 py-2 text-sm font-medium hover:border-ink">
                  Edit rules
                </button>
              </>
            )}
            <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-paper p-3">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-[#0070e0]"
                checked={p.holdUntilDelivered}
                disabled={savingRules}
                onChange={(e) => toggleHold(e.target.checked)}
              />
              <span className="text-xs leading-relaxed">
                <span className="block text-sm font-medium">Hold payments until delivery</span>
                <span className="text-muted">PayPal holds the money (an authorization). It moves only when you confirm the item arrived.</span>
              </span>
            </label>
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
        <div className="order-1 space-y-6 lg:order-2">
          {showGuide ? (
            <GuideBar steps={guide} busy={!!busy} onHide={() => hideGuide(true)} />
          ) : (
            <button onClick={() => hideGuide(false)} className="text-xs text-muted underline underline-offset-2 hover:text-ink">
              Show the 4-step guide
            </button>
          )}
          <section>
            <div>
              <div>
                <div role="tablist" aria-label="Which agent" className="grid w-full grid-cols-3 gap-2">
                  {(
                    [
                      ["shop", "Shopping agent", "Buys things for you", <CartIcon key="i" />],
                      ["support", "Support agent", "Refunds your customers with PayPal's own tools", <ChatIcon key="i" />],
                      ["redteam", "AI red team", "Attacks your agent to find its weak spots", <TargetIcon key="i" />],
                    ] as const
                  ).map(([m, label, sub, icon]) => (
                    <button
                      key={m}
                      role="tab"
                      aria-selected={mode === m}
                      onClick={() => setMode(m)}
                      className={`flex flex-col items-start gap-1.5 rounded-xl border px-3 py-2.5 text-left transition sm:flex-row sm:gap-3 sm:px-4 sm:py-3 ${
                        mode === m ? "border-ink bg-ink text-paper" : "border-line bg-card hover:border-ink"
                      }`}
                    >
                      <span className={`mt-0.5 shrink-0 ${mode === m ? "text-paper" : "text-muted"}`}>{icon}</span>
                      <span>
                        <span className="block text-sm font-semibold">{label}</span>
                        <span className={`hidden text-xs leading-snug sm:block ${mode === m ? "text-paper/70" : "text-muted"}`}>{sub}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted">
                {mode === "shop"
                  ? "Pick a scenario. Each one is a different way a shopping agent can go wrong."
                  : mode === "support"
                    ? "Pick a ticket. Customers write the tickets, so any of them can hide instructions for the agent."
                    : "Launch attacks below. Nothing reaches PayPal: it's a dry run."}
              </p>
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
            <div className={`mt-3 grid grid-cols-2 gap-3 ${mode === "shop" ? "xl:grid-cols-5" : "xl:grid-cols-3"} ${mode === "redteam" ? "hidden" : ""}`}>
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

          {mode === "redteam" && <RedTeam hasLlm={hasLlm} onFinished={markRedTeamDone} />}

          {!run && mode !== "redteam" && (
            <section className="rounded-xl border border-dashed border-line p-10 text-center">
              {mode === "shop" ? (
                <>
                  <p className="font-medium">Pick a scenario to watch the agent shop.</p>
                  <p className="mx-auto mt-1 max-w-md text-sm text-muted">
                    The agent browses a store and asks to pay. Countersign checks the purchase against your task and rules
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
            <div ref={outcomeRef} className="scroll-mt-4">
              <Outcome d={traceDone ? decision : undefined} noDecision={traceDone && !run.decisionId} />
            </div>
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
                  <DecisionCard d={decision} origin={origin} onChange={refresh} />
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

function DecisionCard({ d, origin, onChange }: { d: Decision; origin: string; onChange?: () => void }) {
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
        {d.payment.status === "authorized" && (
          <div className="space-y-2 rounded-lg bg-[#e6eefb]/70 p-3">
            <p className="text-sm text-pp">
              <span className="font-semibold">PayPal is holding the money.</span> Authorization{" "}
              <span className="font-mono text-xs">{d.payment.authorizationId}</span>
            </p>
            <HoldActions id={d.id} amount={d.amount} size="sm" onDone={onChange} />
          </div>
        )}
        {d.verdict === "ALLOW" && !d.toolCall && d.payment.status !== "authorized" && (
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
      <strong className="text-paper">This model resisted the trap this time.</strong> Countersign still checked the purchase
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

function RuleLine({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2 leading-snug">
      <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-ink/40" aria-hidden />
      <span>{children}</span>
    </li>
  );
}

/** One plain-English line: what just happened to the money. */
function Outcome({ d, noDecision }: { d?: Decision; noDecision: boolean }) {
  let tone: "block" | "review" | "allow" | "pp" | "neutral" = "neutral";
  let title = "The agent is working…";
  let detail = "Watch its steps on the left. Countersign checks whatever it tries to pay or refund.";
  if (noDecision) {
    title = "The agent decided not to pay for anything.";
    detail = "There was nothing for Countersign to check.";
  } else if (d) {
    const amount = usd(d.amount);
    const what = d.toolCall ? (d.toolCall.tool === "create_refund" ? "refund" : "PayPal action") : "payment";
    const failed = d.checks.filter((c) => c.status === "fail").map((c) => c.label.toLowerCase());
    const flagged = d.checks.filter((c) => c.status === "warn").map((c) => c.label.toLowerCase());
    const st = d.payment.status;
    if (d.verdict === "BLOCK") {
      tone = "block";
      title = d.toolCall ? `Stopped. The ${amount} ${what} never ran.` : `Stopped. ${amount} never left your account.`;
      detail = failed.length ? `Caught by ${listOf(failed)}.` : d.summary;
    } else if (st === "awaiting_owner") {
      tone = "review";
      title = d.toolCall ? `Waiting for you. The agent wants to ${what === "refund" ? `refund ${amount}` : "run a PayPal action"}.` : `Waiting for you. The agent wants to spend ${amount}.`;
      detail = `${flagged.length ? `Flagged by ${listOf(flagged)}. ` : ""}Scan the code with your phone or open the approval page. Nothing moves until you say yes.`;
    } else if (st === "rejected") {
      tone = "neutral";
      title = "You declined. Nothing moved.";
      detail = d.summary;
    } else if (st === "captured") {
      tone = "allow";
      title = `Paid. PayPal took ${amount}.`;
      detail = d.verdict === "REVIEW" ? "You approved it, so it went through." : "It matched your task and every rule.";
    } else if (st === "refunded") {
      tone = "allow";
      title = `Refunded. ${amount} went back to the customer through PayPal.`;
      detail = "It matched the ticket, the real payment and your refund rules.";
    } else if (st === "authorized") {
      tone = "pp";
      title = `Approved. PayPal is holding ${amount} until you confirm delivery.`;
      detail = "Release it when the item arrives, or cancel the hold. Nothing is paid until then.";
    } else if (st === "voided") {
      title = "Hold cancelled. Nothing was paid.";
      detail = d.summary;
    } else if (st === "awaiting_payer") {
      tone = "allow";
      title = `Approved. Finish checkout at PayPal to pay ${amount}.`;
      detail = "It matched your task and every rule.";
    } else if (st === "approved") {
      tone = "allow";
      title = "Approved. The agent may run this PayPal action once.";
      detail = d.summary;
    } else if (st === "failed") {
      tone = "review";
      title = "PayPal didn't complete it.";
      detail = d.payment.error ?? d.summary;
    } else {
      tone = "allow";
      title = "Approved.";
      detail = d.summary;
    }
  }
  const style = {
    block: "border-block/30 bg-block-bg text-block",
    review: "border-review/30 bg-review-bg text-review",
    allow: "border-allow/30 bg-allow-bg text-allow",
    pp: "border-pp-light/30 bg-[#e6eefb] text-pp",
    neutral: "border-line bg-card text-ink",
  }[tone];
  return (
    <div role="status" aria-live="polite" className={`flex items-start gap-3 rounded-xl border px-5 py-4 ${style}`}>
      <OutcomeIcon tone={tone} />
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-0.5 text-sm opacity-80">{detail}</p>
      </div>
    </div>
  );
}

function listOf(xs: string[]) {
  return xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

function OutcomeIcon({ tone }: { tone: string }) {
  const p = { width: 22, height: 22, viewBox: "0 0 22 22", fill: "none", stroke: "currentColor", strokeWidth: 1.8, "aria-hidden": true } as const;
  if (tone === "neutral") return <span className="scan-dot mt-2 h-2 w-2 shrink-0 rounded-full bg-ink" aria-hidden />;
  if (tone === "block") return <svg {...p} className="mt-0.5 shrink-0"><circle cx="11" cy="11" r="8.5" /><path d="M5 17L17 5" strokeLinecap="round" /></svg>;
  if (tone === "review") return <svg {...p} className="mt-0.5 shrink-0"><circle cx="11" cy="11" r="8.5" /><path d="M11 6.5V11l3 2" strokeLinecap="round" /></svg>;
  if (tone === "pp") return <svg {...p} className="mt-0.5 shrink-0"><rect x="4" y="9.5" width="14" height="9" rx="2" /><path d="M7.5 9.5V7a3.5 3.5 0 017 0v2.5" /></svg>;
  return <svg {...p} className="mt-0.5 shrink-0"><circle cx="11" cy="11" r="8.5" /><path d="M7 11.5l2.8 2.8L15.5 8.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
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


const iconProps = { width: 18, height: 18, viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.6, "aria-hidden": true } as const;

function CartIcon() {
  return (
    <svg {...iconProps}>
      <path d="M2.5 3.5h2l1.8 9h9l1.7-6.5H5.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="7.5" cy="16" r="1.2" />
      <circle cx="14.5" cy="16" r="1.2" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3.5 4.5h13v9h-7l-4 3v-3h-2z" strokeLinejoin="round" />
      <path d="M7 8.5h6M7 11h4" strokeLinecap="round" />
    </svg>
  );
}

function TargetIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="10" cy="10" r="6.5" />
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 1.5v3M10 15.5v3M1.5 10h3M15.5 10h3" strokeLinecap="round" />
    </svg>
  );
}
