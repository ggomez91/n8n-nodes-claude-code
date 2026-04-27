import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { BinaryAttachment } from './types';

export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024; // 50 MiB per file
export const MAX_ATTACHMENT_COUNT = 16;

const SAFE_FILENAME_CHARS = /[^A-Za-z0-9._-]+/g;

// Common MIME → extension mappings. Kept short and curated for the file types
// Claude Code's Read tool actually does something useful with (vision for
// images, text for documents). PDFs are also Read-able.
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/html': 'html',
  'text/csv': 'csv',
  'application/json': 'json',
  'application/xml': 'xml',
  'text/xml': 'xml',
};

/** Best-effort extension for a MIME type. Empty string if unknown. */
export function extensionForMime(mimeType: string | undefined): string {
  if (!mimeType) return '';
  return MIME_TO_EXT[mimeType.toLowerCase().split(';')[0].trim()] ?? '';
}

function hasExtension(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1;
}

/**
 * Build the most-helpful filename for a staged attachment, in priority order:
 *   1. The user-supplied fileName, if it already has an extension.
 *   2. The user-supplied fileName + extension derived from MIME, if available.
 *   3. The n8n fileExtension hint applied to the property name.
 *   4. The MIME-derived extension applied to the property name.
 *   5. Fallback `<propName>.bin`.
 *
 * The result is run through sanitizeFileName before staging.
 */
export function pickFileName(
  meta: { fileName?: string; fileExtension?: string; mimeType?: string },
  propName: string,
): string {
  const ext =
    (meta.fileExtension && meta.fileExtension.replace(/^\./, '')) ||
    extensionForMime(meta.mimeType);

  if (meta.fileName) {
    if (hasExtension(meta.fileName)) return meta.fileName;
    if (ext) return `${meta.fileName}.${ext}`;
    return meta.fileName;
  }
  if (ext) return `${propName}.${ext}`;
  return `${propName}.bin`;
}

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
