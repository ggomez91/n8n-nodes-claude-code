import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { BinaryAttachment } from './types';

export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024; // 50 MiB per file
export const MAX_ATTACHMENT_COUNT = 16;

const SAFE_FILENAME_CHARS = /[^A-Za-z0-9._-]+/g;

/** Parse the Binary Properties parameter (comma/space separated) into a clean list. */
export function parseBinaryPropertyNames(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Make an OS filename safe (no path components, no shell-special chars). */
export function sanitizeFileName(name: string | undefined, fallback: string): string {
  if (!name) return fallback;
  const justBase = name.replace(/[\\/]/g, '_');
  const cleaned = justBase.replace(SAFE_FILENAME_CHARS, '_').replace(/^_+|_+$/g, '');
  return cleaned.length > 0 ? cleaned : fallback;
}

export interface StagedAttachments {
  /** Absolute path to the per-invocation temp directory. Pass to --add-dir. */
  dir: string;
  /** Sanitized filenames written into `dir`, in attach order. */
  fileNames: string[];
  /** Synchronously remove the temp dir + contents. Idempotent. */
  cleanup: () => void;
}

/** Write attachments to a unique temp dir. Caller must call cleanup() when done. */
export function stageAttachments(attachments: BinaryAttachment[]): StagedAttachments {
  const dir = join(tmpdir(), `n8n-nodes-claude-code-${randomBytes(8).toString('hex')}`);
  mkdirSync(dir, { recursive: true });

  const fileNames: string[] = [];
  const usedNames = new Set<string>();

  try {
    for (let i = 0; i < attachments.length; i++) {
      const a = attachments[i];
      const base = sanitizeFileName(a.fileName, `attachment-${i}.bin`);
      const unique = uniquifyName(base, usedNames);
      usedNames.add(unique);
      writeFileSync(join(dir, unique), a.buffer);
      fileNames.push(unique);
    }
  } catch (err) {
    // Roll back the temp dir if any write fails — never leave half-staged state.
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }

  let cleaned = false;
  return {
    dir,
    fileNames,
    cleanup: () => {
      if (cleaned) return;
      cleaned = true;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** SHA-256 over each attachment's buffer, joined into one digest for cache keying. */
export function attachmentsDigest(attachments: BinaryAttachment[]): string {
  if (attachments.length === 0) return '';
  const hash = createHash('sha256');
  for (const a of attachments) {
    hash.update(sanitizeFileName(a.fileName, 'attachment'));
    hash.update('\0');
    hash.update(a.buffer);
    hash.update('\0');
  }
  return hash.digest('hex');
}

function uniquifyName(name: string, used: Set<string>): string {
  if (!used.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 2; n < 1_000_000; n++) {
    const candidate = `${stem}-${n}${ext}`;
    if (!used.has(candidate)) return candidate;
  }
  // 1M files of the same base name is a pathological case; fall through with random suffix.
  return `${stem}-${randomBytes(4).toString('hex')}${ext}`;
}
