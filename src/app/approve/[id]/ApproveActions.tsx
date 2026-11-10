"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import CountersignBar from "@/components/CountersignBar";
import { PayPalMark, usd } from "@/components/ui";
import { countersign } from "@/lib/deviceKey";

export default function ApproveActions({
  id,
  amount,
  currency = "USD",
  kind = "purchase",
}: {
  id: string;
  amount: number;
  currency?: string;
  kind?: "purchase" | "refund" | "tool";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"approve" | "reject">();
  const [error, setError] = useState<string>();
  const [refreshKey, setRefreshKey] = useState(0);

  async function act(action: "approve" | "reject") {
    setBusy(action);
    setError(undefined);
    try {
      const sig = await countersign({ decisionId: id, action, amount, currency }).catch(() => undefined);
      const res = await fetch(`/api/decisions/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ countersign: sig }),
      });
      const body = await res.json();
      if (body.code === "countersign_required") setRefreshKey((k) => k + 1);
      if (!res.ok) throw new Error(body.error ?? "Something went wrong");
      if (action === "approve" && body.redirect) {
        window.location.href = body.redirect;
        return;
      }
      if (action === "approve" && body.decision?.payment?.status === "failed") {
        throw new Error(body.decision.payment.error ?? "PayPal didn't complete it");
      }
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <div className="space-y-3">
      <CountersignBar refreshKey={refreshKey} />
      <button
        onClick={() => act("approve")}
        disabled={!!busy}
        className="block w-full rounded-xl bg-[#ffc439] px-4 py-3.5 text-center font-semibold text-ink disabled:opacity-60"
      >
        {busy === "approve" ? (kind === "purchase" ? "Opening PayPal…" : "Approving…") : kind === "refund" ? (
          <>
            Approve {usd(amount)} refund via <PayPalMark />
          </>
        ) : kind === "tool" ? (
          "Approve this PayPal action"
        ) : (
          <>
            Approve {usd(amount)} and pay with <PayPalMark />
          </>
        )}
      </button>
      <button
        onClick={() => act("reject")}
        disabled={!!busy}
        className="block w-full rounded-xl border border-line bg-card px-4 py-3 font-medium disabled:opacity-60"
      >
        {busy === "reject" ? "Declining…" : "Decline"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-block">
          {error}
        </p>
      )}
    </div>
  );
}
