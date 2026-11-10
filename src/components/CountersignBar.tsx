"use client";

// Shows whether this browser countersigns approvals, and lets the owner pin it.

import { useEffect, useState } from "react";
import { deviceStatus, pinThisDevice, type ServerDevice } from "@/lib/deviceKey";

type Status = Awaited<ReturnType<typeof deviceStatus>>;

function Shield({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className={`h-4 w-4 shrink-0 ${className}`}>
      <path d="M10 2 3.5 4.5v5c0 4 2.8 7 6.5 8.5 3.7-1.5 6.5-4.5 6.5-8.5v-5L10 2Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="m7 10 2 2 4-4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function CountersignBar({ refreshKey = 0 }: { refreshKey?: number }) {
  const [st, setSt] = useState<Status>();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    deviceStatus().then(setSt).catch(() => undefined);
  }, [refreshKey]);

  if (!st || !st.supported) return null;

  async function pin() {
    setBusy(true);
    setError(undefined);
    try {
      await pinThisDevice(password || undefined);
      setPassword("");
      setSt(await deviceStatus());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const keyText = (d: ServerDevice) => `key ${d.fingerprint.slice(0, 4)} ${d.fingerprint.slice(4, 8)}`;

  if (st.mine)
    return (
      <p className="flex items-center gap-2 rounded-lg bg-allow-bg px-3 py-2 text-sm text-allow" data-testid="countersign" data-state="pinned">
        <Shield />
        <span>
          This device countersigns your approvals ({st.mine.label}, {keyText(st.mine)}). A stolen login can&apos;t approve payments without it.
        </span>
      </p>
    );

  const othersPinned = st.devices.length > 0;
  const needsPassword = othersPinned && st.passwordProtected;
  return (
    <div className={`rounded-lg border px-3 py-2.5 text-sm ${othersPinned ? "border-review bg-review-bg" : "border-line bg-paper"}`} data-testid="countersign" data-state={othersPinned ? "other" : "none"}>
      <p className="flex items-start gap-2">
        <Shield className={othersPinned ? "mt-0.5 text-review" : "mt-0.5 text-muted"} />
        <span>
          {othersPinned
            ? `Only your pinned device${st.devices.length > 1 ? "s" : ""} (${st.devices.map((d) => d.label).join(", ")}) can approve payments. Pin this browser too to approve here.`
            : "Pin this browser to countersign approvals. Its key never leaves the browser, so a stolen login can't approve payments, and pinning another device needs your password."}
        </span>
      </p>
      <form
        className="mt-2 flex flex-wrap items-center gap-2 pl-6"
        onSubmit={(e) => {
          e.preventDefault();
          pin();
        }}
      >
        {needsPassword && (
          <>
            <label htmlFor="pin-pw" className="sr-only">
              Owner password
            </label>
            <input
              id="pin-pw"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Owner password"
              className="min-w-0 flex-1 rounded-lg border border-line bg-card px-3 py-1.5 text-sm outline-none focus:border-ink"
            />
          </>
        )}
        <button type="submit" disabled={busy || (needsPassword && !password)} className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-paper disabled:opacity-50">
          {busy ? "Pinning…" : "Pin this browser"}
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-1 pl-6 text-block">
          {error}
        </p>
      )}
    </div>
  );
}
