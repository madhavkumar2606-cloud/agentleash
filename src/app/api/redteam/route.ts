import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/lib/rateLimit";
import { score, startRedTeam } from "@/lib/redteam";

const Body = z.object({
  target: z.enum(["careful", "naive", "hardened"]).default("careful"),
  count: z.number().int().min(3).max(8).default(6),
  generate: z.boolean().default(true),
  /** Extra instructions for the "hardened" agent (the fix from the last report). */
  fix: z.string().max(1200).optional(),
  /** Re-run the same attacks as an earlier job. */
  reuse: z.string().max(80).optional(),
});

/** Starts a red-team run in the background. Poll GET /api/redteam/{id} for progress. */
export async function POST(req: NextRequest) {
  const limited = rateLimit(req, "redteam", 4); // each run makes many AI calls
  if (limited) return limited;
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid red-team options" }, { status: 400 });
  try {
    const job = startRedTeam(parsed.data);
    return NextResponse.json({ ...job, score: score(job) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
