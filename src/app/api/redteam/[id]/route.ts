import { NextResponse } from "next/server";
import { getJob, score } from "@/lib/redteam";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const job = getJob((await params).id);
  if (!job) return NextResponse.json({ error: "Red-team run not found. It may have expired; start a new one." }, { status: 404 });
  return NextResponse.json({ ...job, score: score(job) }, { headers: { "Cache-Control": "no-store" } });
}
