import { NextRequest, NextResponse } from "next/server";
import { originOf } from "@/lib/http";
import { ownerApprove } from "@/lib/orchestrator";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const d = await ownerApprove(id, originOf(req));
    return NextResponse.json({ decision: d, redirect: d.payment.approveUrl });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: msg.includes("not found") ? 404 : 500 });
  }
}
