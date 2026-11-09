import { NextRequest, NextResponse } from "next/server";
import { runScenario } from "@/lib/agent";
import { originOf } from "@/lib/http";
import { submitProposal } from "@/lib/orchestrator";

/** Runs a demo agent scenario end to end: agent browses -> proposes -> firewall -> PayPal. */
export async function POST(req: NextRequest) {
  const { scenario } = (await req.json().catch(() => ({}))) as { scenario?: string };
  try {
    const run = runScenario(scenario ?? "");
    const decision = await submitProposal(run.proposal, originOf(req));
    return NextResponse.json({ scenario: run.scenario, steps: run.steps, decision });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
