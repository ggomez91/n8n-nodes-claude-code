const FENCE_RE = /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/;

export function stripFences(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(FENCE_RE);
  return match ? match[1].trim() : trimmed;
}

/**
 * Slice the substring from the first `{` or `[` to the last matching `}` or `]`.
 * Used as a fallback for unfenced JSON wrapped in prose
 * (e.g. "Here's the JSON: {...} \n\nNote: ..."). No brace counting — if the
 * prose contains stray braces, JSON.parse will fail loudly.
 *
 * Returns null if no candidate span is found.
 */
export function sliceJsonSpan(text: string): string | null {
  const firstObj = text.indexOf('{');
  const firstArr = text.indexOf('[');

  let start = -1;
  let closer = '';
  if (firstObj !== -1 && (firstArr === -1 || firstObj < firstArr)) {
    start = firstObj;
    closer = '}';
  } else if (firstArr !== -1) {
    start = firstArr;
    closer = ']';
  }
  if (start === -1) return null;

  const end = text.lastIndexOf(closer);
  if (end <= start) return null;

  return text.slice(start, end + 1).trim();
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
  } catch (fenceErr) {
    const span = sliceJsonSpan(cleaned);
    if (span !== null && span !== cleaned) {
      try {
        return { ok: true, cleaned: span, value: JSON.parse(span) };
      } catch {
        // fall through to fence error — it's the more informative one
      }
    }
    return {
      ok: false,
      cleaned,
      error: fenceErr instanceof Error ? fenceErr.message : String(fenceErr),
    };
  }
}
