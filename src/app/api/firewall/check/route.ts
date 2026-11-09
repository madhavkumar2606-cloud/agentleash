import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { safeEqual } from "@/lib/auth";
import { firewallApiKey } from "@/lib/config";
import { rateLimit } from "@/lib/rateLimit";
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
  const limited = rateLimit(req, "firewall", 30);
  if (limited) return limited;
  const key = firewallApiKey();
  if (!key && process.env.APP_URL) {
    // Deployed publicly without a key would let anyone create orders and spend your AI quota.
    return NextResponse.json({ error: "Set AGENTLEASH_API_KEY to enable this endpoint on a public deployment." }, { status: 503 });
  }
  if (key && !safeEqual(req.headers.get("authorization") ?? "", `Bearer ${key}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = Proposal.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid proposal", issues: parsed.error.issues }, { status: 400 });
  let origin: string;
  try {
    origin = originOf(req);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
  const d = await submitProposal(parsed.data, origin);
  return NextResponse.json({
    decisionId: d.id,
    verdict: d.verdict,
    summary: d.summary,
    riskScore: d.riskScore,
    checks: d.checks,
    payment: d.payment,
    approvalUrl: d.verdict === "REVIEW" ? `${origin}/approve/${d.id}` : undefined,
  });
}
