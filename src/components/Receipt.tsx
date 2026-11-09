// Visual pieces for the verdict "receipt": a rubber stamp, a risk dial, a dotted price line,
// scenario icons and the weekly spend ring. Pure presentation, no state.

import type { Verdict } from "@/lib/types";

const STAMP: Record<Verdict, { text: string; cls: string }> = {
  ALLOW: { text: "Approved", cls: "text-allow" },
  REVIEW: { text: "On hold", cls: "text-review" },
  BLOCK: { text: "Blocked", cls: "text-block" },
};

/** A rubber stamp that thumps down when the verdict lands. */
export function Stamp({ verdict }: { verdict: Verdict }) {
  const s = STAMP[verdict];
  return (
    <span
      className={`stamp pointer-events-none inline-block select-none whitespace-nowrap rounded-md border-[3px] border-current px-3 py-1 text-xl font-bold uppercase tracking-[0.12em] ${s.cls}`}
      aria-hidden
    >
      <span className="block rounded-sm border border-current px-2 py-0.5">{s.text}</span>
    </span>
  );
}

/** Half-circle gauge for the 0–100 risk score. */
export function RiskDial({ score }: { score: number }) {
  const r = 34;
  const len = Math.PI * r;
  const tone = score >= 60 ? "var(--color-block)" : score >= 25 ? "var(--color-review)" : "var(--color-allow)";
  const angle = -90 + (score / 100) * 180;
  return (
    <figure className="flex flex-col items-center" aria-label={`Risk score ${score} out of 100`}>
      <svg width="88" height="52" viewBox="0 0 88 52" aria-hidden>
        <path d="M10 46 A34 34 0 0 1 78 46" fill="none" stroke="var(--color-line)" strokeWidth="7" strokeLinecap="round" />
        <path
          className="dial-arc"
          d="M10 46 A34 34 0 0 1 78 46"
          fill="none"
          stroke={tone}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={len}
          style={{ ["--dial-off" as string]: `${len - (score / 100) * len}`, strokeDashoffset: len - (score / 100) * len }}
        />
        <g className="dial-needle" style={{ ["--needle" as string]: `${angle}deg`, transform: `rotate(${angle}deg)`, transformOrigin: "44px 46px" }}>
          <line x1="44" y1="46" x2="44" y2="18" stroke="var(--color-ink)" strokeWidth="2.5" strokeLinecap="round" />
        </g>
        <circle cx="44" cy="46" r="4" fill="var(--color-ink)" />
      </svg>
      <figcaption className="-mt-0.5 text-center leading-none">
        <span className="text-lg font-semibold tabular-nums" style={{ color: tone }}>
          {score}
        </span>
        <span className="text-xs text-muted"> risk</span>
      </figcaption>
    </figure>
  );
}

/** "1 × Herb Garden Starter Kit ........ $28.00" */
export function PriceLine({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="font-semibold">{left}</span>
      <span className="mb-1 flex-1 border-b-2 border-dotted border-line" aria-hidden />
      <span className="font-semibold tabular-nums">{right}</span>
    </div>
  );
}

const ICON_TONE: Record<string, string> = {
  clean: "bg-allow-bg text-allow",
  injection: "bg-block-bg text-block",
  drift: "bg-review-bg text-review",
  gouged: "bg-review-bg text-review",
  bigticket: "bg-[#e6eefb] text-pp-light",
};

/** One small pictogram per scenario: what kind of trouble it is. */
export function ScenarioIcon({ id }: { id: string }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const paths: Record<string, React.ReactNode> = {
    // shield with a check: an honest purchase
    clean: (
      <>
        <path {...p} d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" />
        <path {...p} d="M8.5 12l2.5 2.5 4.5-5" />
      </>
    ),
    // eye with a slash: text hidden from humans
    injection: (
      <>
        <path {...p} d="M3 12s3.5-6 9-6c2 0 3.7.8 5 1.8M21 12s-3.5 6-9 6c-2 0-3.7-.8-5-1.8" />
        <path {...p} d="M9.9 14.1a3 3 0 0 1 4.2-4.2M4 20L20 4" />
      </>
    ),
    // a path that wanders off
    drift: (
      <>
        <circle {...p} cx="5" cy="19" r="2" />
        <path {...p} d="M7 19h5a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h8" />
        <path {...p} d="M15 4l3 3-3 3" />
      </>
    ),
    // a price tag
    gouged: (
      <>
        <path {...p} d="M3 12V4h8l10 10-8 8L3 12z" />
        <circle {...p} cx="7.5" cy="8.5" r="1.5" />
      </>
    ),
    // a phone
    bigticket: (
      <>
        <rect {...p} x="7" y="2.5" width="10" height="19" rx="2" />
        <path {...p} d="M11 18.5h2" />
      </>
    ),
  };
  return (
    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${ICON_TONE[id] ?? "bg-line text-ink"}`} aria-hidden>
      <svg width="20" height="20" viewBox="0 0 24 24">
        {paths[id] ?? paths.clean}
      </svg>
    </span>
  );
}

/** Ring showing how much of the weekly budget agents have spent. */
export function SpendRing({ spent, limit }: { spent: number; limit: number }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  const pct = Math.min(1, spent / limit);
  const tone = pct > 0.8 ? "var(--color-block)" : pct > 0.5 ? "var(--color-review)" : "var(--color-ink)";
  return (
    <svg width="76" height="76" viewBox="0 0 76 76" role="img" aria-label={`${Math.round(pct * 100)}% of the weekly budget used`}>
      <circle cx="38" cy="38" r={r} fill="none" stroke="var(--color-line)" strokeWidth="8" />
      <circle
        cx="38"
        cy="38"
        r={r}
        fill="none"
        stroke={tone}
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        transform="rotate(-90 38 38)"
        style={{ transition: "stroke-dashoffset 600ms cubic-bezier(.2,.7,.2,1)" }}
      />
      <text x="38" y="42" textAnchor="middle" className="fill-ink text-[13px] font-semibold tabular-nums">
        {Math.round(pct * 100)}%
      </text>
    </svg>
  );
}
