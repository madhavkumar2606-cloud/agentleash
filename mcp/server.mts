// Countersign MCP server (stdio). Add it to Claude Desktop, Cursor, or any MCP client so the
// agent must clear every purchase with Countersign before money moves through PayPal.
//
//   COUNTERSIGN_URL=http://localhost:3000 npx tsx mcp/server.mts
//
// Tools:
//   countersign_get_rules         current spending rules and this week's spend
//   countersign_request_purchase  submit a purchase; returns ALLOW / REVIEW / BLOCK + PayPal links

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = ((process.env.COUNTERSIGN_URL || process.env.AGENTLEASH_URL) || "http://localhost:3000").replace(/\/$/, "");
const KEY = (process.env.COUNTERSIGN_API_KEY || process.env.AGENTLEASH_API_KEY);

async function call(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(KEY ? { Authorization: `Bearer ${KEY}` } : {}), ...init?.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Countersign returned ${res.status}`);
  return body;
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

const server = new McpServer({ name: "countersign", version: "0.2.0" });

server.registerTool(
  "countersign_get_rules",
  {
    title: "Get spending rules",
    description: "Get the owner's spending rules and how much agents have spent this week. Call this before shopping.",
    inputSchema: {},
  },
  async () => {
    const s = await call("/api/state");
    const p = s.mandate.policy;
    return text(
      [
        `Owner's rules: ${s.mandate.rulesText}`,
        `Per purchase: up to $${p.perTransactionLimit}. Weekly: $${s.weeklySpent.toFixed(2)} of $${p.weeklyLimit} used.`,
        `Owner approves anything at or over $${p.approvalThreshold}. Max quantity: ${p.maxQuantity}.`,
        `Blocked: ${p.blockedCategories.join(", ") || "none"}.`,
      ].join("\n"),
    );
  },
);

server.registerTool(
  "countersign_request_purchase",
  {
    title: "Request a purchase",
    description:
      "REQUIRED before paying for anything. Submits the purchase to the owner's Countersign firewall, which checks it against " +
      "the owner's task and rules and scans the pages you read for prompt injection. Only pay if the verdict is ALLOW. " +
      "On REVIEW, give the owner the approval link and wait. On BLOCK, do not buy and tell the owner why.",
    inputSchema: {
      task: z.string().describe("The owner's original instruction to you, word for word"),
      merchant_name: z.string(),
      merchant_id: z.string().optional().describe("Seller's ID if known"),
      title: z.string().describe("Product name"),
      category: z.string().describe("Product category, e.g. gardening, electronics, gift cards"),
      unit_price: z.number().positive().describe("Price per unit in USD"),
      quantity: z.number().int().positive(),
      reasoning: z.string().describe("Why you chose this purchase"),
      page_content: z.string().optional().describe("Raw text/HTML of the product pages you read, so they can be scanned for injection"),
      product_url: z.string().optional(),
    },
  },
  async (a) => {
    const d = await call("/api/firewall/check", {
      method: "POST",
      body: JSON.stringify({
        agentId: "mcp-agent",
        task: a.task,
        merchantId: a.merchant_id ?? `ext_${a.merchant_name.toLowerCase().replace(/\W+/g, "_")}`,
        merchantName: a.merchant_name,
        title: a.title,
        category: a.category,
        unitPrice: a.unit_price,
        quantity: a.quantity,
        currency: "USD",
        agentReasoning: a.reasoning,
        pageContent: a.page_content,
        productUrl: a.product_url,
      }),
    });
    const lines = [`Verdict: ${d.verdict} (risk ${d.riskScore}/100)`, d.summary];
    for (const c of d.checks) lines.push(`- ${c.status.toUpperCase()} ${c.label}: ${c.detail}`);
    if (d.verdict === "REVIEW") lines.push(`Ask the owner to approve here: ${d.approvalUrl}`);
    if (d.verdict === "ALLOW") {
      if (d.payment.status === "captured") lines.push(`Paid through PayPal (order ${d.payment.orderId}).`);
      else if (d.payment.approveUrl) lines.push(`PayPal checkout: ${d.payment.approveUrl}`);
    }
    if (d.verdict === "BLOCK") lines.push("Do not make this purchase.");
    return text(lines.join("\n"));
  },
);

await server.connect(new StdioServerTransport());
