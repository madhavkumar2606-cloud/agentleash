import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { safeEqual } from "@/lib/auth";
import { firewallApiKey } from "@/lib/config";
import { isGuarded } from "@/lib/guard";
import { originOf } from "@/lib/http";
import { submitToolCall } from "@/lib/orchestrator";
import { rateLimit } from "@/lib/rateLimit";

// Check a money-moving PayPal MCP / Agent Toolkit tool call before it runs.
// Used by the Countersign Guard MCP server (mcp/paypal-guard.mts) and by any agent framework.
const Body = z.object({
  agentId: z.string().min(1).max(100).default("mcp-agent"),
  tool: z.string().min(1).max(60),
  args: z.record(z.string(), z.unknown()),
  task: z.string().min(1).max(2000),
  context: z.string().max(50000).optional(),
  agentReasoning: z.string().max(4000).default(""),
  /** Let Countersign run the call itself when allowed (supported: create_refund). */
  execute: z.boolean().default(false),
});

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, "guard", 30);
  if (limited) return limited;
  const key = firewallApiKey();
  if (!key && process.env.APP_URL) {
    return NextResponse.json({ error: "Set COUNTERSIGN_API_KEY to enable this endpoint on a public deployment." }, { status: 503 });
  }
  if (key && !safeEqual(req.headers.get("authorization") ?? "", `Bearer ${key}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid tool call", issues: parsed.error.issues }, { status: 400 });
  if (!isGuarded(parsed.data.tool)) {
    return NextResponse.json({ verdict: "ALLOW", summary: `${parsed.data.tool} is read-only. No check needed.`, checks: [] });
  }
  let origin: string;
  try {
    origin = originOf(req);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
  const d = await submitToolCall(parsed.data, { execute: parsed.data.execute });
  return NextResponse.json({
    decisionId: d.id,
    verdict: d.verdict,
    summary: d.summary,
    riskScore: d.riskScore,
    amount: d.amount,
    checks: d.checks,
    executed: d.payment.status === "refunded" ? { refundId: d.payment.refundId } : undefined,
    error: d.payment.status === "failed" ? d.payment.error : undefined,
    approvalUrl: d.verdict === "REVIEW" ? `${origin}/approve/${d.id}` : undefined,
  });
}
