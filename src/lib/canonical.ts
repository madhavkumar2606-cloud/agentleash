// Canonical JSON (sorted keys, no whitespace), shared by the server and the browser so both
// compute the same ledger hashes. Undefined values are dropped, like JSON.stringify does.

export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : canonical(x))).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(",")}}`;
}

export interface LedgerEntry {
  seq: number;
  at: string;
  type: string;
  data: Record<string, unknown>;
  prevHash: string;
  /** sha256(prevHash + canonical({seq, at, type, data})) as hex */
  hash: string;
}

export const GENESIS = "0".repeat(64);

/** The exact bytes that get hashed for an entry. */
export const entryPreimage = (e: Pick<LedgerEntry, "seq" | "at" | "type" | "data" | "prevHash">) =>
  e.prevHash + canonical({ seq: e.seq, at: e.at, type: e.type, data: e.data });

export type LedgerCheck = { ok: boolean; count: number; head: string; brokenAt?: number };

/** Independent check with Web Crypto, so the browser does not have to take the server's word. */
export async function verifyInBrowser(entries: LedgerEntry[]): Promise<LedgerCheck> {
  const sha256 = async (s: string) =>
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  let prev = entries[0]?.prevHash ?? GENESIS;
  for (const e of entries) {
    if (e.prevHash !== prev || (await sha256(entryPreimage(e))) !== e.hash) return { ok: false, count: entries.length, head: prev, brokenAt: e.seq };
    prev = e.hash;
  }
  return { ok: true, count: entries.length, head: prev };
}
