import { webcrypto } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { addDevice, requireCountersign, resetDevices } from "./devices";
import type { Decision } from "./types";

const d = { id: "dec_1", amount: 79, proposal: { currency: "USD" } } as unknown as Decision;
const b64url = (b: ArrayBuffer) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function device() {
  const kp = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const jwk = await webcrypto.subtle.exportKey("jwk", kp.publicKey);
  const dev = addDevice({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, "Test phone");
  const sign = async (fields: Record<string, unknown>) => {
    const payload = JSON.stringify({ v: 1, decisionId: "dec_1", action: "approve", amount: "79.00", currency: "USD", issuedAt: new Date().toISOString(), ...fields });
    const sig = await webcrypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, kp.privateKey, new TextEncoder().encode(payload));
    return { deviceId: dev.id, payload, signature: b64url(sig) };
  };
  return { dev, sign };
}

describe("countersigned approvals", () => {
  beforeEach(() => resetDevices());

  it("needs no signature until a device is pinned", async () => {
    expect(await requireCountersign(d, "approve", undefined)).toBeNull();
  });

  it("accepts a fresh signature from the pinned device, once", async () => {
    const { dev, sign } = await device();
    const sig = await sign({});
    expect((await requireCountersign(d, "approve", sig))?.id).toBe(dev.id);
    await expect(requireCountersign(d, "approve", sig)).rejects.toThrow(/already used/);
  });

  it("rejects missing, edited, mismatched, expired and foreign signatures", async () => {
    const { sign } = await device();
    await expect(requireCountersign(d, "approve", undefined)).rejects.toThrow(/needs a countersignature/);
    const good = await sign({});
    await expect(requireCountersign(d, "approve", { ...good, payload: good.payload.replace("79.00", "7900.00") })).rejects.toThrow(/different amount/);
    await expect(requireCountersign(d, "approve", { ...good, payload: good.payload.replace('"79.00"', '"79.00" ') })).rejects.toThrow(/doesn't match/);
    await expect(requireCountersign(d, "reject", await sign({}))).rejects.toThrow(/different action/);
    await expect(requireCountersign(d, "approve", await sign({ issuedAt: "2020-01-01T00:00:00Z" }))).rejects.toThrow(/expired/);
    const other = await device();
    const foreign = await other.sign({});
    await expect(requireCountersign(d, "approve", { ...foreign, deviceId: "dev_nope" })).rejects.toThrow(/isn't pinned/);
    // Signed by device B but claiming to be device A.
    const a = (await sign({})).deviceId;
    await expect(requireCountersign(d, "approve", { ...foreign, deviceId: a })).rejects.toThrow(/doesn't match/);
  });
});
