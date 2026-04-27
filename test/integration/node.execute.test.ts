import * as path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { Claude } from '../../nodes/Claude/Claude.node';

const FIXTURES = path.resolve(__dirname, '..', 'fixtures');

interface MockOptions {
  inputItems?: Array<Record<string, unknown>>;
  prompts?: string[];
  timeoutSeconds?: number;
  cliBinaryName?: string;
  continueOnFail?: boolean;
  responseFormat?: 'raw' | 'json';
  retries?: number;
  model?: string;
  systemPrompt?: string;
  useCache?: boolean;
  cacheTtlSeconds?: number;
  cacheDir?: string;
}

function makeExecuteContext(opts: MockOptions): IExecuteFunctions {
  const items: INodeExecutionData[] = (opts.inputItems ?? [{}]).map((j) => ({
    json: j as IDataObject,
  }));
  const prompts = opts.prompts ?? items.map(() => 'hello');
  const timeout = opts.timeoutSeconds ?? 5;
  const binary = opts.cliBinaryName ?? path.join(FIXTURES, 'claude-stub-success.sh');
  const continueOnFail = opts.continueOnFail ?? false;

  return {
    getInputData: () => items,
    getNodeParameter: (name: string, itemIndex: number, fallback?: unknown) => {
      switch (name) {
        case 'prompt':
          return prompts[itemIndex] ?? fallback ?? '';
        case 'timeoutSeconds':
          return timeout;
        case 'model':
          return opts.model ?? fallback ?? '';
        case 'systemPrompt':
          return opts.systemPrompt ?? fallback ?? '';
        case 'responseFormat':
          return opts.responseFormat ?? fallback ?? 'raw';
        case 'options':
          return {
            cliBinaryName: binary,
            retries: opts.retries ?? 0,
            useCache: opts.useCache ?? false,
            cacheTtlSeconds: opts.cacheTtlSeconds ?? 0,
            cacheDir: opts.cacheDir ?? '',
          };
        default:
          return fallback;
      }
    },
    continueOnFail: () => continueOnFail,
    getNode: () => ({ name: 'Claude', type: 'claude', typeVersion: 1, position: [0, 0] }) as any,
    getExecutionCancelSignal: () => undefined,
    helpers: {} as any,
  } as unknown as IExecuteFunctions;
}

