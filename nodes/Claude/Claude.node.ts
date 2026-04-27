import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';

import { nodeProperties, validateAndNormalize, ValidationFailure } from './lib/parameters';
import { runCli } from './lib/subprocess.runner';
import { parseCliOutput } from './lib/output.parser';
import { ParseFailure } from './lib/output.parser';
import { mapToError, toNodeOperationError } from './lib/error.mapper';
import { tryParseJson } from './lib/response.format';
import {
  DEFAULT_CACHE_DIR,
  cacheKey,
  isCacheable,
  readCache,
  writeCache,
} from './lib/cache';
import type { ErrorPayload, JsonOutcome, NodeOutputItem, ResponseFormat } from './lib/types';

export class Claude implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Claude Code',
    name: 'claude',
    icon: 'file:claude.svg',
    group: ['transform'],
    version: 1,
    description:
      "Use Claude Code with your existing Pro/Max subscription. Invokes the local Claude CLI and returns its response — as raw text or as parsed JSON. No API key required.",
    defaults: { name: 'Claude Code' },
    inputs: ['main'],
    outputs: ['main'],
    properties: nodeProperties,
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const out: INodeExecutionData[] = [];
    const cancelSignal = this.getExecutionCancelSignal?.();
    const continueOnFail = this.continueOnFail();

    for (let i = 0; i < items.length; i++) {
      const payload = await runForItem(this, i, cancelSignal);

      if (payload.kind === 'item') {
        out.push({ json: payload.item as unknown as IDataObject });
        continue;
      }

      if (continueOnFail) {
        out.push({ json: payload.error as unknown as IDataObject });
        continue;
      }

      throw toNodeOperationError(this.getNode(), payload.error);
    }

    return [out];
  }
}

async function runForItem(
  ctx: IExecuteFunctions,
  i: number,
  cancelSignal: AbortSignal | undefined,
): Promise<MapResult> {
  const rawPrompt = ctx.getNodeParameter('prompt', i, '');
  const timeoutSeconds = ctx.getNodeParameter('timeoutSeconds', i, 120) as number;
  const model = ctx.getNodeParameter('model', i, '') as string;
  const systemPrompt = ctx.getNodeParameter('systemPrompt', i, '') as string;
  const rawFormat = ctx.getNodeParameter('responseFormat', i, 'raw');
  const responseFormat: ResponseFormat = rawFormat === 'json' ? 'json' : 'raw';
  const optionsParam = ctx.getNodeParameter('options', i, {}) as {
    cliBinaryName?: string;
    retries?: number;
    useCache?: boolean;
    cacheTtlSeconds?: number;
    cacheDir?: string;
  };
  const cliBinaryName = optionsParam.cliBinaryName ?? 'claude';
  const retries = responseFormat === 'json' ? Math.max(0, optionsParam.retries ?? 0) : 0;
  const useCache = optionsParam.useCache === true;
  const cacheTtlSeconds = Math.max(0, optionsParam.cacheTtlSeconds ?? 0);
  const cacheDir = optionsParam.cacheDir?.trim() || DEFAULT_CACHE_DIR;

  let input;
  try {
    input = validateAndNormalize({
      prompt: rawPrompt,
      timeoutSeconds,
      cliBinaryName,
      model,
      systemPrompt,
      itemIndex: i,
    });
  } catch (err) {
    if (err instanceof ValidationFailure) {
      return {
        kind: 'error',
        error: mapToError(
          'validation',
          { parameter: err.parameter, received: err.received },
          { itemIndex: i },
        ),
      };
    }
    throw err;
  }

  const ckey = useCache
    ? cacheKey({
        prompt: input.prompt,
        model: input.model,
        systemPrompt: input.systemPrompt,
        responseFormat,
        cliBinaryName: input.cliBinaryName,
      })
    : null;

  if (ckey) {
    const cached = readCache(cacheDir, ckey, cacheTtlSeconds);
    if (cached) {
      cached.meta.cacheHit = true;
      return { kind: 'item', item: cached };
    }
  }

  if (responseFormat === 'raw') {
    const result = await runCli(input, { cancelSignal });
    const payload = mapResultToPayload(result, i);
    maybeCache(payload, ckey, cacheDir);
    return payload;
  }

  // JSON mode: fail-soft. Always emit a successful item; signal parse status via `json` field.
  const maxAttempts = retries + 1;
  let lastSuccessPayload: { kind: 'item'; item: NodeOutputItem } | null = null;
  let lastJsonError = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await runCli(input, { cancelSignal });
    const payload = mapResultToPayload(result, i);

    if (payload.kind === 'error') return payload; // CLI-level failure: still hard-fails

    const parse = tryParseJson(payload.item.response);
    if (parse.ok) {
      payload.item.json = { ok: true, value: parse.value, attempts: attempt };
      maybeCache(payload, ckey, cacheDir);
      return payload;
    }

    lastSuccessPayload = payload;
    lastJsonError = parse.error;
  }

  const jsonFailure: JsonOutcome = { ok: false, error: lastJsonError, attempts: maxAttempts };
  lastSuccessPayload!.item.json = jsonFailure;
  // Not cached — failures aren't cache-worthy.
  return lastSuccessPayload!;
}

function maybeCache(payload: MapResult, key: string | null, dir: string): void {
  if (!key) return;
  if (payload.kind !== 'item') return;
  if (!isCacheable(payload.item)) return;
  try {
    writeCache(dir, key, payload.item);
  } catch {
    // Cache write failures are silent — never break the workflow over a cache hiccup.
  }
}

type MapResult =
  | { kind: 'item'; item: NodeOutputItem }
  | { kind: 'error'; error: ErrorPayload };

function mapResultToPayload(
  result: Awaited<ReturnType<typeof runCli>>,
  itemIndex: number,
): MapResult {
  const meta = { itemIndex, elapsedMs: result.elapsedMs };

  if (result.terminationReason === 'spawn-error') {
    const isNotFound = result.spawnError?.code === 'ENOENT';
    if (isNotFound) {
      return {
        kind: 'error',
        error: mapToError(
          'not-found',
          { binaryName: result.spawnError?.path ?? '', pathHint: process.env.PATH ?? '' },
          meta,
        ),
      };
    }
    return {
      kind: 'error',
      error: mapToError(
        'exit-failure',
        { exitCode: -1, stderrExcerpt: result.spawnError?.message ?? 'spawn failed' },
        meta,
      ),
    };
  }

  if (result.terminationReason === 'timeout') {
    return {
      kind: 'error',
      error: mapToError(
        'timeout',
        { timeoutSeconds: Math.round(result.elapsedMs / 1000), signalEscalatedTo: result.signalEscalatedTo },
        meta,
      ),
    };
  }

  if (result.terminationReason === 'cancelled') {
    return { kind: 'error', error: mapToError('cancelled', {}, meta) };
  }

  if (result.exitCode !== 0) {
    return {
      kind: 'error',
      error: mapToError(
        'exit-failure',
        {
          exitCode: result.exitCode ?? -1,
          stderrExcerpt: tail(result.stderr.toString('utf8'), 4 * 1024),
        },
        meta,
      ),
    };
  }

  try {
    const item = parseCliOutput(result.stdout, result.elapsedMs);
    return { kind: 'item', item };
  } catch (err) {
    if (err instanceof ParseFailure) {
      return {
        kind: 'error',
        error: mapToError(
          'parse-failure',
          { parseError: err.parseError, stdoutExcerpt: err.stdoutExcerpt },
          meta,
        ),
      };
    }
    throw err;
  }
}

function tail(s: string, max: number): string {
  return s.length > max ? s.slice(s.length - max) : s;
}
