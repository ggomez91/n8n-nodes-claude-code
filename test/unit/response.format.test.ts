import { sliceJsonSpan, stripFences, tryParseJson } from '../../nodes/Claude/lib/response.format';

describe('stripFences', () => {
  it('returns trimmed text when no fences are present', () => {
    expect(stripFences('  {"a":1}  ')).toBe('{"a":1}');
  });

  it('strips ```json ... ``` fence', () => {
    expect(stripFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('strips bare ``` ... ``` fence', () => {
    expect(stripFences('```\n[1,2,3]\n```')).toBe('[1,2,3]');
  });

  it('strips fence with surrounding whitespace', () => {
    expect(stripFences('   ```json\n  {"a":1}  \n```   ')).toBe('{"a":1}');
  });

  it('extracts the first fenced block when surrounded by prose', () => {
    const input = 'Here is the JSON: ```json\n{"a":1}\n```';
    expect(stripFences(input)).toBe('{"a":1}');
  });

  it('extracts a fenced block followed by a trailing note', () => {
    const input = '```json\n{"a":1}\n```\n\nNote: fetch failed with 403.';
    expect(stripFences(input)).toBe('{"a":1}');
  });

  it('extracts the first fenced block when multiple are present', () => {
    const input = '```json\n{"a":1}\n```\n\nand later ```json\n{"b":2}\n```';
    expect(stripFences(input)).toBe('{"a":1}');
  });
});

describe('tryParseJson', () => {
  it('parses bare JSON object', () => {
    const r = tryParseJson('{"x":42}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ x: 42 });
  });

  it('parses fenced JSON object', () => {
    const r = tryParseJson('```json\n{"x":42}\n```');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({ x: 42 });
      expect(r.cleaned).toBe('{"x":42}');
    }
  });

  it('parses JSON array', () => {
    const r = tryParseJson('[1,2,3]');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([1, 2, 3]);
  });

  it('parses JSON primitive', () => {
    const r = tryParseJson('42');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });

  it('fails for non-JSON text', () => {
    const r = tryParseJson('this is not json at all');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/json|unexpected/i);
  });

  it('fails for fenced non-JSON content', () => {
    const r = tryParseJson('```\njust some prose\n```');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cleaned).toBe('just some prose');
  });

  it('parses unfenced JSON object wrapped in prose', () => {
    const r = tryParseJson('Here is the JSON: {"a":1}\n\nNote: fetch failed.');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({ a: 1 });
      expect(r.cleaned).toBe('{"a":1}');
    }
  });

  it('parses unfenced JSON array wrapped in prose', () => {
    const r = tryParseJson('Sure, here you go: [1,2,3]\nThanks!');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([1, 2, 3]);
  });
});

describe('sliceJsonSpan', () => {
  it('returns null when no braces or brackets are present', () => {
    expect(sliceJsonSpan('just prose')).toBeNull();
  });

  it('slices a {...} span out of surrounding prose', () => {
    expect(sliceJsonSpan('preamble {"a":1} trailing')).toBe('{"a":1}');
  });

  it('slices a [...] span out of surrounding prose', () => {
    expect(sliceJsonSpan('preamble [1,2,3] trailing')).toBe('[1,2,3]');
  });

  it('prefers the earlier opener when both { and [ appear', () => {
    // `[` opens first, so closer is `]` and the span is just the array
    expect(sliceJsonSpan('text [1,2] more {"a":1} end')).toBe('[1,2]');
  });

  it('extends to the last matching closer', () => {
    const input = 'before {"a":{"b":1}} after';
    expect(sliceJsonSpan(input)).toBe('{"a":{"b":1}}');
  });
});
