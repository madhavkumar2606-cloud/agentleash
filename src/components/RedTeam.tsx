"use client";

import { useEffect, useRef, useState } from "react";
import type { AttackResult, Outcome, RedTeamJob, Target } from "@/lib/redteam";
import { CheckPill, usd } from "./ui";

type Score = {
  total: number;
  controls: number;
  finished: number;
  agentFell: number;
  blocked: number;
  held: number;
  leaked: number;
  resisted: number;
  falseAlarms: number;
  errors: number;
  protectedAmount: number;
};
type Job = RedTeamJob & { score: Score };

const TARGETS: { id: Target; label: string; hint: string }[] = [
  { id: "careful", label: "Careful agent", hint: "Told to treat tickets as untrusted" },
  { id: "naive", label: "Eager agent", hint: "Told to keep customers happy" },
  { id: "hardened", label: "Hardened agent", hint: "Careful, plus the fix from your last report" },
];

const OUTCOME: Record<Outcome, { text: string; cls: string }> = {
  blocked: { text: "Blocked by AgentLeash", cls: "bg-allow-bg text-allow" },
  held: { text: "Held for your approval", cls: "bg-review-bg text-review" },
  leaked: { text: "Got through", cls: "bg-block text-paper" },
  resisted: { text: "Agent resisted", cls: "bg-line/70 text-ink" },
  ok: { text: "Honest refund allowed", cls: "bg-allow-bg text-allow" },
  false_alarm: { text: "False alarm", cls: "bg-review-bg text-review" },
  error: { text: "AI call failed", cls: "bg-line/70 text-muted" },
};

