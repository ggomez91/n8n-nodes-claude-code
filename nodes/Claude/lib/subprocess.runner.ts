import { spawn } from 'node:child_process';
import type { NodeInputItem, SubprocessResult, TerminationReason } from './types';

const STDIO_CAP_BYTES = 10 * 1024 * 1024;
const SIGKILL_GRACE_MS = 5_000;

export interface RunOptions {
  cancelSignal?: AbortSignal;
  /** Absolute path to a directory containing staged binary attachments. Adds --add-dir. */
  attachmentsDir?: string;
}

export async function runCli(
  input: NodeInputItem,
  opts: RunOptions = {},
): Promise<SubprocessResult> {
  const start = Date.now();
  const args = ['-p', '--output-format', 'json'];
  if (input.model) args.push('--model', input.model);
  if (opts.attachmentsDir) args.push('--add-dir', opts.attachmentsDir);
  if (input.systemPrompt) args.push('--append-system-prompt', input.systemPrompt);
  if (input.resumeSessionId) args.push('--resume', input.resumeSessionId);
  args.push(input.prompt);

  return new Promise((resolve) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutLen = 0;
    let stderrLen = 0;

    let timeoutHandle: NodeJS.Timeout | null = null;
    let killHandle: NodeJS.Timeout | null = null;
    let terminationReason: TerminationReason | null = null;
    let signalEscalatedTo: 'SIGKILL' | null = null;
    let resolved = false;

    const finish = (result: SubprocessResult): void => {
      if (resolved) return;
      resolved = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (killHandle) clearTimeout(killHandle);
      if (opts.cancelSignal) opts.cancelSignal.removeEventListener('abort', onCancel);
      resolve(result);
    };

    const child = spawn(input.cliBinaryName, args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
      finish({
        exitCode: null,
        signal: null,
        stdout: Buffer.concat(stdoutChunks, stdoutLen),
        stderr: Buffer.concat(stderrChunks, stderrLen),
        elapsedMs: Date.now() - start,
        terminationReason: 'spawn-error',
        spawnError: err,
        signalEscalatedTo: null,
      });
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdoutLen >= STDIO_CAP_BYTES) return;
      const room = STDIO_CAP_BYTES - stdoutLen;
      const slice = chunk.length > room ? chunk.subarray(0, room) : chunk;
      stdoutChunks.push(slice);
      stdoutLen += slice.length;
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderrLen >= STDIO_CAP_BYTES) return;
      const room = STDIO_CAP_BYTES - stderrLen;
      const slice = chunk.length > room ? chunk.subarray(0, room) : chunk;
      stderrChunks.push(slice);
      stderrLen += slice.length;
    });

    child.on('exit', (exitCode, signal) => {
      const reason: TerminationReason = terminationReason ?? 'exited';
      finish({
        exitCode,
        signal,
        stdout: Buffer.concat(stdoutChunks, stdoutLen),
        stderr: Buffer.concat(stderrChunks, stderrLen),
        elapsedMs: Date.now() - start,
        terminationReason: reason,
        spawnError: null,
        signalEscalatedTo,
      });
    });

    const escalate = (): void => {
      if (child.exitCode === null && child.signalCode === null) {
        signalEscalatedTo = 'SIGKILL';
        try {
          child.kill('SIGKILL');
        } catch {
          // already dead
        }
      }
    };

    timeoutHandle = setTimeout(() => {
      terminationReason = 'timeout';
      try {
        child.kill('SIGTERM');
      } catch {
        // already dead
      }
      killHandle = setTimeout(escalate, SIGKILL_GRACE_MS);
      killHandle.unref();
    }, input.timeoutSeconds * 1000);
    timeoutHandle.unref();

    function onCancel(): void {
      terminationReason = 'cancelled';
      try {
        child.kill('SIGTERM');
      } catch {
        // already dead
      }
      killHandle = setTimeout(escalate, SIGKILL_GRACE_MS);
      killHandle.unref();
    }

    if (opts.cancelSignal) {
      if (opts.cancelSignal.aborted) onCancel();
      else opts.cancelSignal.addEventListener('abort', onCancel, { once: true });
    }
  });
}
