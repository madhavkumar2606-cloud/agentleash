// Browser side of countersigned approvals. The private key is generated non-extractable and kept in
// IndexedDB, so scripts can ask the browser to sign with it but can never read it out.

"use client";

const DB = "countersign";
const STORE = "keys";
const SLOT = "device";

interface Saved {
  privateKey: CryptoKey;
  jwk: JsonWebKey;
  deviceId?: string;
}

export interface ServerDevice {
  id: string;
  label: string;
  fingerprint: string;
  addedAt: string;
  lastUsedAt?: string;
}

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = fn(d.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

const load = () => idb<Saved | undefined>("readonly", (s) => s.get(SLOT)).catch(() => undefined);
const save = (v: Saved) => idb("readwrite", (s) => s.put(v, SLOT));

async function keyPair(): Promise<Saved> {
  const have = await load();
  if (have) return have;
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const full = await crypto.subtle.exportKey("jwk", kp.publicKey);
  const saved = { privateKey: kp.privateKey, jwk: { kty: full.kty, crv: full.crv, x: full.x, y: full.y } };
  await save(saved);
  return saved;
}

export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

/** Server's pinned devices, and whether this browser is one of them. */
export async function deviceStatus(): Promise<{ devices: ServerDevice[]; mine?: ServerDevice; passwordProtected: boolean; supported: boolean }> {
  const supported = typeof indexedDB !== "undefined" && !!crypto?.subtle;
  const r = await fetch("/api/devices", { cache: "no-store" });
  const body = r.ok ? await r.json() : { devices: [], passwordProtected: false };
  const saved = supported ? await load() : undefined;
  const mine = saved?.deviceId ? (body.devices as ServerDevice[]).find((d) => d.id === saved.deviceId) : undefined;
  return { devices: body.devices, mine, passwordProtected: body.passwordProtected, supported };
}

export async function pinThisDevice(password?: string): Promise<ServerDevice> {
  const k = await keyPair();
  const r = await fetch("/api/devices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jwk: k.jwk, label: deviceLabel(), password }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error ?? "Couldn't pin this device");
  await save({ ...k, deviceId: body.device.id });
  return body.device;
}

const b64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Sign one owner action. Returns undefined when this browser has no pinned key (the server decides if that's OK). */
export async function countersign(f: { decisionId: string; action: string; amount: number; currency: string }) {
  const k = await load();
  if (!k?.deviceId) return undefined;
  const payload = JSON.stringify({ v: 1, decisionId: f.decisionId, action: f.action, amount: f.amount.toFixed(2), currency: f.currency, issuedAt: new Date().toISOString() });
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, k.privateKey, new TextEncoder().encode(payload));
  return { deviceId: k.deviceId, payload, signature: b64url(sig) };
}
