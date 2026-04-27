import { parseCliOutput, ParseFailure } from '../../nodes/Claude/lib/output.parser';

const buf = (s: string): Buffer => Buffer.from(s, 'utf8');

describe('output.parser.parseCliOutput', () => {
  it('parses a fully-populated CLI envelope into a NodeOutputItem', () => {
    const stdout = buf(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: 'Hello, world!',
        model: 'claude-sonnet-4-6',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
        session_id: 'abc-123',
      }),
    );
    const out = parseCliOutput(stdout, 1234);
    expect(out.success).toBe(true);
    expect(out.response).toBe('Hello, world!');
    expect(out.model).toBe('claude-sonnet-4-6');
    expect(out.stopReason).toBe('end_turn');
    expect(out.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(out.meta).toEqual({ elapsedMs: 1234 });
    expect(out.raw).toMatchObject({ session_id: 'abc-123' });
  });

  it('falls back to "response" field when "result" is absent', () => {
    const stdout = buf(JSON.stringify({ response: 'fallback text' }));
    const out = parseCliOutput(stdout, 0);
    expect(out.response).toBe('fallback text');
  });

  it('preserves unknown fields in raw', () => {
    const stdout = buf(
      JSON.stringify({ result: 'hi', custom_future_field: { nested: true } }),
    );
    const out = parseCliOutput(stdout, 0);
    expect(out.raw).toMatchObject({ custom_future_field: { nested: true } });
  });

  it('omits optional fields when CLI does not provide them', () => {
    const stdout = buf(JSON.stringify({ result: 'just text' }));
    const out = parseCliOutput(stdout, 0);
    expect(out.model).toBeUndefined();
    expect(out.stopReason).toBeUndefined();
    expect(out.usage).toBeUndefined();
  });

  it('throws ParseFailure on invalid JSON', () => {
    expect(() => parseCliOutput(buf('not json {{{'), 0)).toThrow(ParseFailure);
  });

  it('throws ParseFailure when stdout is not a JSON object', () => {
    expect(() => parseCliOutput(buf('"just a string"'), 0)).toThrow(ParseFailure);
    expect(() => parseCliOutput(buf('42'), 0)).toThrow(ParseFailure);
    expect(() => parseCliOutput(buf('null'), 0)).toThrow(ParseFailure);
  });

  it('throws ParseFailure when no response-like field is present', () => {
    expect(() => parseCliOutput(buf(JSON.stringify({ misc: true })), 0)).toThrow(ParseFailure);
  });
});
