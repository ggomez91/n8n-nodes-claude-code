import * as path from 'node:path';
import { runCli } from '../../nodes/Claude/lib/subprocess.runner';
import type { NodeInputItem } from '../../nodes/Claude/lib/types';

const FIXTURES = path.resolve(__dirname, '..', 'fixtures');

function input(overrides: Partial<NodeInputItem> = {}): NodeInputItem {
  return {
    prompt: 'hello world',
    timeoutSeconds: 5,
    cliBinaryName: path.join(FIXTURES, 'claude-stub-success.sh'),
    itemIndex: 0,
    ...overrides,
  };
}

describe('subprocess.runner — happy path (US1)', () => {
  it('spawns the stub binary and returns parsed result on success', async () => {
    const result = await runCli(input());
    expect(result.terminationReason).toBe('exited');
    expect(result.exitCode).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.stdout.length).toBeGreaterThan(0);
    const obj = JSON.parse(result.stdout.toString('utf8'));
    expect(obj).toMatchObject({ type: 'result', subtype: 'success' });
  });

  it('captures stderr and non-zero exit for the failure stub', async () => {
    const result = await runCli(
      input({ cliBinaryName: path.join(FIXTURES, 'claude-stub-fail.sh') }),
    );
    expect(result.terminationReason).toBe('exited');
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString('utf8')).toMatch(/stub-fail/);
  });

  it('reports spawn-error with ENOENT for a missing binary', async () => {
    const result = await runCli(
      input({ cliBinaryName: path.join(FIXTURES, 'does-not-exist.sh') }),
    );
    expect(result.terminationReason).toBe('spawn-error');
    expect(result.spawnError?.code).toBe('ENOENT');
  });

  it('returns the malformed stub stdout intact (parser will reject it)', async () => {
    const result = await runCli(
      input({ cliBinaryName: path.join(FIXTURES, 'claude-stub-malformed.sh') }),
    );
    expect(result.terminationReason).toBe('exited');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString('utf8')).toMatch(/not valid json/);
  });

  it('does not include --model in argv when model is undefined', async () => {
    const result = await runCli(
      input({ cliBinaryName: path.join(FIXTURES, 'claude-stub-echoargs.sh'), prompt: 'hi' }),
    );
    const obj = JSON.parse(result.stdout.toString('utf8'));
    expect(obj.args).toEqual(['-p', '--output-format', 'json', 'hi']);
  });

  it('includes --model <value> in argv when model is set', async () => {
    const result = await runCli(
      input({
        cliBinaryName: path.join(FIXTURES, 'claude-stub-echoargs.sh'),
        prompt: 'hi',
        model: 'sonnet',
      }),
    );
    const obj = JSON.parse(result.stdout.toString('utf8'));
    expect(obj.args).toEqual(['-p', '--output-format', 'json', '--model', 'sonnet', 'hi']);
  });

  it('includes --append-system-prompt <value> in argv when systemPrompt is set', async () => {
    const result = await runCli(
      input({
        cliBinaryName: path.join(FIXTURES, 'claude-stub-echoargs.sh'),
        prompt: 'hi',
        systemPrompt: 'You are a poet.',
      }),
    );
    const obj = JSON.parse(result.stdout.toString('utf8'));
    expect(obj.args).toEqual([
      '-p',
      '--output-format',
      'json',
      '--append-system-prompt',
      'You are a poet.',
      'hi',
    ]);
  });

  it('combines --model and --append-system-prompt when both set', async () => {
    const result = await runCli(
      input({
        cliBinaryName: path.join(FIXTURES, 'claude-stub-echoargs.sh'),
        prompt: 'hi',
        model: 'opus',
        systemPrompt: 'You are terse.',
      }),
    );
    const obj = JSON.parse(result.stdout.toString('utf8'));
    expect(obj.args).toEqual([
      '-p',
      '--output-format',
      'json',
      '--model',
      'opus',
      '--append-system-prompt',
      'You are terse.',
      'hi',
    ]);
  });
});

describe('subprocess.runner — timeout & cancellation (US3)', () => {
  it('terminates a hanging-but-graceful stub on timeout with SIGTERM (no escalation)', async () => {
    const start = Date.now();
    const result = await runCli(
      input({ cliBinaryName: path.join(FIXTURES, 'claude-stub-hang-graceful.sh'), timeoutSeconds: 1 }),
    );
    const elapsed = Date.now() - start;
    expect(result.terminationReason).toBe('timeout');
    expect(result.signalEscalatedTo).toBeNull();
    expect(elapsed).toBeLessThan(3_000);
  });

  it('escalates to SIGKILL when the stub ignores SIGTERM', async () => {
    const start = Date.now();
    const result = await runCli(
      input({ cliBinaryName: path.join(FIXTURES, 'claude-stub-hang.sh'), timeoutSeconds: 1 }),
    );
    const elapsed = Date.now() - start;
    expect(result.terminationReason).toBe('timeout');
    expect(result.signalEscalatedTo).toBe('SIGKILL');
    expect(elapsed).toBeLessThan(8_000);
  });

  it('cancels an in-flight invocation via AbortSignal within 5 seconds', async () => {
    const ctrl = new AbortController();
    const start = Date.now();
    setTimeout(() => ctrl.abort(), 200);
    const result = await runCli(
      input({ cliBinaryName: path.join(FIXTURES, 'claude-stub-hang-graceful.sh'), timeoutSeconds: 30 }),
      { cancelSignal: ctrl.signal },
    );
    const elapsed = Date.now() - start;
    expect(result.terminationReason).toBe('cancelled');
    expect(elapsed).toBeLessThan(6_000);
  });
});

describe('subprocess.runner — resume flag', () => {
  it('includes --resume <value> in argv when resumeSessionId is set', async () => {
    const result = await runCli(
      input({
        cliBinaryName: path.join(FIXTURES, 'claude-stub-echoargs.sh'),
        prompt: 'hi',
        resumeSessionId: '8f14e45f-ceea-4670-a134-6d1f0a7b26fd',
      }),
    );
    const obj = JSON.parse(result.stdout.toString('utf8'));
    expect(obj.args).toEqual([
      '-p',
      '--output-format',
      'json',
      '--resume',
      '8f14e45f-ceea-4670-a134-6d1f0a7b26fd',
      'hi',
    ]);
  });

  it('does not include --resume when resumeSessionId is undefined', async () => {
    const result = await runCli(
      input({ cliBinaryName: path.join(FIXTURES, 'claude-stub-echoargs.sh'), prompt: 'hi' }),
    );
    const obj = JSON.parse(result.stdout.toString('utf8'));
    expect(obj.args).toEqual(['-p', '--output-format', 'json', 'hi']);
  });
});
