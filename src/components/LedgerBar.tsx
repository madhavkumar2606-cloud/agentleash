"use client";

// Tamper-evident ledger check. The browser downloads every entry and re-computes the SHA-256 chain
// itself with Web Crypto, so the result does not rely on the server's word.

import { useState } from "react";
import { verifyInBrowser, type LedgerCheck } from "@/lib/canonical";

type Result = LedgerCheck & { tampered?: number };

export default function LedgerBar() {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result>();
  const [error, setError] = useState<string>();

  async function verify(tampered?: number) {
    const r = await fetch("/api/ledger", { cache: "no-store" });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error ?? "Could not load the ledger");
    setRes({ ...(await verifyInBrowser(body.entries)), tampered });
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function tamper() {
    const r = await fetch("/api/ledger/tamper", { method: "POST" });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error ?? "Could not change the entry");
    await verify(body.changed);
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-5 py-2.5 text-xs" data-testid="ledger-bar">
      <span className="font-medium">Tamper-evident ledger</span>
      {res ? (
        res.ok ? (
          <span className="rounded-full bg-allow-bg px-2 py-0.5 font-medium text-allow" role="status">
            Chain intact: your browser re-hashed all {res.count} entries · head {res.head.slice(0, 8)}…{res.head.slice(-4)}
          </span>
        ) : (
          <span className="rounded-full bg-block-bg px-2 py-0.5 font-medium text-block" role="status">
            Chain broken at entry #{res.brokenAt}
            {res.tampered ? ` (we quietly raised the amount in entry #${res.tampered})` : ""}. Every entry after it is now untrusted.
          </span>
        )
      ) : (
        <span className="text-muted">Every decision, payment, rule change and approval is chained with SHA-256.</span>
      )}
      <span className="ml-auto flex gap-2">
        <button onClick={() => run(() => verify())} disabled={busy} className="rounded-lg border border-line px-2.5 py-1 font-medium hover:border-ink disabled:opacity-50">
          {busy ? "Checking…" : "Verify chain"}
        </button>
        <button onClick={() => run(tamper)} disabled={busy} className="rounded-lg border border-line px-2.5 py-1 text-muted hover:border-block hover:text-block disabled:opacity-50" title="Changes one past entry, the way someone with database access might">
          Try tampering
        </button>
      </span>
      {error && <p className="w-full text-block">{error}</p>}
    </div>
  );
}
