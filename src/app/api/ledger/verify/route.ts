import { NextResponse } from "next/server";
import { verifyLedger } from "@/lib/ledger";

export const dynamic = "force-dynamic";

/** Public: is the chain intact, and what is its head hash? Reveals no entry contents. */
export async function GET() {
  return NextResponse.json(verifyLedger());
}
