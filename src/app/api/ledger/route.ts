import { NextResponse } from "next/server";
import { ledgerEntries, verifyLedger } from "@/lib/ledger";

export const dynamic = "force-dynamic";

/** Owner only: the full hash-chained ledger, oldest first, plus the verification result. */
export async function GET() {
  return NextResponse.json({ verify: verifyLedger(), entries: ledgerEntries() });
}
