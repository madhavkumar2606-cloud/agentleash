// Runtime configuration, read from environment variables.
// Everything has a safe default so the app runs in full mock mode with no keys.

export type LlmProvider = "gemini" | "anthropic" | "openai" | "mock";

const DEFAULT_MODELS: Record<Exclude<LlmProvider, "mock">, string> = {
  gemini: "gemini-flash-lite-latest",
  anthropic: "claude-sonnet-4-5",
  openai: "gpt-4.1-mini",
};

function resolveProvider(): LlmProvider {
  const raw = (process.env.LLM_PROVIDER ?? "").toLowerCase().trim();
  if (raw === "gemini" || raw === "anthropic" || raw === "openai") {
    return process.env.LLM_API_KEY ? raw : "mock";
  }
  if (raw === "claude") return process.env.LLM_API_KEY ? "anthropic" : "mock";
  return "mock";
}

export function llmConfig() {
  const provider = resolveProvider();
  return {
    provider,
    apiKey: process.env.LLM_API_KEY ?? "",
    model:
      provider === "mock"
        ? "heuristic"
        : process.env.LLM_MODEL || DEFAULT_MODELS[provider],
  };
}

export function paypalConfig() {
  const clientId = process.env.PAYPAL_CLIENT_ID ?? "";
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET ?? "";
  return {
    mode: clientId && clientSecret ? ("sandbox" as const) : ("mock" as const),
    clientId,
    clientSecret,
    // Sandbox only: the hackathon build never touches live money.
    baseUrl: "https://api-m.sandbox.paypal.com",
  };
}

/** Optional shared secret external agents must send to /api/firewall/check. */
export function firewallApiKey(): string | undefined {
  return (process.env.COUNTERSIGN_API_KEY || process.env.AGENTLEASH_API_KEY) || undefined;
}
