import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authMode } from "@/lib/auth";
import { addDevice, listDevices, removeDevice } from "@/lib/devices";
import { rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const pub = (d: ReturnType<typeof listDevices>[number]) => ({ id: d.id, label: d.label, fingerprint: d.fingerprint, addedAt: d.addedAt, lastUsedAt: d.lastUsedAt });

export async function GET() {
  return NextResponse.json({ devices: listDevices().map(pub), passwordProtected: authMode() === "locked" });
}

const Add = z.object({ jwk: z.unknown(), label: z.string().max(60).default("Browser"), password: z.string().max(200).optional() });

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, "devices", 6);
  if (limited) return limited;
  const parsed = Add.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Expected { jwk, label }" }, { status: 400 });
  try {
    return NextResponse.json({ device: pub(addDevice(parsed.data.jwk, parsed.data.label, parsed.data.password)) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
}

const Del = z.object({ id: z.string(), password: z.string().max(200).optional() });

export async function DELETE(req: NextRequest) {
  const limited = rateLimit(req, "devices", 6);
  if (limited) return limited;
  const parsed = Del.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Expected { id }" }, { status: 400 });
  try {
    removeDevice(parsed.data.id, parsed.data.password);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
}
