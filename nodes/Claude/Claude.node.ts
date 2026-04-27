import {
  ApplicationError,
  type IDataObject,
  type IExecuteFunctions,
  type INodeExecutionData,
  type INodeType,
  type INodeTypeDescription,
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
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_COUNT,
  attachmentsDigest,
  parseBinaryPropertyNames,
  stageAttachments,
} from './lib/attachments';
import type {
  BinaryAttachment,
  ErrorPayload,
  JsonOutcome,
  NodeOutputItem,
  ResponseFormat,
} from './lib/types';

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
  const binaryProperties = ctx.getNodeParameter('binaryProperties', i, '') as string;
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

  // Resolve binary attachments from the input item, if any.
  let attachments: BinaryAttachment[] = [];
  try {
    attachments = await resolveAttachments(ctx, i, binaryProperties);
  } catch (err) {
    return {
      kind: 'error',
      error: mapToError(
        'validation',
        {
          parameter: 'binaryProperties',
          received: err instanceof Error ? err.message : String(err),
        },
        { itemIndex: i },
      ),
    };
  }

  const aDigest = attachmentsDigest(attachments);
  const ckey = useCache
    ? cacheKey({
        prompt: input.prompt,
        model: input.model,
        systemPrompt: input.systemPrompt,
        responseFormat,
        cliBinaryName: input.cliBinaryName,
        attachmentsDigest: aDigest,
      })
    : null;

  if (ckey) {
    const cached = readCache(cacheDir, ckey, cacheTtlSeconds);
    if (cached) {
      cached.meta.cacheHit = true;
      return { kind: 'item', item: cached };
    }
  }

  // Stage attachments to a temp dir; cleanup is mandatory in the finally block.
  const staged = attachments.length > 0 ? stageAttachments(attachments) : null;
  const runOpts = { cancelSignal, attachmentsDir: staged?.dir };
  // Auto-prepend a hint about available files so Claude knows what to Read.
  if (staged) {
    const hint = `Files staged for this request in ${staged.dir}: ${staged.fileNames.join(', ')}. Use the Read tool on any of them as needed.`;
    input = { ...input, systemPrompt: input.systemPrompt ? `${input.systemPrompt}\n\n${hint}` : hint };
  }

  try {
    if (responseFormat === 'raw') {
      const result = await runCli(input, runOpts);
      const payload = mapResultToPayload(result, i);
      maybeCache(payload, ckey, cacheDir);
      return payload;
    }

    // JSON mode: fail-soft. Always emit a successful item; signal parse status via `json` field.
    const maxAttempts = retries + 1;
    let lastSuccessPayload: { kind: 'item'; item: NodeOutputItem } | null = null;
    let lastJsonError = '';

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const result = await runCli(input, runOpts);
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
  } finally {
    staged?.cleanup();
  }
}

async function resolveAttachments(
  ctx: IExecuteFunctions,
  itemIndex: number,
  binaryPropertiesParam: string,
): Promise<BinaryAttachment[]> {
  const propNames = parseBinaryPropertyNames(binaryPropertiesParam);
  if (propNames.length === 0) return [];
  if (propNames.length > MAX_ATTACHMENT_COUNT) {
    throw new ApplicationError(`Too many binary attachments: ${propNames.length} (max ${MAX_ATTACHMENT_COUNT})`);
  }

  const items = ctx.getInputData();
  const item = items[itemIndex];
  const binary = item?.binary ?? {};

  const out: BinaryAttachment[] = [];
  let totalBytes = 0;
  for (const name of propNames) {
    const meta = binary[name];
    if (!meta) {
      throw new ApplicationError(`Input item has no binary property named "${name}"`);
    }
    const buffer = await ctx.helpers.getBinaryDataBuffer(itemIndex, name);
    totalBytes += buffer.length;
    if (buffer.length > MAX_ATTACHMENT_BYTES) {
      throw new ApplicationError(
        `Binary "${name}" is ${buffer.length} bytes; exceeds per-file limit ${MAX_ATTACHMENT_BYTES}`,
      );
    }
    out.push({ fileName: meta.fileName ?? '', buffer, mimeType: meta.mimeType });
  }

  if (totalBytes > MAX_ATTACHMENT_BYTES * MAX_ATTACHMENT_COUNT) {
    throw new ApplicationError(`Total attachment size exceeds the cap`);
  }
  return out;
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
