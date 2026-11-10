import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { planAuditQuery } from "@/lib/auditQuery";
import { rateLimit } from "@/lib/rateLimit";

/** Plain-English question about the audit log -> AG Grid filter and sort plan. Owner only (middleware). */
export async function POST(req: NextRequest) {
  const limited = rateLimit(req, "audit-ask", 20);
  if (limited) return limited;
  const parsed = z.object({ question: z.string().min(3).max(300) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ask a question (3-300 characters)" }, { status: 400 });
  return NextResponse.json(await planAuditQuery(parsed.data.question));
}
