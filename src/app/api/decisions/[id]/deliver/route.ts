import { NextRequest, NextResponse } from "next/server";
import { confirmDelivery } from "@/lib/orchestrator";

/** The item arrived: capture the payment PayPal has been holding. Owner only (middleware). */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return NextResponse.json({ decision: await confirmDelivery(id) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
