// Countersign Guard for PayPal MCP.
//
// A drop-in replacement for PayPal's official MCP server. It starts PayPal's server underneath and
// exposes exactly the same tools, but every money-moving call (refunds, captures, orders, dispute
// acceptances, invoice sends, subscription changes) must clear Countersign before PayPal sees it.
// Read-only tools (list_transactions, get_order, list_invoices, ...) pass straight through.
//
//   npm run paypal-guard
//
// Environment:
//   COUNTERSIGN_URL        your Countersign app (default http://localhost:3000)
//   COUNTERSIGN_API_KEY    same key as the app's COUNTERSIGN_API_KEY
//   PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET   sandbox app keys (or PAYPAL_ACCESS_TOKEN)
//
// Claude Desktop / Cursor config:
//   { "mcpServers": { "paypal": { "command": "npx", "args": ["tsx", "/path/to/countersign/mcp/paypal-guard.mts"],
//       "env": { "COUNTERSIGN_URL": "...", "COUNTERSIGN_API_KEY": "...", "PAYPAL_CLIENT_ID": "...", "PAYPAL_CLIENT_SECRET": "..." } } } }

import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from "@modelcontextprotocol/sdk/types.js";

const BASE = ((process.env.COUNTERSIGN_URL || process.env.AGENTLEASH_URL) || "http://localhost:3000").replace(/\/$/, "");
const KEY = (process.env.COUNTERSIGN_API_KEY || process.env.AGENTLEASH_API_KEY);
const log = (...a: unknown[]) => console.error("[countersign-guard]", ...a); // stderr: stdout is the MCP channel

/** Tools that move money or end revenue. Keep in sync with GUARDED_TOOLS in src/lib/types.ts. */
const GUARDED = new Set([
  "create_refund",
  "pay_order",
  "create_order",
  "accept_dispute_claim",
  "send_invoice",
  "cancel_sent_invoice",
  "create_subscription",
  "cancel_subscription",
]);
/** Countersign can execute these itself after approval (it holds the PayPal keys). */
const EXECUTED_BY_COUNTERSIGN = new Set(["create_refund"]);

const EXTRA_PROPS = {
  countersign_task: {
    type: "string",
    description: "Countersign: the job you were given, in the operator's words (e.g. 'Resolve support ticket #4812 about order X').",
  },
  countersign_context: {
    type: "string",
    description: "Countersign: the untrusted text that led to this call (customer email, ticket, chat, web page), verbatim.",
  },
  countersign_reasoning: { type: "string", description: "Countersign: one or two sentences on why you are making this call." },
};

async function paypalToken(): Promise<string> {
  if (process.env.PAYPAL_ACCESS_TOKEN) return process.env.PAYPAL_ACCESS_TOKEN;
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (sandbox) or PAYPAL_ACCESS_TOKEN.");
  const res = await fetch("https://api-m.sandbox.paypal.com/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal auth failed (${res.status})`);
  return (await res.json()).access_token;
}

// ---- upstream: PayPal's official MCP server ----
const require = createRequire(import.meta.url);
const upstream = new Client({ name: "countersign-guard", version: "0.3.0" });
await upstream.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [require.resolve("@paypal/mcp/dist/index.js"), "--tools=all"],
    env: { ...(process.env as Record<string, string>), PAYPAL_ACCESS_TOKEN: await paypalToken(), PAYPAL_ENVIRONMENT: "SANDBOX" },
    stderr: "ignore",
  }),
);
const { tools: upstreamTools } = await upstream.listTools();
log(`PayPal MCP started: ${upstreamTools.length} tools, ${upstreamTools.filter((t) => GUARDED.has(t.name)).length} guarded by Countersign at ${BASE}`);

const tools: Tool[] = upstreamTools.map((t) => {
  if (!GUARDED.has(t.name)) return t;
  const schema = t.inputSchema as { properties?: Record<string, unknown>; required?: string[] };
  return {
    ...t,
    description:
      `[Guarded by Countersign] This call moves money, so Countersign checks it against the operator's rules and the real PayPal records first. ` +
      `Always fill countersign_task, countersign_context and countersign_reasoning. ` +
      (t.description ?? ""),
    inputSchema: { ...schema, properties: { ...(schema.properties ?? {}), ...EXTRA_PROPS }, required: [...(schema.required ?? []), "countersign_task"] } as Tool["inputSchema"],
  };
});

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], isError });

async function guardCheck(tool: string, args: Record<string, unknown>, task: string, context: string | undefined, reasoning: string) {
  const res = await fetch(`${BASE}/api/guard/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(KEY ? { Authorization: `Bearer ${KEY}` } : {}) },
    body: JSON.stringify({ agentId: "paypal-guard-mcp", tool, args, task, context, agentReasoning: reasoning, execute: EXECUTED_BY_COUNTERSIGN.has(tool) }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Countersign returned ${res.status}`);
  return body as {
    verdict: "ALLOW" | "REVIEW" | "BLOCK";
    summary: string;
    riskScore?: number;
    checks: { label: string; status: string; detail: string }[];
    executed?: { refundId: string };
    error?: string;
    approvalUrl?: string;
  };
}

// ---- downstream: the server the agent talks to ----
const server = new Server({ name: "paypal (guarded by Countersign)", version: "0.3.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name } = req.params;
  const raw = (req.params.arguments ?? {}) as Record<string, unknown>;
  if (!GUARDED.has(name)) return upstream.callTool({ name, arguments: raw });

  const { countersign_task, countersign_context, countersign_reasoning, ...args } = raw;
  let v;
  try {
    v = await guardCheck(name, args, String(countersign_task ?? "(the agent did not say)"), countersign_context as string | undefined, String(countersign_reasoning ?? ""));
  } catch (err) {
    // Fail closed: if Countersign can't be reached, money does not move.
    return text(`Countersign could not check this call, so it was not run: ${(err as Error).message}`, true);
  }
  const reasons = v.checks.map((c) => `- ${c.status.toUpperCase()} ${c.label}: ${c.detail}`).join("\n");
  log(`${name} → ${v.verdict}: ${v.summary}`);

  if (v.verdict === "BLOCK") return text(`BLOCKED by Countersign. Do not retry or work around this.\n${v.summary}\n${reasons}`, true);
  if (v.verdict === "REVIEW")
    return text(
      `HELD by Countersign for the owner's approval. Nothing was run.\n${v.summary}\nAsk the owner to approve here: ${v.approvalUrl}\n` +
        (EXECUTED_BY_COUNTERSIGN.has(name)
          ? "Once approved, Countersign runs it itself; don't call it again."
          : "Once approved, call this tool again with the same arguments."),
    );
  if (v.error) return text(`Countersign allowed this call, but PayPal rejected it: ${v.error}`, true);
  if (v.executed) return text(`Done. Countersign checked and ran ${name} through PayPal. Refund ID: ${v.executed.refundId}\n${reasons}`);
  // Allowed: hand the original call (without our extra fields) to PayPal's own server.
  return upstream.callTool({ name, arguments: args });
});

await server.connect(new StdioServerTransport());
log("ready");