describe('Claude node — execute (US1)', () => {
  const node = new Claude();

  it('produces exactly one output item from one input', async () => {
    const ctx = makeExecuteContext({ prompts: ['hello'] });
    const out = await node.execute.call(ctx);
    expect(out).toHaveLength(1);
    expect(out[0]).toHaveLength(1);
    const item = out[0][0].json;
    expect(item).toMatchObject({ success: true });
    expect(item.response).toBe('hello');
    expect((item.meta as any).elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('surfaces a validation error for an empty prompt', async () => {
    const ctx = makeExecuteContext({ prompts: [''] });
    await expect(node.execute.call(ctx)).rejects.toThrow(/validation/i);
  });

  it('surfaces an exit-failure error for a non-zero CLI exit', async () => {
    const ctx = makeExecuteContext({
      cliBinaryName: path.join(FIXTURES, 'claude-stub-fail.sh'),
    });
    await expect(node.execute.call(ctx)).rejects.toThrow(/exit/i);
  });

  it('surfaces a parse-failure error for malformed CLI stdout', async () => {
    const ctx = makeExecuteContext({
      cliBinaryName: path.join(FIXTURES, 'claude-stub-malformed.sh'),
    });
    await expect(node.execute.call(ctx)).rejects.toThrow(/parse/i);
  });

  it('surfaces a not-found error for a missing CLI binary', async () => {
    const ctx = makeExecuteContext({
      cliBinaryName: path.join(FIXTURES, 'does-not-exist.sh'),
    });
    await expect(node.execute.call(ctx)).rejects.toThrow(/not.found|enoent/i);
  });
});

describe('Claude node — execute (US2: per-item)', () => {
  const node = new Claude();

  it('preserves input order across multiple items', async () => {
    const ctx = makeExecuteContext({
      inputItems: [{ q: 'a' }, { q: 'b' }, { q: 'c' }],
      prompts: ['first', 'second', 'third'],
    });
    const out = await node.execute.call(ctx);
    expect(out[0]).toHaveLength(3);
    expect(out[0][0].json.response).toBe('first');
    expect(out[0][1].json.response).toBe('second');
    expect(out[0][2].json.response).toBe('third');
  });

  it('honors continueOnFail: failed item emits ErrorPayload, others succeed', async () => {
    const ctx = makeExecuteContext({
      inputItems: [{}, {}, {}],
      prompts: ['ok1', '', 'ok3'],
      continueOnFail: true,
    });
    const out = await node.execute.call(ctx);
    expect(out[0]).toHaveLength(3);
    expect(out[0][0].json).toMatchObject({ success: true, response: 'ok1' });
    expect(out[0][1].json).toMatchObject({ success: false, category: 'validation' });
    expect(out[0][2].json).toMatchObject({ success: true, response: 'ok3' });
  });

  it('aborts on first failure when continueOnFail is false', async () => {
    const ctx = makeExecuteContext({
      inputItems: [{}, {}, {}],
      prompts: ['ok1', '', 'ok3'],
      continueOnFail: false,
    });
    await expect(node.execute.call(ctx)).rejects.toThrow(/validation/i);
  });
});

describe('Claude node — JSON response format (0.3.0 fail-soft)', () => {
  const node = new Claude();

  it('json mode includes all raw-mode fields plus a `json: { ok: true, value }`', async () => {
    const ctx = makeExecuteContext({
      cliBinaryName: path.join(FIXTURES, 'claude-stub-json-fenced.sh'),
      responseFormat: 'json',
    });
    const out = await node.execute.call(ctx);
    const item = out[0][0].json as any;
    expect(item.success).toBe(true);
    // raw-mode fields preserved
    expect(item.response).toMatch(/```json/);
    expect(item.model).toBe('claude-sonnet-4-6');
    expect(item.stopReason).toBe('end_turn');
    expect(item.usage).toEqual({ inputTokens: 3, outputTokens: 7 });
    expect(item.raw).toBeDefined();
    // new json field
    expect(item.json).toEqual({
      ok: true,
      value: { x: 42, items: [1, 2, 3] },
      attempts: 1,
    });
  });

  it('raw mode does not include the json field', async () => {
    const ctx = makeExecuteContext({
      cliBinaryName: path.join(FIXTURES, 'claude-stub-json-fenced.sh'),
      responseFormat: 'raw',
    });
    const out = await node.execute.call(ctx);
    const item = out[0][0].json as any;
    expect(item.json).toBeUndefined();
    expect(item.response).toMatch(/```json/);
  });

  it('fail-soft: emits success with `json: { ok: false, error, attempts }` when text is not JSON', async () => {
    const ctx = makeExecuteContext({
      cliBinaryName: path.join(FIXTURES, 'claude-stub-json-prose.sh'),
      responseFormat: 'json',
    });
    const out = await node.execute.call(ctx);
    const item = out[0][0].json as any;
    expect(item.success).toBe(true);
    expect(item.response).toMatch(/can't produce/i);
    expect(item.json.ok).toBe(false);
    expect(item.json.error).toMatch(/json|unexpected/i);
    expect(item.json.attempts).toBe(1);
  });

  it('retries N times on parse failure and reports attempts', async () => {
    const ctx = makeExecuteContext({
      cliBinaryName: path.join(FIXTURES, 'claude-stub-json-prose.sh'),
      responseFormat: 'json',
      retries: 2,
    });
    const out = await node.execute.call(ctx);
    const item = out[0][0].json as any;
    expect(item.success).toBe(true);
    expect(item.json.ok).toBe(false);
    expect(item.json.attempts).toBe(3);
  });

  it('CLI-level failures (e.g. exit-failure) still hard-fail in json mode', async () => {
    const ctx = makeExecuteContext({
      cliBinaryName: path.join(FIXTURES, 'claude-stub-fail.sh'),
      responseFormat: 'json',
    });
    await expect(node.execute.call(ctx)).rejects.toThrow(/exit/i);
  });
});

describe('Claude node — cache (0.4.0)', () => {
  const node = new Claude();
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = mkdtempSync(path.join(tmpdir(), 'claudenode-cache-it-'));
  });

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it('first call misses cache, second call hits', async () => {
    const mk = () =>
      makeExecuteContext({
        cliBinaryName: path.join(FIXTURES, 'claude-stub-success.sh'),
        prompts: ['cache me'],
        useCache: true,
        cacheDir,
      });

    const out1 = await node.execute.call(mk());
    const item1 = out1[0][0].json as any;
    expect(item1.meta.cacheHit).toBeUndefined();

    const out2 = await node.execute.call(mk());
    const item2 = out2[0][0].json as any;
    expect(item2.meta.cacheHit).toBe(true);
    expect(item2.meta.cachedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(item2.response).toBe(item1.response);
  });

  it('different prompts do not collide', async () => {
    const mk = (p: string) =>
      makeExecuteContext({
        cliBinaryName: path.join(FIXTURES, 'claude-stub-success.sh'),
        prompts: [p],
        useCache: true,
        cacheDir,
      });
    await node.execute.call(mk('one'));
    const out = await node.execute.call(mk('two'));
    expect((out[0][0].json as any).meta.cacheHit).toBeUndefined();
  });

  it('cache is bypassed when useCache is false', async () => {
    const mk = () =>
      makeExecuteContext({
        cliBinaryName: path.join(FIXTURES, 'claude-stub-success.sh'),
        prompts: ['no cache'],
        useCache: false,
        cacheDir,
      });
    await node.execute.call(mk());
    const out = await node.execute.call(mk());
    expect((out[0][0].json as any).meta.cacheHit).toBeUndefined();
  });

  it('json-mode parse failures are NOT cached', async () => {
    const mk = () =>
      makeExecuteContext({
        cliBinaryName: path.join(FIXTURES, 'claude-stub-json-prose.sh'),
        responseFormat: 'json',
        useCache: true,
        cacheDir,
      });
    await node.execute.call(mk());
    const out = await node.execute.call(mk());
    const item = out[0][0].json as any;
    expect(item.json.ok).toBe(false);
    expect(item.meta.cacheHit).toBeUndefined();
  });

  it('json-mode successful parses ARE cached', async () => {
    const mk = () =>
      makeExecuteContext({
        cliBinaryName: path.join(FIXTURES, 'claude-stub-json-fenced.sh'),
        responseFormat: 'json',
        useCache: true,
        cacheDir,
      });
    await node.execute.call(mk());
    const out = await node.execute.call(mk());
    const item = out[0][0].json as any;
    expect(item.json).toEqual({ ok: true, value: { x: 42, items: [1, 2, 3] }, attempts: 1 });
    expect(item.meta.cacheHit).toBe(true);
  });

  it('TTL=1: cache misses after expiry', async () => {
    const mk = () =>
      makeExecuteContext({
        cliBinaryName: path.join(FIXTURES, 'claude-stub-success.sh'),
        prompts: ['ttl test'],
        useCache: true,
        cacheTtlSeconds: 1,
        cacheDir,
      });
    await node.execute.call(mk());
    await new Promise((r) => setTimeout(r, 1100));
    const out = await node.execute.call(mk());
    expect((out[0][0].json as any).meta.cacheHit).toBeUndefined();
  });
});

describe('Claude node — model parameter', () => {
  const node = new Claude();

  it('passes through to the runner without affecting raw-mode output', async () => {
    const ctx = makeExecuteContext({
      cliBinaryName: path.join(FIXTURES, 'claude-stub-success.sh'),
      model: 'sonnet',
      prompts: ['hi'],
    });
    const out = await node.execute.call(ctx);
    expect(out[0][0].json.success).toBe(true);
  });
});

describe('Claude node — systemPrompt parameter (0.5.0)', () => {
  const node = new Claude();
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = mkdtempSync(path.join(tmpdir(), 'claudenode-sp-it-'));
  });

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it('different systemPrompt → different cache entry (no false hit)', async () => {
    const mk = (sp: string) =>
      makeExecuteContext({
        cliBinaryName: path.join(FIXTURES, 'claude-stub-success.sh'),
        prompts: ['hello'],
        systemPrompt: sp,
        useCache: true,
        cacheDir,
      });

    // Prime cache with one persona.
    await node.execute.call(mk('You are a poet.'));
    // Different persona must miss.
    const out = await node.execute.call(mk('You are terse.'));
    expect((out[0][0].json as any).meta.cacheHit).toBeUndefined();
    // Same persona again must hit.
    const out2 = await node.execute.call(mk('You are terse.'));
    expect((out2[0][0].json as any).meta.cacheHit).toBe(true);
  });
});

describe('Claude node — performance (Polish T041)', () => {
  const node = new Claude();

  it('node-side overhead p95 is under 50 ms across 20 runs against the happy-path stub', async () => {
    const overheads: number[] = [];
    for (let n = 0; n < 20; n++) {
      const ctx = makeExecuteContext({ prompts: ['perf'] });
      const wallStart = Date.now();
      const out = await node.execute.call(ctx);
      const wallElapsed = Date.now() - wallStart;
      const subprocElapsed = (out[0][0].json.meta as any).elapsedMs as number;
      overheads.push(wallElapsed - subprocElapsed);
    }
    overheads.sort((a, b) => a - b);
    const p95 = overheads[Math.floor(overheads.length * 0.95)];
    expect(p95).toBeLessThan(50);
  });
});

describe('Claude node — execute (US3: enriched error details via continue-on-fail)', () => {
  const node = new Claude();

  it('exit-failure payload includes exitCode and a stderr excerpt', async () => {
    const ctx = makeExecuteContext({
      cliBinaryName: path.join(FIXTURES, 'claude-stub-fail.sh'),
      continueOnFail: true,
    });
    const out = await node.execute.call(ctx);
    const item = out[0][0].json as any;
    expect(item.success).toBe(false);
    expect(item.category).toBe('exit-failure');
    expect(item.details.exitCode).toBe(2);
    expect(item.details.stderrExcerpt).toMatch(/stub-fail/);
  });

  it('parse-failure payload includes a stdout excerpt', async () => {
    const ctx = makeExecuteContext({
      cliBinaryName: path.join(FIXTURES, 'claude-stub-malformed.sh'),
      continueOnFail: true,
    });
    const out = await node.execute.call(ctx);
    const item = out[0][0].json as any;
    expect(item.category).toBe('parse-failure');
    expect(item.details.stdoutExcerpt).toMatch(/not valid json/);
  });

  it('not-found payload includes binaryName and pathHint', async () => {
    const ctx = makeExecuteContext({
      cliBinaryName: path.join(FIXTURES, 'does-not-exist.sh'),
      continueOnFail: true,
    });
    const out = await node.execute.call(ctx);
    const item = out[0][0].json as any;
    expect(item.category).toBe('not-found');
    expect(item.details.binaryName).toContain('does-not-exist.sh');
    expect(typeof item.details.pathHint).toBe('string');
  });
});
