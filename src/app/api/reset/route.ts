import { NextResponse } from "next/server";
import { resetState } from "@/lib/store";

export function POST() {
  resetState();
  return NextResponse.json({ ok: true });
}
