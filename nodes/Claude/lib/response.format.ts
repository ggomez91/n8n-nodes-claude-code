const FENCE_RE = /^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/;

export function stripFences(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(FENCE_RE);
  return match ? match[1].trim() : trimmed;
}

export interface JsonParseSuccess {
  ok: true;
  cleaned: string;
  value: unknown;
}

export interface JsonParseFailure {
  ok: false;
  cleaned: string;
  error: string;
}

export type JsonParseResult = JsonParseSuccess | JsonParseFailure;

export function tryParseJson(rawText: string): JsonParseResult {
  const cleaned = stripFences(rawText);
  try {
    return { ok: true, cleaned, value: JSON.parse(cleaned) };
  } catch (err) {
    return {
      ok: false,
      cleaned,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
