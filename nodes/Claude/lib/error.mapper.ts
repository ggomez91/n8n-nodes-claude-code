import type { INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import type { ErrorCategory, ErrorDetails, ErrorPayload, ErrorPayloadMeta } from './types';

const CATEGORY_MESSAGES: Record<ErrorCategory, string> = {
  validation: 'Input validation failed',
  'not-found': 'Claude CLI binary not found',
  'exit-failure': 'Claude CLI exited with a non-zero status',
  'parse-failure': 'Failed to parse Claude CLI output',
  timeout: 'Claude CLI invocation timed out',
  cancelled: 'Claude CLI invocation was cancelled',
};

export function mapToError(
  category: ErrorCategory,
  details: ErrorDetails,
  meta: ErrorPayloadMeta,
): ErrorPayload {
  return {
    success: false,
    category,
    message: CATEGORY_MESSAGES[category],
    details,
    meta,
  };
}

export function toNodeOperationError(node: INode, payload: ErrorPayload): NodeOperationError {
  return new NodeOperationError(node, payload.message, {
    description: formatDescription(payload),
    itemIndex: payload.meta.itemIndex,
  });
}

function formatDescription(p: ErrorPayload): string {
  const parts = [`category: ${p.category}`];
  for (const [k, v] of Object.entries(p.details)) {
    if (v === undefined || v === null) continue;
    parts.push(`${k}: ${typeof v === 'string' ? truncate(v, 400) : JSON.stringify(v)}`);
  }
  if (p.meta.elapsedMs !== undefined) parts.push(`elapsedMs: ${p.meta.elapsedMs}`);
  return parts.join(' | ');
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
