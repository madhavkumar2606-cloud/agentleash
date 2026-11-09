import { NextRequest, NextResponse } from "next/server";
import { ownerReject } from "@/lib/orchestrator";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return NextResponse.json({ decision: ownerReject(id) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 404 });
  }
}
