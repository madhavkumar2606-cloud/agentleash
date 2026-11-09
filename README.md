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
- **Order/decision binding:** the PayPal order's `reference_id` and `custom_id` are the firewall decision ID, and capture only runs if the returned token matches the stored order.

## Run it

```bash
npm install
cp .env.example .env.local   # optional: everything works in mock mode without keys
npm run dev                  # http://localhost:3000
npm test                     # firewall tests
```

Open the dashboard and click **Hijacked by a web page** first.

### Modes

| | Without keys | With keys |
|---|---|---|
| PayPal | Mock checkout page (clearly labelled) | Real PayPal **sandbox** checkout |
| AI checks | Deterministic heuristic engine | Gemini / Claude / OpenAI (`LLM_PROVIDER`) with heuristics kept as a safety floor |

If the AI call fails or returns bad JSON, AgentLeash falls back to the heuristic engine. It never fails open.

### Getting PayPal sandbox keys

1. Log in at https://developer.paypal.com with any PayPal account.
2. **Apps & Credentials → Sandbox → Create App** (type: Merchant).
3. Copy the **Client ID** and **Secret** into `.env.local` as `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET`.
4. Under **Testing Tools → Sandbox Accounts**, use the auto-created *personal* account to log in at PayPal checkout.

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

## Project layout

```
src/lib/firewall/   the engine: rules parser, injection, intent, policy, price, seller, budget checks
src/lib/paypal.ts   PayPal Orders v2 client (sandbox + mock)
src/lib/llm.ts      swappable LLM adapter (Gemini / Anthropic / OpenAI)
src/lib/agent.ts    naive demo shopping agent + 5 scenarios
src/lib/orchestrator.ts  verdict → PayPal order / approval / capture
src/app/            dashboard, phone approval page, API routes
```

## Roadmap

- Vaulted PayPal payment methods so ALLOW verdicts settle with no checkout step (mock mode simulates this today)
- Seller trust from real PayPal transaction and dispute history
- An MCP server wrapper so Claude / ChatGPT agents route payments through AgentLeash automatically
- Persistent storage (currently in-memory)
