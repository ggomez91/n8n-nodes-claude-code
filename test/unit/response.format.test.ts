import { stripFences, tryParseJson } from '../../nodes/Claude/lib/response.format';

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

  it('leaves fence-like text alone if not wrapping the entire string', () => {
    const input = 'Here is the JSON: ```json\n{"a":1}\n```';
    expect(stripFences(input)).toBe(input.trim());
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
});
