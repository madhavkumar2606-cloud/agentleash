import { NextRequest } from "next/server";
import { originOf } from "@/lib/http";
import { ownerApprove } from "@/lib/orchestrator";
import { ownerAction } from "@/lib/ownerAction";

/** Owner only (middleware). Needs a countersignature from a pinned device once one is pinned. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return ownerAction(req, id, "approve", (d) => ownerApprove(d.id, originOf(req)));
}
