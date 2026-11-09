import { NextRequest, NextResponse } from "next/server";
import { cancelPayment } from "@/lib/orchestrator";

export function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("decision") ?? "";
  cancelPayment(id);
  return NextResponse.redirect(new URL(`/approve/${encodeURIComponent(id)}`, process.env.APP_URL || req.nextUrl.origin));
}
