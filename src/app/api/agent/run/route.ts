import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runScenario, SCENARIOS } from "@/lib/agent";
import { llmConfig } from "@/lib/config";
import { originOf } from "@/lib/http";
import { runLiveAgent } from "@/lib/liveAgent";
import { submitProposal, submitToolCall } from "@/lib/orchestrator";
import { runSupportAgent } from "@/lib/supportAgent";
import { rateLimit } from "@/lib/rateLimit";

const Body = z.object({
  scenario: z.string().optional(),
  /** Merchant-side demo: run the support agent on this ticket scenario. */
  support: z.string().optional(),
  task: z.string().min(5).max(500).optional(),
  live: z.boolean().default(true),
});

/**
 * Runs the shopping agent end to end: agent browses -> proposes -> firewall -> PayPal.
 * With an LLM configured, the agent is a real AI deciding for itself ("live").
 * Without one, or if the AI call fails, scenarios fall back to the scripted agent.
 */
export async function POST(req: NextRequest) {
  const limited = rateLimit(req, "agent", 8); // each run makes several AI calls
  if (limited) return limited;
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Give a scenario or a task (5–500 characters)" }, { status: 400 });
  const { scenario: scenarioId, task, live, support } = parsed.data;
  const hasLlm = llmConfig().provider !== "mock";

  try {
    if (support) {
      const run = await runSupportAgent(support, live);
      const scenario = { id: run.scenario.id, label: run.scenario.label, task: run.steps[0].text, trapAmount: run.scenario.trapAmount };
      if (!run.call) return NextResponse.json({ scenario, steps: run.steps, agentMode: run.agentMode, profile: run.scenario.profile, decision: null });
      const decision = await submitToolCall(run.call, { execute: true });
      return NextResponse.json({ scenario, steps: run.steps, agentMode: run.agentMode, profile: run.scenario.profile, decision });
    }

    // Free-form task: needs the live agent.
    if (task && !scenarioId) {
      if (!hasLlm) return NextResponse.json({ error: "Custom tasks need an AI provider. Set LLM_PROVIDER and LLM_API_KEY." }, { status: 400 });
      const run = await runLiveAgent(task);
      if (!run) return NextResponse.json({ error: "The AI agent call failed. Check the server log and your API key." }, { status: 502 });
      const scenario = { id: "custom", label: "Your task", blurb: task, task, expected: undefined };
      if (!run.proposal) return NextResponse.json({ scenario, steps: run.steps, agentMode: "live", profile: run.profile, decision: null });
      const decision = await submitProposal(run.proposal, originOf(req));
      return NextResponse.json({ scenario, steps: run.steps, agentMode: "live", profile: run.profile, decision });
    }

    const scenario = SCENARIOS.find((s) => s.id === scenarioId);
    if (!scenario) return NextResponse.json({ error: `Unknown scenario: ${scenarioId}` }, { status: 400 });

    if (hasLlm && live) {
      const run = await runLiveAgent(scenario.task, scenario.id);
      if (run) {
        if (!run.proposal) return NextResponse.json({ scenario, steps: run.steps, agentMode: "live", profile: run.profile, decision: null });
        const decision = await submitProposal(run.proposal, originOf(req));
        return NextResponse.json({ scenario, steps: run.steps, agentMode: "live", profile: run.profile, decision });
      }
    }
    const run = runScenario(scenario.id);
    const decision = await submitProposal(run.proposal, originOf(req));
    return NextResponse.json({ scenario, steps: run.steps, agentMode: "scripted", decision });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
