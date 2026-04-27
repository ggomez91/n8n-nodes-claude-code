import { validateAndNormalize } from '../../nodes/Claude/lib/parameters';

describe('parameters.validateAndNormalize', () => {
  const base = { prompt: 'hello', timeoutSeconds: 120, cliBinaryName: 'claude', itemIndex: 0 };

  it('passes a valid input through unchanged', () => {
    expect(validateAndNormalize(base)).toEqual(base);
  });

  it('rejects an empty prompt', () => {
    expect(() => validateAndNormalize({ ...base, prompt: '' })).toThrow(
      /prompt.*non-empty/i,
    );
  });

  it('rejects a whitespace-only prompt', () => {
    expect(() => validateAndNormalize({ ...base, prompt: '   \n  ' })).toThrow(
      /prompt.*non-empty/i,
    );
  });

  it('rejects a non-string non-number-non-object prompt (null)', () => {
    expect(() => validateAndNormalize({ ...base, prompt: null as unknown as string })).toThrow(
      /prompt/i,
    );
  });

  it('rejects timeoutSeconds below 1', () => {
    expect(() => validateAndNormalize({ ...base, timeoutSeconds: 0 })).toThrow(
      /timeoutSeconds/i,
    );
  });

  it('rejects timeoutSeconds above 1800', () => {
    expect(() => validateAndNormalize({ ...base, timeoutSeconds: 1801 })).toThrow(
      /timeoutSeconds/i,
    );
  });

  it('rejects a cliBinaryName containing shell metacharacters', () => {
    expect(() => validateAndNormalize({ ...base, cliBinaryName: 'claude;rm' })).toThrow(
      /cliBinaryName/i,
    );
    expect(() => validateAndNormalize({ ...base, cliBinaryName: 'claude /etc' })).toThrow(
      /cliBinaryName/i,
    );
  });

  it('accepts a path-like cliBinaryName with dots and dashes', () => {
    const out = validateAndNormalize({ ...base, cliBinaryName: 'claude-stub_v1.2' });
    expect(out.cliBinaryName).toBe('claude-stub_v1.2');
  });

  // US2: expression coercion
  it('coerces a numeric prompt to its string form', () => {
    const out = validateAndNormalize({ ...base, prompt: 42 as unknown as string });
    expect(out.prompt).toBe('42');
  });

  it('coerces an object prompt to its JSON string form', () => {
    const out = validateAndNormalize({ ...base, prompt: { q: 'hi' } as unknown as string });
    expect(out.prompt).toBe('{"q":"hi"}');
  });

  it('rejects undefined prompt as validation error', () => {
    expect(() =>
      validateAndNormalize({ ...base, prompt: undefined as unknown as string }),
    ).toThrow(/prompt/i);
  });

  // model field
  it('omits model when empty/undefined', () => {
    expect(validateAndNormalize({ ...base, model: '' }).model).toBeUndefined();
    expect(validateAndNormalize({ ...base, model: undefined }).model).toBeUndefined();
    expect(validateAndNormalize({ ...base }).model).toBeUndefined();
  });

  it('passes through valid model aliases and IDs', () => {
    expect(validateAndNormalize({ ...base, model: 'sonnet' }).model).toBe('sonnet');
    expect(validateAndNormalize({ ...base, model: 'claude-sonnet-4-6' }).model).toBe('claude-sonnet-4-6');
  });

  it('rejects model with shell metacharacters', () => {
    expect(() => validateAndNormalize({ ...base, model: 'sonnet;rm' })).toThrow(/model/i);
    expect(() => validateAndNormalize({ ...base, model: 'sonnet /etc' })).toThrow(/model/i);
  });

  // systemPrompt field
  it('omits systemPrompt when empty/undefined/whitespace', () => {
    expect(validateAndNormalize({ ...base, systemPrompt: '' }).systemPrompt).toBeUndefined();
    expect(validateAndNormalize({ ...base, systemPrompt: undefined }).systemPrompt).toBeUndefined();
    expect(validateAndNormalize({ ...base, systemPrompt: '   ' }).systemPrompt).toBeUndefined();
  });

  it('passes through arbitrary systemPrompt content (no shell-injection risk: argv-only)', () => {
    const evil = "You are a poet.\n```bash\nrm -rf /\n```";
    expect(validateAndNormalize({ ...base, systemPrompt: evil }).systemPrompt).toBe(evil);
  });
});
