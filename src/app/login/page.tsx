"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

function LoginForm() {
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  // Only allow redirects back into this app.
  const raw = params.get("next") ?? "/app";
  const next = raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\") ? raw : "/app";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      window.location.href = next;
      return;
    }
    setError((await res.json().catch(() => ({}))).error ?? "Login failed");
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-3">
      <label htmlFor="pw" className="block text-sm font-medium">
        Owner password
      </label>
      <input
        id="pw"
        type="password"
        autoComplete="current-password"
        autoFocus
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-full rounded-lg border border-line bg-card px-3 py-2.5 outline-none focus:border-ink"
      />
      <button
        type="submit"
        disabled={busy || !password}
        className="w-full rounded-lg bg-ink px-3 py-2.5 font-medium text-paper disabled:opacity-50"
      >
        {busy ? "Checking…" : "Log in"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-block">
          {error}
        </p>
      )}
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="mx-auto min-h-screen max-w-sm px-5 pt-24">
      <h1 className="text-2xl font-semibold tracking-tight">Countersign</h1>
      <p className="mt-1 text-sm text-muted">Only the account owner can change rules and approve purchases.</p>
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
