import { existsSync, readFileSync, readdirSync } from 'node:fs';

import {
  attachmentsDigest,
  extensionForMime,
  parseBinaryPropertyNames,
  pickFileName,
  sanitizeFileName,
  stageAttachments,
} from '../../nodes/Claude/lib/attachments';

describe('parseBinaryPropertyNames', () => {
  it('handles comma-separated', () => {
    expect(parseBinaryPropertyNames('a, b,c')).toEqual(['a', 'b', 'c']);
  });

  it('handles space-separated', () => {
    expect(parseBinaryPropertyNames('a b c')).toEqual(['a', 'b', 'c']);
  });

  it('handles mixed separators and trims', () => {
    expect(parseBinaryPropertyNames(' a,, b   c , ')).toEqual(['a', 'b', 'c']);
  });

  it('returns empty for empty input', () => {
    expect(parseBinaryPropertyNames('')).toEqual([]);
    expect(parseBinaryPropertyNames('   ')).toEqual([]);
  });
});

describe('sanitizeFileName', () => {
  it('keeps safe names', () => {
    expect(sanitizeFileName('photo.png', 'fallback')).toBe('photo.png');
    expect(sanitizeFileName('My_doc-v2.pdf', 'fallback')).toBe('My_doc-v2.pdf');
  });

  it('replaces unsafe chars with underscores', () => {
    expect(sanitizeFileName('hello world!.png', 'fallback')).toBe('hello_world_.png');
    expect(sanitizeFileName('a;rm -rf /', 'fallback')).toBe('a_rm_-rf');
  });

  it('strips path components', () => {
    expect(sanitizeFileName('../../etc/passwd', 'fallback')).toBe('.._.._etc_passwd');
    // Leading underscore from the leading '/' is trimmed by the sanitizer.
    expect(sanitizeFileName('/abs/path/file.txt', 'fallback')).toBe('abs_path_file.txt');
  });

  it('falls back when name is empty/undefined', () => {
    expect(sanitizeFileName(undefined, 'fb.bin')).toBe('fb.bin');
    expect(sanitizeFileName('', 'fb.bin')).toBe('fb.bin');
  });

  it('falls back when sanitization leaves nothing usable', () => {
    expect(sanitizeFileName('!!!', 'fb.bin')).toBe('fb.bin');
  });
});

describe('attachmentsDigest', () => {
  it('returns empty string for no attachments', () => {
    expect(attachmentsDigest([])).toBe('');
  });

  it('returns a 64-char hex hash for any non-empty input', () => {
    const d = attachmentsDigest([
      { fileName: 'a.png', buffer: Buffer.from('content-a') },
    ]);
    expect(d).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when buffer content changes', () => {
    const a = attachmentsDigest([{ fileName: 'x.png', buffer: Buffer.from('one') }]);
    const b = attachmentsDigest([{ fileName: 'x.png', buffer: Buffer.from('two') }]);
    expect(a).not.toBe(b);
  });

  it('changes when filename changes (even with same content)', () => {
    const a = attachmentsDigest([{ fileName: 'a.png', buffer: Buffer.from('same') }]);
    const b = attachmentsDigest([{ fileName: 'b.png', buffer: Buffer.from('same') }]);
    expect(a).not.toBe(b);
  });

  it('order-sensitive', () => {
    const x = { fileName: 'x.png', buffer: Buffer.from('x') };
    const y = { fileName: 'y.png', buffer: Buffer.from('y') };
    expect(attachmentsDigest([x, y])).not.toBe(attachmentsDigest([y, x]));
  });
});

