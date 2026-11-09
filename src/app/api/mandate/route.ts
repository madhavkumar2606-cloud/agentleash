import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parsePolicy } from "@/lib/firewall/rules";
import { newId, state } from "@/lib/store";

const Body = z.object({ rulesText: z.string().min(5).max(2000) });

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "rulesText is required" }, { status: 400 });
  const { policy, parsedBy } = await parsePolicy(parsed.data.rulesText);
  const s = state();
  s.mandate = { id: newId("mandate"), rulesText: parsed.data.rulesText, policy, parsedBy, createdAt: new Date().toISOString() };
  return NextResponse.json({ mandate: s.mandate });
}
