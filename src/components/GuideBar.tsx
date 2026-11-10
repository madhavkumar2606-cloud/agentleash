"use client";

// "Try it in 4 steps": the suggested path through the demo, with progress ticks.
// The steps are a real sequence: step 3 refunds the payment made in step 2.

export interface GuideStep {
  title: string;
  hint: string;
  done: boolean;
  action: string;
  onRun: () => void;
}

export default function GuideBar({ steps, busy, onHide }: { steps: GuideStep[]; busy: boolean; onHide: () => void }) {
  const next = steps.findIndex((s) => !s.done);
  const doneCount = steps.filter((s) => s.done).length;
  return (
    <section aria-label="Guided demo" className="rounded-xl border border-line bg-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-4">
        <h2 className="text-sm font-semibold">
          Try it in 4 steps <span className="ml-2 font-normal text-muted">{doneCount === 4 ? "All done" : `${doneCount} of 4 done`}</span>
        </h2>
        <button onClick={onHide} className="text-xs text-muted underline underline-offset-2 hover:text-ink">
          Hide guide
        </button>
      </div>
      <ol className="grid gap-px overflow-hidden rounded-b-xl pt-3 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((s, i) => {
          const isNext = i === next;
          return (
            <li key={s.title} className={`flex flex-col gap-2 border-t border-line px-5 py-4 ${isNext ? "bg-paper" : ""}`}>
              <div className="flex items-center gap-2.5">
                <span
                  className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                    s.done ? "bg-allow text-paper" : isNext ? "bg-ink text-paper" : "border border-line text-muted"
                  }`}
                  aria-hidden
                >
                  {s.done ? "✓" : i + 1}
                </span>
                <p className={`text-sm font-semibold ${s.done ? "text-muted" : ""}`}>
                  <span className="sr-only">Step {i + 1}{s.done ? " (done)" : ""}: </span>
                  {s.title}
                </p>
              </div>
              <p className="text-xs leading-relaxed text-muted">{s.hint}</p>
              <button
                onClick={s.onRun}
                disabled={busy}
                className={`mt-auto self-start rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                  isNext ? "bg-ink text-paper" : "border border-line text-ink hover:border-ink"
                }`}
              >
                {s.done ? "Run again" : s.action}
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
