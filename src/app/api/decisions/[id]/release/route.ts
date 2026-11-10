import { NextRequest } from "next/server";
import { releaseHold } from "@/lib/orchestrator";
import { ownerAction } from "@/lib/ownerAction";

/** Owner only (middleware). Needs a countersignature from a pinned device once one is pinned. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return ownerAction(req, id, "release", (d) => releaseHold(d.id));
}
