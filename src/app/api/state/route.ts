import { NextResponse } from "next/server";
import { authMode } from "@/lib/auth";
import { llmConfig, paypalConfig } from "@/lib/config";
import { SCENARIOS } from "@/lib/agent";
import { autoReleaseStaleHolds } from "@/lib/orchestrator";
import { SUPPORT_SCENARIOS } from "@/lib/supportAgent";
import { state, weeklySpent } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  // The dashboard polls this, so stale holds are released promptly while anyone is watching.
  await autoReleaseStaleHolds().catch(() => undefined);
  const s = state();
  const llm = llmConfig();
  return NextResponse.json({
    mandate: s.mandate,
    decisions: s.decisions.slice(0, 50),
    weeklySpent: weeklySpent(),
    frozenAt: s.frozenAt ?? null,
    scenarios: SCENARIOS,
    supportScenarios: SUPPORT_SCENARIOS.map(({ id, label, blurb, expected }) => ({ id, label, blurb, expected })),
    modes: { paypal: paypalConfig().mode, llm: llm.provider, model: llm.model, auth: authMode(), webhooks: !!process.env.PAYPAL_WEBHOOK_ID },
  });
}
