// Countersigned approvals. The owner pins a device: the browser makes a P-256 key pair whose private half
// can't leave it (non-extractable, in IndexedDB) and registers the public half here. Once any device is
// pinned, every approve / decline / release / cancel must carry a signature from a pinned key over the exact
// decision, action and amount. A stolen session cookie alone can no longer move money.

import { createHash, webcrypto } from "node:crypto";
import { authMode, safeEqual } from "./auth";
import { canonical } from "./canonical";
import { appendLedger } from "./ledger";
import type { Decision } from "./types";

export type SignedAction = "approve" | "reject" | "deliver" | "release";

export interface Device {
  id: string;
  label: string;
  fingerprint: string;
  jwk: { kty: "EC"; crv: "P-256"; x: string; y: string };
  addedAt: string;
  lastUsedAt?: string;
}

export interface Countersignature {
  deviceId: string;
  /** JSON text that was signed: {v, decisionId, action, amount, currency, issuedAt} */
  payload: string;
  /** base64url ECDSA P-256 / SHA-256 signature (IEEE P1363, as Web Crypto produces) */
  signature: string;
}

const MAX_AGE_MS = 5 * 60 * 1000;

const g = globalThis as unknown as { __countersignDevices?: { devices: Device[]; used: Set<string> } };
const D = () => (g.__countersignDevices ??= { devices: [], used: new Set() });

export const listDevices = () => D().devices;

export const fingerprintOf = (jwk: Device["jwk"]) =>
  createHash("sha256").update(canonical({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })).digest("hex").slice(0, 16);

const b64url = /^[A-Za-z0-9_-]+$/;

/** Pin a new device. When devices are already pinned on a password-protected deploy, the owner password is required. */
export function addDevice(jwk: unknown, label: string, password?: string): Device {
  const k = jwk as Partial<Device["jwk"]>;
  if (k?.kty !== "EC" || k.crv !== "P-256" || !k.x || !k.y || !b64url.test(k.x) || !b64url.test(k.y)) throw new Error("Expected a P-256 public key.");
  const d = D();
  const key = { kty: "EC" as const, crv: "P-256" as const, x: k.x, y: k.y };
  const fingerprint = fingerprintOf(key);
  const existing = d.devices.find((x) => x.fingerprint === fingerprint);
  if (existing) return existing;
  if (d.devices.length && authMode() === "locked" && !safeEqual(password ?? "", process.env.OWNER_PASSWORD ?? ""))
    throw new Error("Another device is already pinned. Enter the owner password to pin this one too.");
  const device: Device = { id: `dev_${fingerprint.slice(0, 8)}`, label: label.slice(0, 60) || "Browser", fingerprint, jwk: key, addedAt: new Date().toISOString() };
  d.devices.push(device);
  appendLedger("device.pinned", { device: device.id, label: device.label, fingerprint });
  return device;
}

export function removeDevice(id: string, password?: string) {
  if (authMode() === "locked" && !safeEqual(password ?? "", process.env.OWNER_PASSWORD ?? "")) throw new Error("Enter the owner password to unpin a device.");
  const d = D();
  const before = d.devices.length;
  d.devices = d.devices.filter((x) => x.id !== id);
  if (d.devices.length !== before) appendLedger("device.unpinned", { device: id });
}

function fromB64url(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
}

/** What the device must sign for this action on this decision. */
export function expectedFields(d: Decision, action: SignedAction) {
  return { decisionId: d.id, action, amount: d.amount.toFixed(2), currency: d.proposal.currency };
}

/**
 * Check the countersignature for an owner action. Returns the device that signed, or null when no device
 * is pinned (session-only mode). Throws with a user-facing reason when a signature is required but wrong.
 */
export async function requireCountersign(d: Decision, action: SignedAction, sig: Countersignature | undefined): Promise<Device | null> {
  const store = D();
  if (!store.devices.length) return null;
  if (!sig?.deviceId || !sig.payload || !sig.signature) throw new CountersignError("This approval needs a countersignature from your pinned device.");
  const device = store.devices.find((x) => x.id === sig.deviceId);
  if (!device) throw new CountersignError("That device isn't pinned to this account.");
  if (store.used.has(sig.signature)) throw new CountersignError("This signature was already used.");

  let p: Record<string, unknown>;
  try {
    p = JSON.parse(sig.payload);
  } catch {
    throw new CountersignError("The signed approval is unreadable.");
  }
  const want = expectedFields(d, action);
  for (const [k, v] of Object.entries(want))
    if (p[k] !== v) throw new CountersignError(`The signed approval is for a different ${k === "decisionId" ? "request" : k} than this one.`);
  const age = Date.now() - Date.parse(String(p.issuedAt));
  if (!(age >= -60_000 && age <= MAX_AGE_MS)) throw new CountersignError("The signed approval has expired. Try again.");

  const key = await webcrypto.subtle.importKey("jwk", { ...device.jwk, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const ok = await webcrypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, fromB64url(sig.signature), new TextEncoder().encode(sig.payload));
  if (!ok) throw new CountersignError("The signature doesn't match your pinned device.");

  store.used.add(sig.signature);
  device.lastUsedAt = new Date().toISOString();
  appendLedger("countersigned", { id: d.id, action, amount: want.amount, device: device.id, fingerprint: device.fingerprint, signature: sig.signature });
  return device;
}

export class CountersignError extends Error {
  readonly code = "countersign_required";
}

export function resetDevices() {
  g.__countersignDevices = { devices: [], used: new Set() };
}
