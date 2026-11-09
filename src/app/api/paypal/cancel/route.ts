import { NextRequest, NextResponse } from "next/server";
import { originOf } from "@/lib/http";
import { cancelPayment } from "@/lib/orchestrator";

export function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("decision") ?? "";
  cancelPayment(id);
  return NextResponse.redirect(`${originOf(req)}/approve/${encodeURIComponent(id)}`);
}
