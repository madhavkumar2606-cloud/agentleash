import { NextResponse } from "next/server";
import { llmConfig, paypalConfig } from "@/lib/config";
import { SCENARIOS } from "@/lib/agent";
import { state, weeklySpent } from "@/lib/store";

export const dynamic = "force-dynamic";

export function GET() {
  const s = state();
  const llm = llmConfig();
  return NextResponse.json({
    mandate: s.mandate,
    decisions: s.decisions.slice(0, 50),
    weeklySpent: weeklySpent(),
    scenarios: SCENARIOS,
    modes: { paypal: paypalConfig().mode, llm: llm.provider, model: llm.model },
  });
}
