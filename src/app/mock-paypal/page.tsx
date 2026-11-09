// Stand-in for PayPal checkout when no sandbox credentials are set.
// Clearly labelled as simulated; add PAYPAL_CLIENT_ID/SECRET to use real PayPal sandbox checkout.

import Link from "next/link";
import { PayPalMark } from "@/components/ui";

export default async function MockPayPal({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; return?: string; amount?: string; item?: string }>;
}) {
  const { token = "", return: ret = "/", amount = "0.00", item = "" } = await searchParams;
  // Only ever return to this app's own PayPal return route (no open redirects).
  let decision = "";
  try {
    const u = new URL(ret, "http://local");
    if (u.pathname === "/api/paypal/return") decision = u.searchParams.get("decision") ?? "";
  } catch {}
  const q = `decision=${encodeURIComponent(decision)}`;
  const safePay = `/api/paypal/return?${q}&token=${encodeURIComponent(token)}`;
  const cancelUrl = `/api/paypal/cancel?${q}`;

  return (
    <main className="mx-auto min-h-screen max-w-sm px-5 pt-10">
      <div className="rounded-lg bg-review-bg px-3 py-2 text-xs text-review">
        Simulated checkout (mock mode). Add PayPal sandbox keys to use real PayPal.
      </div>
      <div className="mt-6 rounded-2xl border border-line bg-white p-6 shadow-sm">
        <PayPalMark className="text-2xl" />
        <p className="mt-6 text-sm text-muted">Pay AgentLeash merchant</p>
        <p className="mt-1 text-3xl font-semibold tabular-nums">${amount} USD</p>
        <p className="mt-2 text-sm">{item}</p>
        <p className="mt-1 font-mono text-xs text-muted">Order {token}</p>
        <a href={safePay} className="mt-6 block rounded-full bg-pp-light py-3 text-center font-semibold text-white">
          Pay Now
        </a>
        <Link href={cancelUrl} className="mt-3 block text-center text-sm text-pp-light">
          Cancel and return
        </Link>
      </div>
    </main>
  );
}
