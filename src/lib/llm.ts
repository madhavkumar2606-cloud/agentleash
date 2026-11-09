// Swappable LLM adapter. Pick a provider with LLM_PROVIDER + LLM_API_KEY.
// Every call asks for JSON, validates it with zod, and returns null on any
// failure so callers can fall back to deterministic heuristics (fail-safe).

import type { z } from "zod";
import { llmConfig } from "./config";

class LlmHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// Overloaded / rate-limited / flaky: worth retrying. 404 = model not available: try the next model.
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
const TIMEOUT_MS = 12_000; // per attempt; a model this slow is overloaded, so move on

/** Backup models tried in order when the main one is overloaded or unavailable. */
function fallbackModels(provider: string, primary: string): string[] {
  const extra = (process.env.LLM_FALLBACK_MODELS ?? "").split(",").map((m) => m.trim()).filter(Boolean);
  const defaults: Record<string, string[]> = {
    gemini: ["gemini-2.5-flash", "gemini-flash-latest", "gemini-2.5-flash-lite"],
    anthropic: ["claude-haiku-4-5"],
    openai: ["gpt-4.1-nano"],
  };
  return [...new Set([primary, ...extra, ...(defaults[provider] ?? [])])];
}

/** The model that answered the most recent successful call (shown in the self-test). */
export let lastModelUsed: string | undefined;
// After a fallback succeeds, try that model first for a while instead of re-hitting an overloaded one.
let sticky: { model: string; until: number } | undefined;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Raw provider call with retries and model fallback. Throws if every model fails
 * (the self-test uses this for diagnostics; the app uses llmJson, which never throws).
 */
export async function llmRaw(system: string, user: string): Promise<string> {
  const { provider, apiKey, model } = llmConfig();
  const errors: string[] = [];
  const deadline = Date.now() + 40_000; // total budget so an outage can't hang the app
  let models = fallbackModels(provider, model);
  if (sticky && sticky.until > Date.now() && models.includes(sticky.model)) {
    models = [sticky.model, ...models.filter((m) => m !== sticky!.model)];
  }
  for (const m of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (Date.now() > deadline) throw new Error(`AI timed out after retries. ${errors.slice(-2).join(" | ")}`);
      try {
        const out = await callOnce(provider, apiKey, m, system, user);
        lastModelUsed = m;
        sticky = m === model ? undefined : { model: m, until: Date.now() + 5 * 60_000 };
        return out;
      } catch (err) {
        const status = err instanceof LlmHttpError ? err.status : 0;
        errors.push(`${m}: ${(err as Error).message.replace(/\s+/g, " ").slice(0, 110)}`);
        if (status === 401 || status === 403) throw err; // bad key: retrying won't help
        const timedOut = (err as Error).name === "TimeoutError" || (err as Error).name === "AbortError";
        // Timeout, unknown/unsupported model (400/404), or anything non-retryable: try the next model.
        if (timedOut || !RETRYABLE.has(status)) break;
        // Overloaded (503/429): one quick retry on the same model, then move on.
        if (attempt >= 1) break;
        await sleep(700 + Math.random() * 300);
      }
    }
  }
  throw new Error(`All models failed. ${errors.slice(-3).join(" | ")}`);
}

async function callOnce(provider: string, apiKey: string, model: string, system: string, user: string): Promise<string> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);

  if (provider === "gemini") {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { temperature: 0, responseMimeType: "application/json" },
        }),
      },
    );
    if (!res.ok) throw new LlmHttpError(`Gemini ${res.status}: ${await res.text()}`, res.status);
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
  }

  if (provider === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 800,
        temperature: 0,
        system: system + "\nRespond with a single JSON object and nothing else.",
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) throw new LlmHttpError(`Anthropic ${res.status}: ${await res.text()}`, res.status);
    const data = await res.json();
    return data?.content?.map((b: { text?: string }) => b.text ?? "").join("") ?? "";
  }

  if (provider === "openai") {
    const base = (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) throw new LlmHttpError(`OpenAI ${res.status}: ${await res.text()}`, res.status);
    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? "";
  }

  throw new Error("No LLM provider configured");
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object in LLM output");
  return JSON.parse(body.slice(start, end + 1));
}

/**
 * Ask the configured LLM for a JSON object matching `schema`.
 * Returns null in mock mode or on any error, so callers must have a fallback.
 */
export async function llmJson<T>(
  schema: z.ZodType<T>,
  system: string,
  user: string,
): Promise<T | null> {
  if (llmConfig().provider === "mock") return null;
  try {
    const text = await llmRaw(system, user);
    const parsed = schema.safeParse(extractJson(text));
    if (!parsed.success) {
      console.warn("[llm] schema mismatch", parsed.error.issues);
      return null;
    }
    return parsed.data;
  } catch (err) {
    console.warn("[llm] call failed, falling back to heuristics:", (err as Error).message);
    return null;
  }
}
