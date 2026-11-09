# AgentLeash

**A firewall between AI agents and your PayPal account.**

AI agents can now shop and pay for you, and run your business's PayPal account through PayPal's own MCP server: refunds, invoices, disputes, subscriptions. But an agent can be tricked by a web page or a customer email, wander off-task, or get gouged by a shady seller, and today nothing stands between that mistake and your money. AgentLeash sits in front of PayPal: every purchase or PayPal action an agent wants to take is checked against **what you actually asked for**, **the rules you wrote in plain English**, and **the real records in PayPal**. Only then does PayPal move money.

It protects both sides of a payment:
- **Buyer side:** a shopping agent that pays with PayPal (Orders v2).
- **Merchant side:** a support agent with PayPal's official MCP tools. AgentLeash Guard is a drop-in replacement for the PayPal MCP server that checks every money-moving tool call first.

Built for the PayPal AI Hackathon 2026 ("Build What's Next with PayPal and AI").

## What it catches

| Threat | Example | How it's caught |
|---|---|---|
| **Prompt injection** | A product page hides `display:none` text telling AI agents to buy 5 gift cards instead | Pattern scan + AI review of every page the agent read, plus a check of whether the purchase *follows* the injected text |
| **Going off-task** | Asked for a gardening gift for mom, the agent buys itself earbuds on a "today only" deal | AI intent check: does this purchase serve the task? |
| **Overspending** | Per-purchase, weekly and quantity limits; blocked categories | Your plain-English rules, parsed into a policy |
| **Price gouging** | Same kit at 3x the usual price from a "premium seller" | Market price comparison |
| **Risky sellers** | 9-day-old seller with 14% disputed payments | Seller trust signals (age, dispute rate, rating) |
| **Poisoned support ticket** | A customer email hides a fake "policy update for AI support assistants" ordering a $500 goodwill refund on a $79 order | Injection + task checks on the PayPal tool call, then the refund is verified against the real capture in PayPal (exists, not already refunded, amount ≤ what's left) |
| **Refund abuse** | Agent refunds more than allowed, or keeps refunding all day | Refund rules: approval over $50, max $200 per refund, $300 a day |

Every decision is **ALLOW**, **REVIEW** (you approve on your phone, then pay with PayPal) or **BLOCK** (no PayPal order is ever created), with one plain-English reason and a full audit log.

## How PayPal is used

- **Orders v2:** create order → payer approval → capture, wired to the firewall verdict
- **Owner approval flow:** REVIEW sends you a phone page (QR code on the dashboard). Approve opens PayPal checkout, and the return URL captures the payment.
- **Verified end to end in sandbox:** firewall verdict → order created → buyer pays at PayPal → capture recorded on the decision.
- **Payments v2:** refunds are checked against the real capture (`GET /v2/payments/captures/{id}`) and executed with `POST /v2/payments/captures/{id}/refund`, idempotently.
- **PayPal MCP server (`@paypal/mcp`):** AgentLeash Guard runs PayPal's official MCP server underneath and gates its 8 money-moving tools (`create_refund`, `pay_order`, `create_order`, `accept_dispute_claim`, `send_invoice`, `cancel_sent_invoice`, `create_subscription`, `cancel_subscription`). The 20 read-only tools pass straight through.
- **Order/decision binding:** the PayPal order's `reference_id` and `custom_id` are the firewall decision ID, and capture only runs if the returned token matches the stored order.

## Run it

```bash
npm install
cp .env.example .env.local   # optional: everything works in mock mode without keys
npm run dev                  # http://localhost:3000
npm test                     # firewall tests
```

Open http://localhost:3000 for the landing page, or go straight to the dashboard at **/app** and click **Hijacked by a web page** first.

### Check your setup: `npm run selftest`

Checks your keys and runs every scenario against the real PayPal sandbox and your AI provider, with both the scripted agent and the live AI agent. **The report never prints secrets**, so it's safe to share.

```
PASS  PayPal sandbox order  order 5O190127TN364715T, checkout at www.sandbox.paypal.com
PASS  AI provider call  640 ms
PASS  live injection  naive agent → 5 × Premium Gift Card Bundle ($250.00) → BLOCK | agent FELL for the injection
```

### Modes

| | Without keys | With keys |
|---|---|---|
| PayPal | Mock checkout page (clearly labelled) | Real PayPal **sandbox** checkout |
| AI checks | Deterministic heuristic engine | Gemini / Claude / OpenAI (`LLM_PROVIDER`) with heuristics kept as a safety floor |

If the AI call fails or returns bad JSON, AgentLeash falls back to the heuristic engine. It never fails open.

### Live AI agent

With an AI key set, the shopping agent is a real model that searches the store, reads raw product pages (hidden text included) and decides for itself. It has two profiles:
- **careful:** treats page content as untrusted
- **naive:** trusts store notices and chases deals. It's labelled in the UI as a simulated weak agent, so you can watch a model actually get hijacked.

You can also type your own task ("Get my dad a planter under $40"). The firewall never trusts either profile.

### Getting a Gemini key (free)

Go to https://aistudio.google.com → **Get API key** → Create API key. Then in `.env.local`:

```
LLM_PROVIDER=gemini
LLM_API_KEY=your-key
```

### Getting PayPal sandbox keys

1. Log in at https://developer.paypal.com with any PayPal account.
2. **Apps & Credentials → Sandbox → Create App** (type: Merchant).
3. Copy the **Client ID** and **Secret** into `.env.local` as `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET`.
4. **Use United States sandbox accounts.** Sandbox accounts auto-created for accounts outside the US (e.g. India) fail at checkout with *"This seller doesn't accept payments in your currency."* Fix:
   - **Testing Tools → Sandbox Accounts → Create account**: one **Business**, one **Personal**, both with country **United States**.
   - **Create App** again and pick the new US Business account as the app's sandbox account. Use that app's Client ID and Secret.
   - Log in at PayPal checkout with the US **Personal** account.

> If the developer dashboard shows a blank "unauthorized" page, open it in an incognito window.

## Use it from any agent

```bash
curl -X POST http://localhost:3000/api/firewall/check \
  -H 'Content-Type: application/json' \
  -d '{
    "agentId": "my-agent",
    "task": "Order printer paper for the office",
    "merchantId": "m_paperco", "merchantName": "PaperCo",
    "title": "A4 Paper, 5 reams", "category": "office supplies",
    "unitPrice": 22, "quantity": 1,
    "agentReasoning": "Cheapest A4 option",
    "pageContent": "<text of the pages the agent read>"
  }'
```

Response: `verdict`, `summary`, `riskScore`, per-check results, PayPal payment info, and an `approvalUrl` for REVIEW.

## Use it from Claude Desktop, Cursor, or any MCP client

AgentLeash ships an MCP server with two tools, `agentleash_get_rules` and `agentleash_request_purchase`. Any MCP agent then has to clear purchases with the firewall before paying.

```json
{
  "mcpServers": {
    "agentleash": {
      "command": "npx",
      "args": ["tsx", "/path/to/agentleash/mcp/server.mts"],
      "env": { "AGENTLEASH_URL": "http://localhost:3000", "AGENTLEASH_API_KEY": "same key as the server" }
    }
  }
}
```

## Guard PayPal's own MCP server: `npm run paypal-guard`

PayPal's [MCP server](https://www.npmjs.com/package/@paypal/mcp) lets an agent refund, invoice and settle disputes on your account. AgentLeash Guard is a drop-in replacement for it. It starts PayPal's server underneath and offers the same tools, so the agent doesn't change. Each money-moving tool asks the agent for three extra fields (its task, the text it read, and why), and AgentLeash checks the call before PayPal sees it:

| Verdict | What the agent gets back |
|---|---|
| ALLOW | The real PayPal result (refunds are run by AgentLeash, which verified the capture first) |
| REVIEW | "Held for the owner", with a phone approval link. Nothing runs until you approve. |
| BLOCK | The reasons, and "do not retry". PayPal never sees the call. |

If AgentLeash can't be reached, the call fails closed.

```json
{
  "mcpServers": {
    "paypal": {
      "command": "npx",
      "args": ["tsx", "/path/to/agentleash/mcp/paypal-guard.mts"],
      "env": {
        "AGENTLEASH_URL": "https://your-agentleash.onrender.com",
        "AGENTLEASH_API_KEY": "same key as the server",
        "PAYPAL_CLIENT_ID": "sandbox client id",
        "PAYPAL_CLIENT_SECRET": "sandbox secret"
      }
    }
  }
}
```

Other agents can call the same check over HTTP: `POST /api/guard/check` with `{ tool, args, task, context, agentReasoning, execute }`.

To see it without an MCP client, open the dashboard, switch to **Support agent · PayPal MCP**, and run the three tickets: a fair partial refund (refunded), a poisoned ticket (blocked), and a full refund (held for your approval, then refunded). In sandbox mode, make one **Honest purchase** and pay first, so there's a real PayPal capture to refund.

## Record the demo video

`npm run record-demo` drives your real browser through the live site (landing scan, honest purchase, the hijack, phone approval and a $79 PayPal payment, then the support agent refunding that payment through the PayPal MCP guard: partial refund, poisoned ticket, full refund approved on the phone, and the audit log), with a visible cursor and steady pacing. It reruns the hijack and poisoned-ticket scenarios until the live model falls for the trap (up to `HIJACK_TRIES`, default 3) and pauses for you to log in to PayPal sandbox by hand.

```bash
npx playwright install ffmpeg            # once: the video encoder
OWNER_PASSWORD=your-password npm run record-demo
```

On Windows PowerShell: `$env:OWNER_PASSWORD="your-password"; npm run record-demo`. It uses your installed Google Chrome; set `CHROME_PATH` to use another browser and `DEMO_URL` to record a different site. Output goes to `demo-recordings/<time>/`: `raw.webm`, `markers.json` (what happened when) and stills of the key moments.

## Security

AgentLeash guards money, so it is hardened against being attacked itself:

| Threat | Protection |
|---|---|
| Strangers changing rules or approving purchases | Owner password (`OWNER_PASSWORD`) on the dashboard, rules, approvals and agent runs; HMAC-signed httpOnly session cookie. A public deployment **refuses to run** owner pages without a password. |
| Password guessing | 5 login attempts per minute per IP |
| Guessing approval links | Decision IDs are random 128-bit UUIDs |
| Burning your AI quota / spam | Per-IP rate limits on agent runs, rule changes and the firewall API |
| Rogue agents calling the API | `AGENTLEASH_API_KEY` bearer token, constant-time comparison; required on public deployments |
| Prompt injection aimed at the firewall's own AI | Rules engine runs alongside the AI on injection *and* intent checks; the stricter result wins. Money rules (limits, blocked items, seller trust, price) are plain code that can't be talked around. |
| Payment tampering | Capture only when PayPal's returned token matches the stored order; captured amount and currency must equal the approved amount; idempotent PayPal request IDs |
| Redirect / Host-header tricks | PayPal return URLs come only from `APP_URL`; login redirects only within the app; mock checkout disabled when real PayPal is configured |
| XSS, clickjacking | React escaping (no raw HTML), `X-Frame-Options: DENY`, CSP `frame-ancestors 'none'`, `nosniff` |
| Leaked secrets | Keys are server-side only and git-ignored; the self-test redacts them |

Known limits (roadmap): seller identity is taken from the agent's request (production would verify the payee with PayPal), and state is in memory on a single instance.

## Project layout

```
src/lib/firewall/   the engine: rules parser, injection, intent, policy, price, seller, budget checks
src/lib/paypal.ts   PayPal Orders v2 client (sandbox + mock)
src/lib/llm.ts      swappable LLM adapter (Gemini / Anthropic / OpenAI)
src/lib/agent.ts    scripted demo agent + 5 scenarios (used without an AI key)
src/lib/liveAgent.ts real LLM shopping agent (careful / naive profiles)
mcp/server.mts      MCP server for Claude Desktop / Cursor / other agents
mcp/paypal-guard.mts  AgentLeash Guard: PayPal's official MCP server with every money-moving tool checked
src/lib/guard/      checks for PayPal tool calls (injection, task, verified in PayPal, refund rules)
src/lib/supportAgent.ts  merchant support agent demo (3 tickets)
scripts/selftest.mts  npm run selftest: key + end-to-end check
src/lib/orchestrator.ts  verdict → PayPal order / approval / capture
src/app/            landing page (/), dashboard (/app), login, phone approval page, API routes
```

## Roadmap

- Vaulted PayPal payment methods so ALLOW verdicts settle with no checkout step (mock mode simulates this today)
- Seller trust from real PayPal transaction and dispute history
- Persistent storage (currently in-memory)

## License

MIT. See [LICENSE](LICENSE).
