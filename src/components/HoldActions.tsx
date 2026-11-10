"use client";

import { useState } from "react";
import { PayPalMark, usd } from "./ui";

/**
 * PayPal is holding the money (an authorization). The owner releases it to the seller when the item
 * arrives, or voids the hold and the money never moves.
 */
export default function HoldActions({ id, amount, onDone, size = "md" }: { id: string; amount: number; onDone?: () => void; size?: "sm" | "md" }) {
  const [busy, setBusy] = useState<"deliver" | "release">();
  const [error, setError] = useState<string>();

  async function act(action: "deliver" | "release") {
    setBusy(action);
    setError(undefined);
    try {
      const res = await fetch(`/api/decisions/${id}/${action}`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Something went wrong");
      // Still held after the call means PayPal refused; the error says why.
      if (body.decision?.payment?.status === "authorized") throw new Error(body.decision.payment.error ?? "PayPal didn't complete it");
      if (onDone) onDone();
      else window.location.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  }

  const pad = size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-3 text-sm";
  return (
    <div className="space-y-2">
      <div className={`flex ${size === "sm" ? "flex-wrap gap-2" : "flex-col gap-2"}`}>
        <button onClick={() => act("deliver")} disabled={!!busy} className={`rounded-lg bg-[#ffc439] font-semibold text-ink disabled:opacity-60 ${pad}`}>
          {busy === "deliver" ? "Releasing…" : (
            <>
              It arrived: pay {usd(amount)} via <PayPalMark />
            </>
          )}
        </button>
        <button onClick={() => act("release")} disabled={!!busy} className={`rounded-lg border border-line bg-card font-medium disabled:opacity-60 ${pad}`}>
          {busy === "release" ? "Releasing the hold…" : "It never came: cancel the hold"}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-block">
          {error}
        </p>
      )}
    </div>
  );
}
