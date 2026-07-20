import type { INodeProperties } from 'n8n-workflow';
import type { NodeInputItem } from './types';

export const nodeProperties: INodeProperties[] = [
  {
    displayName: 'Prompt',
    name: 'prompt',
    type: 'string',
    typeOptions: { rows: 4 },
    default: '',
    required: true,
    description: 'The prompt to send to Claude. Supports n8n expressions.',
  },
  {
    displayName: 'Timeout (Seconds)',
    name: 'timeoutSeconds',
    type: 'number',
    typeOptions: { minValue: 1, maxValue: 1800 },
    default: 120,
    description:
      'Maximum wall-clock seconds to wait for the CLI before terminating it. Range 1–1800.',
  },
  {
    displayName: 'Model',
    name: 'model',
    type: 'string',
    default: '',
    placeholder: 'opus, sonnet, haiku, claude-sonnet-4-6, …',
    description:
      "The Claude model to use. Leave empty to use the CLI's default. Accepts an alias (opus, sonnet, haiku) or a full model ID (e.g. claude-sonnet-4-6). New models added by Anthropic are usable immediately as soon as the local CLI supports them.",
  },
  {
    displayName: 'Binary Properties',
    name: 'binaryProperties',
    type: 'string',
    default: '',
    placeholder: 'data, attachment1, screenshot',
    description:
      "Comma-separated list of binary property names on the input item to attach as files. Each is staged into a temp directory passed via --add-dir, so Claude Code can Read them (including images for vision). The temp dir is deleted after the call. Leave empty for text-only invocations.",
  },
  {
    displayName: 'System Prompt',
    name: 'systemPrompt',
    type: 'string',
    typeOptions: { rows: 4 },
    default: '',
    placeholder: 'You are a warm, conversational newsletter writer in Mexican Spanish. Reply in 3 short paragraphs.',
    description:
      "Optional persona/instructions that go before the user prompt. Appended to Claude Code's default system prompt (does not replace it). Supports n8n expressions. Leave empty to use only the CLI's default.",
  },
  {
    displayName: 'Response Format',
    name: 'responseFormat',
    type: 'options',
    default: 'raw',
    options: [
      { name: 'Raw Text', value: 'raw' },
      { name: 'JSON', value: 'json' },
    ],
    // eslint-disable-next-line n8n-nodes-base/node-param-description-miscased-json
    description:
      'Raw returns the response text as-is. JSON mode strips fenced code blocks, attempts to parse the result, and reports parse status on the output item under a json field (with parsed value or error). The node always succeeds; downstream nodes can branch on whether parsing succeeded.',
  },
  {
    displayName: 'Options',
    name: 'options',
    type: 'collection',
    placeholder: 'Add Option',
    default: {},
    options: [
      {
        displayName: 'Cache Directory',
        name: 'cacheDir',
        type: 'string',
        default: '',
        placeholder: 'Defaults to <tmpdir>/n8n-nodes-claude-cache',
        description:
          "Directory where cache files are stored. Empty uses the OS temporary directory. Only meaningful when Cache Responses is on. The directory is created if missing. Use a persistent path (e.g. /var/lib/n8n/claude-cache) if you want the cache to survive reboots.",
      },
      {
        displayName: 'Cache Responses',
        name: 'useCache',
        type: 'boolean',
        default: false,
        description:
          'Whether to cache responses on disk and return cached results for repeated prompts. Saves Pro/Max rate limit quota and latency. Cache key is the SHA-256 of (prompt, model, system prompt, response format, CLI binary) — changing any of those produces a new cache entry. Failures and JSON-parse-failed results are never cached.',
      },
      {
        displayName: 'Cache TTL (Seconds)',
        name: 'cacheTtlSeconds',
        type: 'number',
        typeOptions: { minValue: 0 },
        default: 0,
        description:
          'How long cached responses stay valid. 0 means no expiry (cache forever). Only meaningful when Cache Responses is on.',
      },
      {
        displayName: 'CLI Binary Name',
        name: 'cliBinaryName',
        type: 'string',
        default: 'claude',
        description:
          'Name of the Claude CLI binary to spawn. Resolved against PATH unless an absolute path is given. Override only if your binary is renamed or wrapped.',
      },
      {
        displayName: 'Resume Session ID',
        name: 'resumeSessionId',
        type: 'string',
        default: '',
        placeholder: 'e.g. {{ $json.sessionId }} from a previous Claude Code call',
        description:
          "Continue a previous Claude Code conversation instead of starting fresh: passes --resume with this ID to the CLI. Every call returns its sessionId on the output item — store it and feed it back here for multi-turn memory. The session lives on the machine running n8n, tied to the CLI's working directory and user. Caching is bypassed when resuming (stateful calls must never return stale turns).",
      },
      {
        displayName: 'Retries on Parse Failure',
        name: 'retries',
        type: 'number',
        typeOptions: { minValue: 0, maxValue: 5 },
        default: 0,
        // eslint-disable-next-line n8n-nodes-base/node-param-description-miscased-json
        description:
          'Only meaningful when Response Format is JSON. If parsing fails, retry the entire CLI call up to this many times. 0 means one attempt with no retries.',
      },
    ],
  },
];

