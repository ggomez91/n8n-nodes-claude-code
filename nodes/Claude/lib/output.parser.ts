import type { NodeOutputItem } from './types';

export class ParseFailure extends Error {
  constructor(
    public parseError: string,
    public stdoutExcerpt: string,
  ) {
    super(`output parser failure: ${parseError}`);
    this.name = 'ParseFailure';
  }
}

const STDOUT_EXCERPT_MAX = 2 * 1024;

export function parseCliOutput(stdout: Buffer, elapsedMs: number): NodeOutputItem {
  const text = stdout.toString('utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new ParseFailure(
      err instanceof Error ? err.message : String(err),
      text.slice(0, STDOUT_EXCERPT_MAX),
    );
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ParseFailure(
      `expected JSON object, got ${parsed === null ? 'null' : Array.isArray(parsed) ? 'array' : typeof parsed}`,
      text.slice(0, STDOUT_EXCERPT_MAX),
    );
  }

  const obj = parsed as Record<string, unknown>;
  const response = pickResponse(obj);
  if (response === null) {
    throw new ParseFailure(
      'no response/result field found in CLI output',
      text.slice(0, STDOUT_EXCERPT_MAX),
    );
  }

  const out: NodeOutputItem = {
    success: true,
    response,
    raw: obj,
    meta: { elapsedMs },
  };

  if (typeof obj.model === 'string') out.model = obj.model;
  const stop = obj.stop_reason ?? obj.stopReason;
  if (typeof stop === 'string') out.stopReason = stop;

  const usage = obj.usage;
  if (usage && typeof usage === 'object' && !Array.isArray(usage)) {
    const u = usage as Record<string, unknown>;
    const mapped: Record<string, unknown> = {};
    const input = u.inputTokens ?? u.input_tokens;
    const output = u.outputTokens ?? u.output_tokens;
    if (typeof input === 'number') mapped.inputTokens = input;
    if (typeof output === 'number') mapped.outputTokens = output;
    if (Object.keys(mapped).length > 0) out.usage = mapped;
  }

  return out;
}

function pickResponse(obj: Record<string, unknown>): string | null {
  if (typeof obj.response === 'string') return obj.response;
  if (typeof obj.result === 'string') return obj.result;
  if (typeof obj.message === 'string') return obj.message;
  return null;
}
