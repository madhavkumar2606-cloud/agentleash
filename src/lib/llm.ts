// Swappable LLM adapter. Pick a provider with LLM_PROVIDER + LLM_API_KEY.
// Every call asks for JSON, validates it with zod, and returns null on any
// failure so callers can fall back to deterministic heuristics (fail-safe).

import type { z } from "zod";
import { llmConfig } from "./config";

async function callProvider(system: string, user: string): Promise<string> {
  const { provider, apiKey, model } = llmConfig();

  if (provider === "gemini") {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { temperature: 0, responseMimeType: "application/json" },
        }),
      },
    );
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
  }

  if (provider === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
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
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data?.content?.map((b: { text?: string }) => b.text ?? "").join("") ?? "";
  }

  if (provider === "openai") {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
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
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
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
    const text = await callProvider(system, user);
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
