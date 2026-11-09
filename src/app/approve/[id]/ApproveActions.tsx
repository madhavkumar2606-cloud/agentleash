"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PayPalMark, usd } from "@/components/ui";

export default function ApproveActions({ id, amount }: { id: string; amount: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"approve" | "reject">();
  const [error, setError] = useState<string>();

  async function act(kind: "approve" | "reject") {
    setBusy(kind);
    setError(undefined);
    try {
      const res = await fetch(`/api/decisions/${id}/${kind}`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Something went wrong");
      if (kind === "approve") {
        if (!body.redirect) throw new Error(body.decision?.payment?.error ?? "PayPal didn't return a checkout link");
        window.location.href = body.redirect;
        return;
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
      <button
        onClick={() => act("approve")}
        disabled={!!busy}
        className="block w-full rounded-xl bg-[#ffc439] px-4 py-3.5 text-center font-semibold text-ink disabled:opacity-60"
      >
        {busy === "approve" ? "Opening PayPal…" : (
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
