export type ErrorCategory =
  | 'validation'
  | 'not-found'
  | 'exit-failure'
  | 'parse-failure'
  | 'timeout'
  | 'cancelled';

export type ResponseFormat = 'raw' | 'json';

export type JsonOutcome =
  | { ok: true; value: unknown; attempts: number }
  | { ok: false; error: string; attempts: number };

export interface NodeInputItem {
  prompt: string;
  timeoutSeconds: number;
  cliBinaryName: string;
  model?: string;
  systemPrompt?: string;
  /** Claude Code session ID to resume (--resume). The CLI continues that conversation. */
  resumeSessionId?: string;
  itemIndex: number;
  /**
   * Resolved binary attachments. Each entry is a buffer + a sanitized
   * filename. The runner writes them to a per-invocation temp dir and
   * adds --add-dir <tempdir> to argv. The Claude.node execute loop is
   * responsible for cleanup.
   */
  attachments?: BinaryAttachment[];
}

export interface BinaryAttachment {
  fileName: string;
  buffer: Buffer;
  mimeType?: string;
}

export type TerminationReason = 'exited' | 'timeout' | 'cancelled' | 'spawn-error';

export interface SubprocessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: Buffer;
  stderr: Buffer;
  elapsedMs: number;
  terminationReason: TerminationReason;
  spawnError: NodeJS.ErrnoException | null;
  signalEscalatedTo: 'SIGKILL' | null;
}

export interface NodeOutputItem {
  success: true;
  response: string;
  json?: JsonOutcome;
  /** Session ID reported by the CLI envelope; pass back as resumeSessionId for multi-turn. */
  sessionId?: string;
  model?: string;
  stopReason?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    [k: string]: unknown;
  };
  raw: Record<string, unknown>;
  meta: { elapsedMs: number; cacheHit?: boolean; cachedAt?: string };
  [k: string]: unknown;
}

export interface ErrorPayloadMeta {
  itemIndex: number;
  elapsedMs?: number;
}

export type ErrorDetails =
  | { parameter: string; received?: unknown }
  | { binaryName: string; pathHint?: string }
  | { exitCode: number; stderrExcerpt?: string }
  | { parseError: string; stdoutExcerpt?: string }
  | { timeoutSeconds: number; signalEscalatedTo: 'SIGKILL' | null }
  | Record<string, never>;

export interface ErrorPayload {
  success: false;
  category: ErrorCategory;
  message: string;
  details: ErrorDetails;
  meta: ErrorPayloadMeta;
}
