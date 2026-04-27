import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  cacheKey,
  isCacheable,
  readCache,
  writeCache,
} from '../../nodes/Claude/lib/cache';
import type { NodeOutputItem } from '../../nodes/Claude/lib/types';

function makeItem(over: Partial<NodeOutputItem> = {}): NodeOutputItem {
  return {
    success: true,
    response: 'hello',
    raw: { ok: true },
    meta: { elapsedMs: 100 },
    ...over,
  };
}

describe('cacheKey', () => {
  const base = {
    prompt: 'hi',
    model: 'sonnet',
    systemPrompt: undefined,
    responseFormat: 'raw' as const,
    cliBinaryName: 'claude',
    attachmentsDigest: '',
  };

  it('produces a 64-char hex hash', () => {
    expect(cacheKey(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable for identical inputs', () => {
    expect(cacheKey(base)).toBe(cacheKey(base));
  });

  it('changes when prompt changes', () => {
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, prompt: 'hi!' }));
  });

  it('changes when model changes', () => {
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, model: 'opus' }));
  });

  it('treats undefined model and empty model differently from a set model', () => {
    const noModel = cacheKey({ ...base, model: undefined });
    const empty = cacheKey({ ...base, model: '' });
    expect(noModel).toBe(empty); // both canonicalize to ""
    expect(noModel).not.toBe(cacheKey(base));
  });

  it('changes when responseFormat changes', () => {
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, responseFormat: 'json' }));
  });

  it('changes when cliBinaryName changes', () => {
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, cliBinaryName: '/opt/claude' }));
  });

  it('changes when systemPrompt changes', () => {
    const a = cacheKey(base);
    const b = cacheKey({ ...base, systemPrompt: 'You are a poet.' });
    const c = cacheKey({ ...base, systemPrompt: 'You are terse.' });
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    expect(a).not.toBe(c);
  });

  it('treats undefined systemPrompt and empty as equivalent', () => {
    expect(cacheKey({ ...base, systemPrompt: undefined })).toBe(
      cacheKey({ ...base, systemPrompt: '' }),
    );
  });

  it('changes when attachmentsDigest changes', () => {
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, attachmentsDigest: 'a'.repeat(64) }));
    expect(cacheKey({ ...base, attachmentsDigest: 'a'.repeat(64) })).not.toBe(
      cacheKey({ ...base, attachmentsDigest: 'b'.repeat(64) }),
    );
  });
});

describe('readCache / writeCache', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'claudenode-cache-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null on cache miss', () => {
    expect(readCache(dir, 'nonexistent-key', 0)).toBeNull();
  });

  it('round-trips an item', () => {
    const item = makeItem({ response: 'cached value' });
    writeCache(dir, 'k1', item);
    const out = readCache(dir, 'k1', 0)!;
    expect(out.response).toBe('cached value');
    expect(out.meta.cachedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('respects TTL: returns item when within TTL', () => {
    writeCache(dir, 'k2', makeItem());
    expect(readCache(dir, 'k2', 60)).not.toBeNull();
  });

  it('respects TTL: returns null when expired', async () => {
    writeCache(dir, 'k3', makeItem());
    // Sleep 1100ms then read with TTL=1s.
    await new Promise((r) => setTimeout(r, 1100));
    expect(readCache(dir, 'k3', 1)).toBeNull();
  });

  it('TTL=0 means never expire (sanity)', async () => {
    writeCache(dir, 'k4', makeItem());
    await new Promise((r) => setTimeout(r, 50));
    expect(readCache(dir, 'k4', 0)).not.toBeNull();
  });

  it('creates the cache directory if missing', () => {
    const nested = join(dir, 'a', 'b', 'c');
    expect(existsSync(nested)).toBe(false);
    writeCache(nested, 'k', makeItem());
    expect(existsSync(nested)).toBe(true);
    expect(readdirSync(nested)).toContain('k.json');
  });

  it('returns null on corrupted cache file', () => {
    writeCache(dir, 'corrupt', makeItem());
    // Overwrite with garbage.
    writeFileSync(join(dir, 'corrupt.json'), 'not-json{', 'utf8');
    expect(readCache(dir, 'corrupt', 0)).toBeNull();
  });
});

describe('isCacheable', () => {
  it('caches a successful raw item', () => {
    expect(isCacheable(makeItem())).toBe(true);
  });

  it('caches a successful json-mode item with json.ok=true', () => {
    expect(
      isCacheable(makeItem({ json: { ok: true, value: { x: 1 }, attempts: 1 } })),
    ).toBe(true);
  });

  it('does NOT cache a json-mode item with json.ok=false', () => {
    expect(
      isCacheable(
        makeItem({ json: { ok: false, error: 'bad json', attempts: 3 } }),
      ),
    ).toBe(false);
  });
});
