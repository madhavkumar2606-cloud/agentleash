import type { PaymentStatus, Verdict } from "@/lib/types";
import { usd } from "./ui";

/**
 * Shows where the money is: Agent → Countersign → PayPal, and whether it got through.
 * The second link is the one that changes: green when paid, amber while held, red and cut when blocked.
 */
export function FlowBar({ verdict, payment, amount }: { verdict: Verdict; payment: PaymentStatus; amount: number }) {
  const held = verdict === "REVIEW" && (payment === "awaiting_owner" || payment === "rejected");
  const ok = payment === "approved";
  const blocked = verdict === "BLOCK";
  const paid = payment === "captured" || payment === "refunded";
  const onHold = payment === "authorized";

  const link = blocked
    ? "bg-block"
    : onHold
      ? "bg-[repeating-linear-gradient(90deg,var(--color-pp-light)_0_6px,transparent_6px_11px)]"
      : paid || ok || payment === "awaiting_payer"
      ? "bg-allow"
      : held
        ? "bg-[repeating-linear-gradient(90deg,var(--color-review)_0_6px,transparent_6px_11px)]"
        : "bg-line";

  const caption = blocked
    ? `${usd(amount)} never reached PayPal.`
    : payment === "rejected"
      ? `You declined. ${usd(amount)} stayed with you.`
      : onHold
        ? `PayPal is holding ${usd(amount)}. It moves only when you confirm delivery.`
        : payment === "voided"
          ? `Hold cancelled. ${usd(amount)} never left your account.`
      : held
        ? `Held at Countersign until you approve.`
        : payment === "refunded"
          ? `${usd(amount)} refunded through PayPal.`
          : payment === "approved"
            ? "Approved. The agent may run this call once."
            : paid
          ? `${usd(amount)} paid through PayPal.`
          : payment === "awaiting_payer"
            ? `Cleared. ${usd(amount)} is waiting at PayPal checkout.`
            : payment === "failed"
              ? "PayPal didn't complete the payment."
              : "";

  return (
    <figure className="my-4" aria-label={`Money flow: ${caption}`}>
      <div className="flex items-center gap-2 text-xs font-medium">
        <Node label="Agent" />
        <span className="h-0.5 flex-1 rounded-full bg-ink/70" aria-hidden />
        <Node label="Countersign" strong tone={blocked ? "block" : held ? "review" : "allow"} />
        <span className={`relative h-0.5 flex-1 rounded-full ${link}`} aria-hidden>
          {blocked && (
            <span className="cut absolute left-1/2 top-1/2 grid h-5 w-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-block text-[11px] font-bold text-white">
              ✕
            </span>
          )}
        </span>
        <Node label="PayPal" tone={paid || onHold ? "pp" : undefined} dim={blocked} />
      </div>
      {caption && (
        <figcaption className={`mt-2 text-sm font-medium ${blocked ? "text-block" : held ? "text-review" : onHold ? "text-pp-light" : payment === "voided" ? "text-muted" : "text-allow"}`}>
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

function Node({
  label,
  strong,
  tone,
  dim,
}: {
  label: string;
  strong?: boolean;
  tone?: "block" | "review" | "allow" | "pp";
  dim?: boolean;
}) {
  const ring =
    tone === "block"
      ? "border-block text-block"
      : tone === "review"
        ? "border-review text-review"
        : tone === "allow"
          ? "border-allow text-allow"
          : tone === "pp"
            ? "border-pp text-pp"
            : "border-line text-ink";
  return (
    <span
      className={`shrink-0 rounded-md border bg-card px-2 py-1 ${ring} ${strong ? "border-2 font-semibold" : ""} ${dim ? "opacity-40" : ""}`}
    >
      {label}
    </span>
  );
}
