import { NextRequest, NextResponse } from "next/server";
import { releaseHold } from "@/lib/orchestrator";

/** Void the PayPal authorization: the held money never moves. Owner only (middleware). */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return NextResponse.json({ decision: await releaseHold(id) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
