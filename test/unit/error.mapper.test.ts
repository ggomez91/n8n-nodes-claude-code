import { mapToError } from '../../nodes/Claude/lib/error.mapper';

describe('error.mapper.mapToError — US1 categories', () => {
  it('builds a validation error', () => {
    const e = mapToError('validation', { parameter: 'prompt', received: '' }, { itemIndex: 0 });
    expect(e.success).toBe(false);
    expect(e.category).toBe('validation');
    expect(e.message).toMatch(/validation/i);
    expect(e.details).toMatchObject({ parameter: 'prompt' });
    expect(e.meta.itemIndex).toBe(0);
  });

  it('builds a not-found error including pathHint', () => {
    const e = mapToError(
      'not-found',
      { binaryName: 'claude', pathHint: '/usr/local/bin:/usr/bin' },
      { itemIndex: 1, elapsedMs: 12 },
    );
    expect(e.category).toBe('not-found');
    expect(e.details).toMatchObject({ binaryName: 'claude', pathHint: expect.any(String) });
    expect(e.meta.elapsedMs).toBe(12);
  });

  it('builds an exit-failure error including stderrExcerpt', () => {
    const e = mapToError(
      'exit-failure',
      { exitCode: 2, stderrExcerpt: 'Error: invalid auth\n' },
      { itemIndex: 2, elapsedMs: 200 },
    );
    expect(e.category).toBe('exit-failure');
    expect(e.details).toMatchObject({ exitCode: 2, stderrExcerpt: expect.stringContaining('invalid auth') });
  });

  it('builds a parse-failure error including a stdout excerpt', () => {
    const e = mapToError(
      'parse-failure',
      { parseError: 'Unexpected token', stdoutExcerpt: 'not json' },
      { itemIndex: 3, elapsedMs: 50 },
    );
    expect(e.category).toBe('parse-failure');
    expect(e.details).toMatchObject({ parseError: expect.any(String) });
  });
});

describe('error.mapper.mapToError — US3 categories', () => {
  it('builds a timeout error with signalEscalatedTo=null when SIGTERM worked', () => {
    const e = mapToError(
      'timeout',
      { timeoutSeconds: 30, signalEscalatedTo: null },
      { itemIndex: 0, elapsedMs: 30_100 },
    );
    expect(e.category).toBe('timeout');
    expect(e.details).toMatchObject({ timeoutSeconds: 30, signalEscalatedTo: null });
  });

  it('builds a timeout error with signalEscalatedTo=SIGKILL', () => {
    const e = mapToError(
      'timeout',
      { timeoutSeconds: 30, signalEscalatedTo: 'SIGKILL' },
      { itemIndex: 0, elapsedMs: 35_100 },
    );
    expect(e.details).toMatchObject({ signalEscalatedTo: 'SIGKILL' });
  });

  it('builds a cancelled error with empty details', () => {
    const e = mapToError('cancelled', {}, { itemIndex: 0, elapsedMs: 500 });
    expect(e.category).toBe('cancelled');
    expect(e.details).toEqual({});
  });
});
