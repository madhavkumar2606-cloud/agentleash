// AgentLeash self-test. Run with: npm run selftest
// Checks your keys and runs every scenario against the real PayPal sandbox and AI provider.
// The report NEVER prints secrets, so it is safe to share.

import { existsSync } from "node:fs";
import { resolve } from "node:path";

for (const f of [".env.local", ".env"]) {
  const path = resolve(process.cwd(), f);
  if (existsSync(path)) {
    try {
      process.loadEnvFile(path);
    } catch {}
  }
}

const { llmConfig, paypalConfig } = await import("../src/lib/config");
const { llmRaw } = await import("../src/lib/llm");
const { createOrder } = await import("../src/lib/paypal");
const { parsePolicy, heuristicParsePolicy, DEFAULT_RULES } = await import("../src/lib/firewall/rules");
const { evaluate } = await import("../src/lib/firewall");
const { SCENARIOS, runScenario } = await import("../src/lib/agent");
const { runLiveAgent } = await import("../src/lib/liveAgent");
const { SEED_KNOWN_MERCHANTS } = await import("../src/lib/catalog");

// Silence library warnings; errors are reported in the summary instead.
const warnings: string[] = [];
console.warn = (...a: unknown[]) => warnings.push(a.map(String).join(" "));

const results: { name: string; ok: boolean | null; note: string }[] = [];
const record = (name: string, ok: boolean | null, note: string) => {
  results.push({ name, ok, note });
  console.log(`${ok === null ? "SKIP" : ok ? "PASS" : "FAIL"}  ${name}${note ? `  ${note}` : ""}`);
};
// Strip anything that looks like a secret from error text before printing.
const scrub = (s: string) =>
  s.replace(/(AIza[\w-]{10,}|sk-[\w-]{10,}|sk-ant-[\w-]{10,}|A21AA[\w-]{10,}|[A-Za-z0-9_-]{60,})/g, "[redacted]").slice(0, 300);

const pp = paypalConfig();
const llm = llmConfig();
console.log("AgentLeash self-test", new Date().toISOString());
console.log(`Node ${process.version}`);
console.log(`PayPal: ${pp.mode}${pp.mode === "sandbox" ? ` (client id …${pp.clientId.slice(-4)})` : " (no PAYPAL_CLIENT_ID/SECRET)"}`);
console.log(`AI: ${llm.provider}${llm.provider !== "mock" ? ` / ${llm.model}` : ` (LLM_PROVIDER=${process.env.LLM_PROVIDER || "unset"}, key ${process.env.LLM_API_KEY ? "set" : "missing"})`}`);
console.log("");

// 1. PayPal sandbox
console.log("== PayPal ==");
if (pp.mode === "mock") record("PayPal sandbox order", null, "skipped: no sandbox credentials");
else {
  try {
    const o = await createOrder({
      referenceId: `selftest-${Date.now()}`,
      description: "AgentLeash self-test order",
      itemName: "Self-test item",
      unitPrice: 1,
      quantity: 1,
      currency: "USD",
      returnUrl: "http://localhost:3000/api/paypal/return?decision=selftest",
      cancelUrl: "http://localhost:3000/api/paypal/cancel?decision=selftest",
    });
    const host = new URL(o.approveUrl).host;
    record("PayPal sandbox order", host.includes("sandbox.paypal.com"), `order ${o.orderId}, checkout at ${host}`);
  } catch (e) {
    record("PayPal sandbox order", false, scrub((e as Error).message));
  }
}

// 2. AI provider
console.log("\n== AI ==");
let aiOk = false;
if (llm.provider === "mock") record("AI provider call", null, "skipped: set LLM_PROVIDER and LLM_API_KEY");
else {
  try {
    const t0 = Date.now();
    const out = await llmRaw("Reply with JSON only.", 'Return {"ok": true}');
    aiOk = /"ok"\s*:\s*true/.test(out);
    record("AI provider call", aiOk, `${Date.now() - t0} ms${aiOk ? "" : `, unexpected reply: ${scrub(out)}`}`);
  } catch (e) {
    record("AI provider call", false, scrub((e as Error).message));
  }
}

const parsed = await parsePolicy(DEFAULT_RULES);
const h = heuristicParsePolicy(DEFAULT_RULES);
const policyMatch =
  parsed.policy.perTransactionLimit === h.perTransactionLimit &&
  parsed.policy.weeklyLimit === h.weeklyLimit &&
  parsed.policy.approvalThreshold === h.approvalThreshold;
record(
  "Rules parsed",
  policyMatch,
  `by ${parsed.parsedBy}: $${parsed.policy.perTransactionLimit}/purchase, $${parsed.policy.weeklyLimit}/week, ask over $${parsed.policy.approvalThreshold}, blocked [${parsed.policy.blockedCategories.join(", ")}]`,
);

const ctx = () => ({
  policy: parsed.policy,
  weeklySpent: 0,
  knownMerchants: new Set(SEED_KNOWN_MERCHANTS),
  mandateId: "selftest",
  id: "selftest",
});

// 3. Firewall on scripted scenarios (AI checks used if configured)
console.log("\n== Firewall: scripted agent ==");
for (const s of SCENARIOS) {
  const d = await evaluate(runScenario(s.id).proposal, ctx());
  const ai = d.checks.filter((c) => c.source === "llm").map((c) => c.id);
  record(`${s.id}: expected ${s.expected}`, d.verdict === s.expected, `got ${d.verdict}, risk ${d.riskScore}; AI checks: ${ai.join(", ") || "none"}`);
  if (d.verdict !== s.expected) console.log(`      ${d.summary}`);
}

// 4. Live AI agent (real model decides)
console.log("\n== Live AI agent ==");
if (!aiOk) record("Live agent scenarios", null, "skipped: AI provider not working");
else {
  for (const s of SCENARIOS) {
    const run = await runLiveAgent(s.task, s.id);
    if (!run) {
      record(`live ${s.id}`, false, "agent call failed");
      continue;
    }
    if (!run.proposal) {
      record(`live ${s.id}`, true, `${run.profile} agent chose not to buy (firewall had nothing to check)`);
      continue;
    }
    const d = await evaluate(run.proposal, ctx());
    const p = run.proposal;
    const hijacked = s.id === "injection" ? (p.productId === "p_giftcards" ? " | agent FELL for the injection" : " | agent resisted the injection") : "";
    // A live run passes if the firewall made a safe call: anything bad must not be ALLOWed.
    const bad = d.checks.some((c) => c.status === "fail");
    const ok = bad ? d.verdict === "BLOCK" : true;
    record(`live ${s.id}`, ok, `${run.profile} agent → ${p.quantity} × ${p.title} ($${(p.unitPrice * p.quantity).toFixed(2)}) → ${d.verdict}${hijacked}`);
  }
}

const fails = results.filter((r) => r.ok === false).length;
const skips = results.filter((r) => r.ok === null).length;
console.log(`\nSummary: ${results.length - fails - skips} passed, ${fails} failed, ${skips} skipped`);
if (warnings.length) {
  console.log(`Warnings (${warnings.length}):`);
  for (const w of [...new Set(warnings)].slice(0, 5)) console.log("  " + scrub(w));
}
process.exit(fails ? 1 : 0);
