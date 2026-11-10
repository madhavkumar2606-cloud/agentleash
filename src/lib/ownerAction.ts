// Shared handler for owner actions that move or stop money: checks the countersignature first.

import { NextRequest, NextResponse } from "next/server";
import { CountersignError, requireCountersign, type Countersignature, type SignedAction } from "./devices";
import { getDecision, saveDecision } from "./store";
import type { Decision } from "./types";

export async function ownerAction(req: NextRequest, id: string, action: SignedAction, run: (d: Decision) => Promise<Decision> | Decision) {
  const d = getDecision(id);
  if (!d) return NextResponse.json({ error: "Decision not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { countersign?: Countersignature };
  let device;
  try {
    device = await requireCountersign(d, action, body.countersign);
  } catch (err) {
    if (err instanceof CountersignError) return NextResponse.json({ error: err.message, code: err.code }, { status: 403 });
    throw err;
  }
  try {
    const out = await run(d);
    if (device) {
      out.countersigns = [...(out.countersigns ?? []), { action, deviceId: device.id, label: device.label, fingerprint: device.fingerprint, at: new Date().toISOString() }];
      saveDecision(out);
    }
    return NextResponse.json({ decision: out, redirect: action === "approve" ? out.payment.approveUrl : undefined });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
