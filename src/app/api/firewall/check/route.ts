import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { firewallApiKey } from "@/lib/config";
import { originOf } from "@/lib/http";
import { submitProposal } from "@/lib/orchestrator";

// Public endpoint for any AI agent: submit a purchase before paying, get ALLOW / REVIEW / BLOCK.
const Proposal = z.object({
  agentId: z.string().min(1).max(100),
  task: z.string().min(1).max(2000),
  merchantId: z.string().min(1).max(100),
  merchantName: z.string().min(1).max(200),
  productId: z.string().max(100).default("external"),
  title: z.string().min(1).max(200),
  category: z.string().min(1).max(100),
  unitPrice: z.number().positive().max(100000),
  quantity: z.number().int().positive().max(1000),
  currency: z.literal("USD").default("USD"),
  productUrl: z.string().max(2000).optional(),
  agentReasoning: z.string().max(4000).default(""),
  pageContent: z.string().max(50000).optional(),
});

export async function POST(req: NextRequest) {
  const key = firewallApiKey();
  if (key && req.headers.get("authorization") !== `Bearer ${key}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = Proposal.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid proposal", issues: parsed.error.issues }, { status: 400 });
  const d = await submitProposal(parsed.data, originOf(req));
  return NextResponse.json({
    decisionId: d.id,
    verdict: d.verdict,
    summary: d.summary,
    riskScore: d.riskScore,
    checks: d.checks,
    payment: d.payment,
    approvalUrl: d.verdict === "REVIEW" ? `${originOf(req)}/approve/${d.id}` : undefined,
  });
}
