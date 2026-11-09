import { NextRequest, NextResponse } from "next/server";
import { completeCapture } from "@/lib/orchestrator";
import { getDecision } from "@/lib/store";

/** PayPal redirects here after the payer approves. We verify the order matches, then capture. */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("decision") ?? "";
  const token = req.nextUrl.searchParams.get("token");
  const d = getDecision(id);
  if (d && d.payment.orderId && d.payment.orderId === token) await completeCapture(id);
  return NextResponse.redirect(new URL(`/approve/${encodeURIComponent(id)}`, process.env.APP_URL || req.nextUrl.origin));
}
