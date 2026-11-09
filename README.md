# AgentLeash

**A firewall between AI agents and your PayPal account.**

AI agents can now shop and pay for you. But an agent can be tricked by a web page, wander off-task, or get gouged by a shady seller, and today nothing stands between that mistake and your money. AgentLeash sits in front of PayPal: every purchase an agent wants to make is checked against **what you actually asked for** and **the rules you wrote in plain English**. Only then does PayPal move money.

Built for the PayPal AI Hackathon 2026 ("Build What's Next with PayPal and AI").

## What it catches

| Threat | Example | How it's caught |
|---|---|---|
| **Prompt injection** | A product page hides `display:none` text telling AI agents to buy 5 gift cards instead | Pattern scan + AI review of every page the agent read, plus a check of whether the purchase *follows* the injected text |
| **Going off-task** | Asked for a gardening gift for mom, the agent buys itself earbuds on a "today only" deal | AI intent check: does this purchase serve the task? |
| **Overspending** | Per-purchase, weekly and quantity limits; blocked categories | Your plain-English rules, parsed into a policy |
| **Price gouging** | Same kit at 3x the usual price from a "premium seller" | Market price comparison |
| **Risky sellers** | 9-day-old seller with 14% disputed payments | Seller trust signals (age, dispute rate, rating) |

Every decision is **ALLOW**, **REVIEW** (you approve on your phone, then pay with PayPal) or **BLOCK** (no PayPal order is ever created), with one plain-English reason and a full audit log.

## How PayPal is used

- **Orders v2:** create order → payer approval → capture, wired to the firewall verdict
- **Owner approval flow:** REVIEW sends you a phone page (QR code on the dashboard). Approve opens PayPal checkout, and the return URL captures the payment.
- **Verified end to end in sandbox:** firewall verdict → order created → buyer pays at PayPal → capture recorded on the decision.
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
scripts/selftest.mts  npm run selftest: key + end-to-end check
src/lib/orchestrator.ts  verdict → PayPal order / approval / capture
src/app/            landing page (/), dashboard (/app), login, phone approval page, API routes
```

## Roadmap

- Vaulted PayPal payment methods so ALLOW verdicts settle with no checkout step (mock mode simulates this today)
- Seller trust from real PayPal transaction and dispute history
- Persistent storage (currently in-memory)
