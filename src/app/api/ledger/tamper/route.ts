import { NextResponse } from "next/server";
import { tamperForDemo, verifyLedger } from "@/lib/ledger";

/** Owner only, for the demo: change one past entry behind the ledger's back, then show verify catching it. */
export async function POST() {
  const changed = tamperForDemo();
  if (!changed) return NextResponse.json({ error: "Nothing with an amount to change yet. Run a scenario first." }, { status: 400 });
  return NextResponse.json({ changed: changed.seq, verify: verifyLedger() });
}
