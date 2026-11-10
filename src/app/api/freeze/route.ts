import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { setFrozen, state } from "@/lib/store";

/** Kill switch: freeze or unfreeze every agent payment and refund. Owner only (see middleware). */
export async function POST(req: NextRequest) {
  const parsed = z.object({ frozen: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Send {"frozen": true | false}' }, { status: 400 });
  setFrozen(parsed.data.frozen);
  return NextResponse.json({ frozenAt: state().frozenAt ?? null });
}