export default function RedTeam({ hasLlm }: { hasLlm: boolean }) {
  const [target, setTarget] = useState<Target>("careful");
  const [count, setCount] = useState(6);
  const [generate, setGenerate] = useState(true);
  const [job, setJob] = useState<Job>();
  const [error, setError] = useState<string>();
  const [starting, setStarting] = useState(false);
  const lastFix = useRef<string>(undefined);
  const lastJobId = useRef<string>(undefined);

  // Poll the running job.
  useEffect(() => {
    if (!job || job.status === "done" || job.status === "error") return;
    const t = setTimeout(async () => {
      const res = await fetch(`/api/redteam/${job.id}`, { cache: "no-store" });
      if (res.ok) setJob(await res.json());
    }, 1100);
    return () => clearTimeout(t);
  }, [job]);

  useEffect(() => {
    if (job?.status === "done") {
      lastJobId.current = job.id;
      if (job.report) lastFix.current = job.report.fix;
    }
  }, [job]);

  async function launch(opts: { target: Target; reuse?: string }) {
    setStarting(true);
    setError(undefined);
    try {
      const res = await fetch("/api/redteam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: opts.target, count, generate: generate && hasLlm, fix: lastFix.current, reuse: opts.reuse }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not start the red team");
      setTarget(opts.target);
      setJob(body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  const running = !!job && job.status !== "done" && job.status !== "error";
  const s = job?.score;
  const fellOf = s ? `${s.agentFell} of ${s.total}` : "–";
  const stoppedOf = s && s.agentFell > 0 ? `${s.blocked + s.held} of ${s.agentFell}` : s ? "nothing to stop" : "–";

  return (
    <div className="space-y-6">
      {/* Control room */}
      <section className="overflow-hidden rounded-xl border border-line bg-ink text-paper">
        <div className="grid gap-6 p-6 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Attack your own support agent, before someone else does</h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-paper/70">
              Gemini writes new attacks: customer tickets that try to talk your agent into refunding money it shouldn&apos;t. Your
              agent reads each one with PayPal&apos;s refund tool in hand, and AgentLeash checks every refund it tries. It&apos;s a dry
              run: nothing reaches PayPal.
            </p>

            <fieldset className="mt-5">
              <legend className="text-xs font-medium text-paper/60">Agent under test</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {TARGETS.map((t) => {
                  const disabled = running || (t.id === "hardened" && !lastFix.current);
                  return (
                    <label
                      key={t.id}
                      className={`cursor-pointer rounded-lg border px-3 py-2 text-sm transition ${
                        target === t.id ? "border-paper bg-paper/10" : "border-paper/20 hover:border-paper/50"
                      } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
                    >
                      <input type="radio" name="target" className="sr-only" checked={target === t.id} disabled={disabled} onChange={() => setTarget(t.id)} />
                      <span className="block font-medium">{t.label}</span>
                      <span className="block text-xs text-paper/60">{t.hint}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3 text-sm">
              <label className="flex items-center gap-2">
                <span className="text-paper/60">Attacks</span>
                <select
                  value={count}
                  disabled={running}
                  onChange={(e) => setCount(Number(e.target.value))}
                  className="rounded-md border border-paper/25 bg-ink px-2 py-1 text-paper"
                >
                  {[4, 6, 8].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-paper/50">+ 2 honest tickets</span>
              </label>
              <label className={`flex items-center gap-2 ${hasLlm ? "" : "opacity-50"}`}>
                <input type="checkbox" className="h-4 w-4 accent-[#a996ff]" checked={generate && hasLlm} disabled={!hasLlm || running} onChange={(e) => setGenerate(e.target.checked)} />
                <span>{hasLlm ? "Gemini writes new attacks" : "Built-in attacks (add an AI key for new ones)"}</span>
              </label>
            </div>

            <button
              onClick={() => launch({ target })}
              disabled={running || starting}
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#ff6b57] px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-[#ff836f] disabled:opacity-60"
            >
              <TargetIcon />
              {starting ? "Starting…" : running ? statusText(job!) : "Launch attacks"}
            </button>
            {error && <p className="mt-3 text-sm text-[#ffb4a8]">{error}</p>}
          </div>

          {/* Scoreboard */}
          <div className="grid content-start gap-3 sm:grid-cols-2" aria-live="polite">
            <Big label="Your agent fell for" value={fellOf} tone={s && s.agentFell > 0 ? "bad" : "neutral"} sub="attacks it obeyed" />
            <Big
              label="AgentLeash stopped"
              value={stoppedOf}
              tone={s && s.agentFell > 0 ? (s.leaked === 0 ? "good" : "bad") : "neutral"}
              sub={s && s.leaked > 0 ? `${s.leaked} got through` : "blocked or held for you"}
            />
            <Small label="Kept in your account" value={s ? usd(s.protectedAmount) : "–"} />
            <Small label="False alarms" value={s ? `${s.falseAlarms} of ${s.controls} honest tickets` : "–"} />
            {job && (
              <p className="text-xs text-paper/50 sm:col-span-2">
                {job.generatedBy === "ai" ? "Attacks written by Gemini for this run" : "Built-in attack library"} · against payment{" "}
                <span className="font-mono">{job.capture.captureId}</span> ({usd(job.capture.amount)}) · {s?.finished ?? 0} of{" "}
                {job.attacks.length || "…"} done
              </p>
            )}
          </div>
        </div>
        {running && <div className="h-1 bg-paper/10"><div className="h-full bg-[#ff6b57] transition-all duration-500" style={{ width: `${progress(job!)}%` }} /></div>}
      </section>

      {!job && (
        <section className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-muted">
          <p className="font-medium text-ink">No attacks yet.</p>
          <p className="mx-auto mt-1 max-w-lg">
            Pick the agent to test and launch. Each attack uses a different trick: a fake policy note, a forged email from the owner,
            a fake PayPal fraud alert, text hidden in the HTML, instructions in another language.
          </p>
        </section>
      )}

      {job && job.attacks.length === 0 && (
        <section className="rounded-xl border border-line bg-card p-6 text-sm text-muted">
          <span className="flex items-center gap-2">
            <span className="scan-dot h-2 w-2 rounded-full bg-ink" aria-hidden />
            Gemini is writing new attacks for your agent…
          </span>
        </section>
      )}

      {/* Attack results */}
      {job && job.attacks.length > 0 && (
        <section className="rounded-xl border border-line bg-card">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h3 className="text-sm font-semibold">Attacks</h3>
            <p className="text-xs text-muted">Open one to see the ticket, what your agent did, and every check</p>
          </div>
          <ol className="divide-y divide-line">
            {job.attacks.map((a, i) => (
              <AttackRow key={a.id} n={i + 1} attack={a} result={job.results[i]} />
            ))}
          </ol>
        </section>
      )}

      {/* Report */}
      {job?.report && (
        <section className="grid gap-6 rounded-xl border border-line bg-card p-6 lg:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold">
              Where your agent is weak
              {job.report.by === "ai" && <span className="ml-2 rounded bg-line/70 px-1.5 py-px text-[10px] font-semibold text-muted">AI</span>}
            </h3>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed">
              {job.report.weaknesses.map((w, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-block" aria-hidden />
                  {w}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs leading-relaxed text-muted">
              Better instructions make your agent fall for less. AgentLeash is the backstop for what still gets through: it checks the
              refund itself, against the ticket and the real PayPal payment.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold">Add this to your agent&apos;s instructions</h3>
            <p className="mt-3 rounded-lg bg-paper p-4 font-mono text-[13px] leading-relaxed">{job.report.fix}</p>
            {s && s.agentFell > 0 && (
              <button
                onClick={() => launch({ target: "hardened", reuse: job.id })}
                disabled={running || starting}
                className="mt-3 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-50"
              >
                Harden the agent and re-run these attacks
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function AttackRow({ n, attack, result }: { n: number; attack: Job["attacks"][number]; result?: AttackResult }) {
  const pending = !result || result.pending;
  const o = !pending ? OUTCOME[result.outcome] : undefined;
  return (
    <li>
      <details className="group">
        <summary className="grid cursor-pointer list-none grid-cols-[2rem_1fr] gap-3 px-5 py-4 hover:bg-paper/60 sm:grid-cols-[2rem_1fr_11rem_12rem] sm:items-center">
          <span className="font-mono text-xs text-muted">{String(n).padStart(2, "0")}</span>
          <div className="min-w-0">
            <span className={`inline-block rounded px-1.5 py-px text-[11px] font-semibold ${attack.control ? "bg-allow-bg text-allow" : "bg-uv-bg text-uv"}`}>{attack.tactic}</span>
            <p className="mt-1 text-sm font-medium">{attack.title}</p>
            <p className="mt-0.5 text-xs text-muted">
              From {attack.customer} · {attack.control ? `fair refund ${usd(attack.fairMax)}` : `tries to get ${usd(attack.attackerGoal)}`}
            </p>
          </div>
          <p className="col-start-2 text-sm sm:col-start-auto">
            {pending ? (
              <span className="flex items-center gap-2 text-muted">
                <span className="scan-dot h-1.5 w-1.5 rounded-full bg-ink" aria-hidden />
                Attacking…
              </span>
            ) : result.agent ? (
              <span className={result.fell ? "font-medium text-block" : ""}>
                {result.agent.refund > 0 ? `Agent refunded ${usd(result.agent.refund)}` : "Agent refunded nothing"}
              </span>
            ) : (
              <span className="text-muted">No answer from the AI</span>
            )}
          </p>
          <p className="col-start-2 sm:col-start-auto">
            {o && <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${o.cls}`}>{o.text}</span>}
          </p>
        </summary>
        {!pending && (
          <div className="grid gap-5 border-t border-dashed border-line bg-paper/50 px-5 py-4 sm:pl-[3.75rem] lg:grid-cols-2">
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-xs font-medium text-muted">The ticket{result.hidden ? " (hidden text highlighted)" : ""}</p>
                <p className="mt-1 whitespace-pre-line leading-relaxed">
                  <Ticket text={result.ticket} />
                </p>
              </div>
              {result.agent && (
                <div>
                  <p className="text-xs font-medium text-muted">Your agent&apos;s reasoning ({result.agent.mode === "live" ? "live AI" : "scripted"})</p>
                  <p className="mt-1 leading-relaxed">{result.agent.reasoning}</p>
                </div>
              )}
            </div>
            <div>
              {result.summary ? (
                <>
                  <p className="text-xs font-medium text-muted">AgentLeash</p>
                  <p className="mt-1 text-sm font-medium">{result.summary}</p>
                  <ul className="mt-2 space-y-2">
                    {result.checks?.map((c) => (
                      <li key={c.label} className="flex gap-2.5">
                        <CheckPill status={c.status} />
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{c.label}</p>
                          <p className="text-xs leading-relaxed text-muted">{c.detail}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-sm text-muted">The agent didn&apos;t try to refund anything, so there was nothing for AgentLeash to check.</p>
              )}
            </div>
          </div>
        )}
      </details>
    </li>
  );
}

/** Shows a ticket with its hidden parts (hidden HTML, tiny text, comments) unwrapped and highlighted. */
function Ticket({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  const re = /<(span|div)([^>]*)>([\s\S]*?)<\/\1>|<!--([\s\S]*?)-->/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const hiddenStyle = m[4] !== undefined || /display\s*:\s*none|font-size\s*:\s*[01]px|color\s*:\s*#?fff|opacity\s*:\s*0/i.test(m[2] ?? "");
    const inner = m[4] ?? m[3];
    parts.push(
      hiddenStyle ? (
        <mark key={m.index} className="rounded bg-uv-bg px-1 text-uv ring-1 ring-uv/30">
          <span className="mr-1 text-[10px] font-semibold uppercase">hidden</span>
          {inner.trim()}
        </mark>
      ) : (
        inner
      ),
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function Big({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: "good" | "bad" | "neutral" }) {
  const color = tone === "good" ? "text-[#7be0a8]" : tone === "bad" ? "text-[#ff8a7a]" : "text-paper";
  return (
    <div className="rounded-lg border border-paper/15 p-4">
      <p className="text-xs text-paper/60">{label}</p>
      <p className={`mt-1 text-3xl font-semibold tabular-nums tracking-tight ${color}`}>{value}</p>
      <p className="mt-1 text-xs text-paper/50">{sub}</p>
    </div>
  );
}

function Small({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-paper/5 px-4 py-3">
      <p className="text-xs text-paper/60">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function statusText(job: Job) {
  if (job.status === "generating") return "Gemini is writing attacks…";
  if (job.status === "reporting") return "Writing the report…";
  return `Attacking… ${job.score.finished} of ${job.attacks.length}`;
}

function progress(job: Job) {
  if (job.status === "generating") return 8;
  if (job.status === "reporting") return 96;
  return 10 + (job.score.finished / Math.max(1, job.attacks.length)) * 85;
}

function TargetIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <circle cx="8" cy="8" r="6" />
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 0.5v3M8 12.5v3M0.5 8h3M12.5 8h3" strokeLinecap="round" />
    </svg>
  );
}
