"use client";

// Countersign Bench, run live on this server: 44 attacks and 20 honest requests through the same engine
// the app uses, once with the AI switched off and once with it on.

import { useEffect, useState } from "react";
import type { BenchJob } from "@/lib/bench/jobs";
import type { BenchMode, BenchSummary, CaseOutcome } from "@/lib/bench/run";
import { VerdictBadge } from "./ui";

type State = { current?: BenchJob; last: Partial<Record<BenchMode, BenchSummary>>; hasLlm: boolean };

const RESULT: Record<CaseOutcome, { text: string; cls: string }> = {
  blocked: { text: "Blocked", cls: "text-allow" },
  held: { text: "Held for you", cls: "text-review" },
  leaked: { text: "Got through", cls: "font-semibold text-block" },
  correct: { text: "Right call", cls: "text-allow" },
  extra_review: { text: "Asked you needlessly", cls: "text-review" },
  false_block: { text: "Wrongly blocked", cls: "font-semibold text-block" },
  missed_review: { text: "Should have asked you", cls: "font-semibold text-block" },
};

const money = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

function Column({ title, s, onRun, busy, disabled, note }: { title: string; s?: BenchSummary; onRun: () => void; busy: boolean; disabled?: boolean; note?: string }) {
  return (
    <div className="flex flex-col rounded-lg border border-line bg-paper/60 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {s && s.mode === "full" && <span className="text-[11px] text-muted">{s.model}</span>}
      </div>
      {s ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
          <div>
            <dt className="text-xs text-muted">Attacks that got money out</dt>
            <dd className={`text-2xl font-semibold tabular-nums ${s.leaked ? "text-block" : "text-allow"}`}>
              {s.leaked}/{s.attacks}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Honest requests blocked</dt>
            <dd className={`text-2xl font-semibold tabular-nums ${s.falseBlocks ? "text-block" : "text-allow"}`}>
              {s.falseBlocks}/{s.honest}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Blocked · held for you</dt>
            <dd className="tabular-nums">
              {s.blocked} · {s.held}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Money kept</dt>
            <dd className="tabular-nums">
              {money(s.moneyStopped)} of {money(s.moneyAtRisk)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Approvals asked needlessly</dt>
            <dd className="tabular-nums">{s.extraReviews}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Median check time</dt>
            <dd className="tabular-nums">{s.p50ms} ms</dd>
          </div>
        </dl>
      ) : (
        <p className="mt-3 text-sm text-muted">{note ?? "Not run on this server yet."}</p>
      )}
      <button onClick={onRun} disabled={busy || disabled} className="mt-4 self-start rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-paper disabled:opacity-50">
        {s ? "Run again" : "Run it"}
      </button>
    </div>
  );
}

export default function BenchPanel() {
  const [st, setSt] = useState<State>();
  const [error, setError] = useState<string>();
  const [showAll, setShowAll] = useState(false);
  const running = st?.current?.status === "running";

  async function load() {
    const r = await fetch("/api/bench", { cache: "no-store" });
    if (r.ok) setSt(await r.json());
  }
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (!running) return;
    const t = setTimeout(load, 900);
    return () => clearTimeout(t);
  }, [st, running]);

  async function run(mode: BenchMode) {
    setError(undefined);
    const r = await fetch("/api/bench", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) });
    const body = await r.json();
    if (!r.ok) return setError(body.error ?? "Could not start the bench.");
    await load();
  }

  const shown = st?.last.full ?? st?.last.rules;
  const rows = shown?.results.filter((r) => showAll || !["blocked", "correct"].includes(r.outcome)) ?? [];

  return (
    <section className="rounded-xl border border-line bg-card" data-testid="bench">
      <div className="border-b border-line px-5 py-4">
        <h2 className="font-semibold">Countersign Bench</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          44 attacks and 20 honest requests, shopping and support, run right now through the same engine this app uses. Each attack
          assumes the agent already fell for it, so this measures Countersign, not the model. Nothing is paid or saved.
        </p>
      </div>
      <div className="grid gap-3 p-5 sm:grid-cols-2">
        <Column title="Rules only (AI off)" s={st?.last.rules} busy={running} onRun={() => run("rules")} />
        <Column
          title="Rules + AI"
          s={st?.last.full}
          busy={running}
          disabled={st ? !st.hasLlm : true}
          note={st && !st.hasLlm ? "No AI model on this server." : "Takes a minute or two: about 120 AI calls."}
          onRun={() => run("full")}
        />
      </div>
      {running && st?.current && (
        <div className="px-5 pb-4" role="status">
          <div className="h-1.5 overflow-hidden rounded-full bg-line">
            <div className="h-full bg-ink transition-[width]" style={{ width: `${st.current.total ? (st.current.done / st.current.total) * 100 : 3}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted">
            Running {st.current.mode === "full" ? "rules + AI" : "rules only"}: {st.current.done} of {st.current.total || 64} cases
          </p>
        </div>
      )}
      {error && <p className="px-5 pb-4 text-sm text-block">{error}</p>}
      {shown && (
        <div className="border-t border-line px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">
              {showAll ? "Every case" : "Cases that weren't a clean block or a right call"} ({shown.mode === "full" ? "rules + AI" : "rules only"})
            </p>
            <button onClick={() => setShowAll((x) => !x)} className="text-xs font-medium text-muted underline underline-offset-2 hover:text-ink">
              {showAll ? "Show only the interesting ones" : `Show all ${shown.results.length}`}
            </button>
          </div>
          {rows.length === 0 ? (
            <p className="mt-2 text-sm text-muted">None. Every attack was blocked and every honest request got the right call.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line text-sm">
              {rows.map((r) => (
                <li key={r.id} className="grid grid-cols-[1fr_auto] items-start gap-x-3 gap-y-0.5 py-2 sm:grid-cols-[7rem_1fr_auto_8rem]">
                  <span className="text-xs text-muted sm:pt-0.5">{r.attack ? r.tactic : "Honest"}</span>
                  <span className="col-span-2 sm:col-span-1">
                    {r.title} <span className="text-muted">· ${r.amount.toFixed(2)}</span>
                    <span className="block text-xs text-muted">{r.summary}</span>
                  </span>
                  <VerdictBadge verdict={r.verdict} />
                  <span className={`text-xs ${RESULT[r.outcome].cls}`}>{RESULT[r.outcome].text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