describe('extensionForMime', () => {
  it('maps common image MIME types', () => {
    expect(extensionForMime('image/jpeg')).toBe('jpg');
    expect(extensionForMime('image/png')).toBe('png');
    expect(extensionForMime('image/webp')).toBe('webp');
  });

  it('handles MIME parameters and casing', () => {
    expect(extensionForMime('IMAGE/JPEG')).toBe('jpg');
    expect(extensionForMime('image/jpeg; charset=utf-8')).toBe('jpg');
    expect(extensionForMime('  image/png ; foo=bar')).toBe('png');
  });

  it('returns empty for unknown MIME or undefined', () => {
    expect(extensionForMime(undefined)).toBe('');
    expect(extensionForMime('application/octet-stream')).toBe('');
    expect(extensionForMime('not-a-mime')).toBe('');
  });
});

describe('pickFileName', () => {
  it('keeps a fileName that already has an extension', () => {
    expect(pickFileName({ fileName: 'photo.jpg', mimeType: 'image/jpeg' }, 'data')).toBe('photo.jpg');
  });

  it('appends an extension derived from MIME when fileName has none', () => {
    expect(pickFileName({ fileName: 'photo', mimeType: 'image/jpeg' }, 'data')).toBe('photo.jpg');
  });

  it('uses fileExtension hint over MIME', () => {
    expect(
      pickFileName({ fileName: 'photo', fileExtension: 'png', mimeType: 'image/jpeg' }, 'data'),
    ).toBe('photo.png');
  });

  it('strips leading dot from fileExtension', () => {
    expect(pickFileName({ fileName: 'photo', fileExtension: '.png' }, 'data')).toBe('photo.png');
  });

  it('falls back to <propName>.<ext> when fileName is missing', () => {
    expect(pickFileName({ mimeType: 'image/png' }, 'screenshot')).toBe('screenshot.png');
  });

  it('falls back to <propName>.bin when nothing is known', () => {
    expect(pickFileName({}, 'mystery')).toBe('mystery.bin');
  });

  it('preserves fileName when it has an ext but MIME suggests a different one', () => {
    // Trust the user-supplied filename; it might be intentionally different.
    expect(pickFileName({ fileName: 'thing.jpg', mimeType: 'image/png' }, 'data')).toBe('thing.jpg');
  });
});

describe('stageAttachments', () => {
  it('writes each buffer into a unique temp dir, returns sanitized filenames', () => {
    const staged = stageAttachments([
      { fileName: 'photo.png', buffer: Buffer.from([1, 2, 3]) },
      { fileName: 'doc.pdf', buffer: Buffer.from('hello') },
    ]);
    try {
      expect(existsSync(staged.dir)).toBe(true);
      expect(staged.fileNames).toEqual(['photo.png', 'doc.pdf']);
      expect(readdirSync(staged.dir).sort()).toEqual(['doc.pdf', 'photo.png']);
      expect(readFileSync(`${staged.dir}/photo.png`).equals(Buffer.from([1, 2, 3]))).toBe(true);
    } finally {
      staged.cleanup();
    }
    expect(existsSync(staged.dir)).toBe(false);
  });

  it('uniquifies duplicate filenames', () => {
    const staged = stageAttachments([
      { fileName: 'doc.pdf', buffer: Buffer.from('a') },
      { fileName: 'doc.pdf', buffer: Buffer.from('b') },
      { fileName: 'doc.pdf', buffer: Buffer.from('c') },
    ]);
    try {
      expect(staged.fileNames).toEqual(['doc.pdf', 'doc-2.pdf', 'doc-3.pdf']);
    } finally {
      staged.cleanup();
    }
  });

  it('cleanup is idempotent', () => {
    const staged = stageAttachments([{ fileName: 'a.bin', buffer: Buffer.from('x') }]);
    staged.cleanup();
    expect(() => staged.cleanup()).not.toThrow();
  });

  it('falls back to attachment-N.bin when filename is missing', () => {
    const staged = stageAttachments([
      { fileName: '', buffer: Buffer.from('x') },
      { fileName: undefined as unknown as string, buffer: Buffer.from('y') },
    ]);
    try {
      expect(staged.fileNames).toEqual(['attachment-0.bin', 'attachment-1.bin']);
    } finally {
      staged.cleanup();
    }
  });
});