const SAFE_BINARY_NAME = /^[A-Za-z0-9._/\\:-]+$/;
const SAFE_MODEL_NAME = /^[A-Za-z0-9._-]+$/;
const SAFE_SESSION_ID = /^[A-Za-z0-9-]{8,64}$/;

export interface RawInput {
  prompt: unknown;
  timeoutSeconds: unknown;
  cliBinaryName: unknown;
  model?: unknown;
  systemPrompt?: unknown;
  resumeSessionId?: unknown;
  itemIndex: number;
}

export class ValidationFailure extends Error {
  constructor(
    public parameter: string,
    public received: unknown,
    message: string,
  ) {
    super(message);
    this.name = 'ValidationFailure';
  }
}

export function validateAndNormalize(raw: RawInput): NodeInputItem {
  const prompt = coercePromptToString(raw.prompt);
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    throw new ValidationFailure('prompt', raw.prompt, 'prompt must be a non-empty string');
  }

  const timeoutSeconds = Number(raw.timeoutSeconds);
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 1800) {
    throw new ValidationFailure(
      'timeoutSeconds',
      raw.timeoutSeconds,
      'timeoutSeconds must be an integer in [1, 1800]',
    );
  }

  const cliBinaryName = typeof raw.cliBinaryName === 'string' ? raw.cliBinaryName : 'claude';
  if (!SAFE_BINARY_NAME.test(cliBinaryName)) {
    throw new ValidationFailure(
      'cliBinaryName',
      raw.cliBinaryName,
      'cliBinaryName contains disallowed characters',
    );
  }

  let model: string | undefined;
  if (typeof raw.model === 'string' && raw.model.trim().length > 0) {
    const trimmed = raw.model.trim();
    if (!SAFE_MODEL_NAME.test(trimmed)) {
      throw new ValidationFailure(
        'model',
        raw.model,
        'model contains disallowed characters',
      );
    }
    model = trimmed;
  }

  let systemPrompt: string | undefined;
  if (typeof raw.systemPrompt === 'string' && raw.systemPrompt.trim().length > 0) {
    systemPrompt = raw.systemPrompt;
  }

  let resumeSessionId: string | undefined;
  if (typeof raw.resumeSessionId === 'string' && raw.resumeSessionId.trim().length > 0) {
    const trimmed = raw.resumeSessionId.trim();
    if (!SAFE_SESSION_ID.test(trimmed)) {
      throw new ValidationFailure(
        'resumeSessionId',
        raw.resumeSessionId,
        'resumeSessionId contains disallowed characters (expected a CLI session ID)',
      );
    }
    resumeSessionId = trimmed;
  }

  return {
    prompt,
    timeoutSeconds,
    cliBinaryName,
    model,
    systemPrompt,
    resumeSessionId,
    itemIndex: raw.itemIndex,
  };
}

function coercePromptToString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }
  return null;
}
