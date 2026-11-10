import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { benchState, startBenchJob } from "@/lib/bench/jobs";
import { llmConfig } from "@/lib/config";
import { rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ...benchState(), hasLlm: llmConfig().provider !== "mock" });
}

const Body = z.object({ mode: z.enum(["rules", "full"]) });

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, "bench", 3);
  if (limited) return limited;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "mode must be rules or full" }, { status: 400 });
  if (parsed.data.mode === "full" && llmConfig().provider === "mock")
    return NextResponse.json({ error: "No AI model is configured on this server, so only the rules-only run is available." }, { status: 400 });
  return NextResponse.json({ job: startBenchJob(parsed.data.mode) });
}
