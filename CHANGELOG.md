# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.7.3] — 2026-05-03

### Fixed

- **JSON Mode parser** now extracts JSON wrapped in prose. Previously
  `stripFences` required the entire response to be a single fenced
  block; outputs like `` ```json\n{...}\n```\n\nNote: ... `` (Claude
  often appends a trailing note when something partially failed) fell
  through and broke `JSON.parse`. The fence regex is no longer anchored
  to start/end of the string.
- Added an unfenced-prose fallback (`sliceJsonSpan`): if fence-stripped
  parse fails, slice from the first `{`/`[` to the last matching
  `}`/`]` and retry. No brace counting — if the slice is invalid JSON,
  the original parse error is returned (loud failure, not silent
  corruption).

## [0.7.2] — 2026-04-26

### Changed

- **npm scope renamed** from `@ggomez91` to `@ggomez91npm` to match the
  npm username actually registered. The unscoped package is unchanged
  in behavior; only the install name differs:
    Old: `@ggomez91/n8n-nodes-claude-code`
    New: `@ggomez91npm/n8n-nodes-claude-code`
- GitHub repo (`ggomez91/n8n-nodes-claude-code`) is unchanged.

### Migration (for cortex / any host on 0.7.0–0.7.1)

```sh
cd /.n8n/nodes
npm uninstall @ggomez91/n8n-nodes-claude-code
npm install --omit=peer --omit=optional --omit=dev <new tarball or npm name>
sqlite3 /.n8n/database.sqlite "
  UPDATE installed_packages SET packageName='@ggomez91npm/n8n-nodes-claude-code' WHERE packageName='@ggomez91/n8n-nodes-claude-code';
  UPDATE installed_nodes SET package='@ggomez91npm/n8n-nodes-claude-code', type='@ggomez91npm/n8n-nodes-claude-code.claude' WHERE package='@ggomez91/n8n-nodes-claude-code';
  UPDATE workflow_entity SET nodes = REPLACE(nodes, '@ggomez91/n8n-nodes-claude-code.claude', '@ggomez91npm/n8n-nodes-claude-code.claude') WHERE nodes LIKE '%@ggomez91/n8n-nodes-claude-code.claude%';
"
systemctl restart n8n
```

`task deploy:cortex` does the npm + DB part automatically; the
workflow_entity rewrite is a one-shot if you have existing workflows
referencing the old type string.

## [0.7.1] — 2026-04-26

### Fixed

- **Vision/PDF detection**: when n8n's binary metadata didn't include a
  `fileName`, the staged file got `attachment-N.bin` and Claude Code's
  Read tool fell back to raw-binary handling instead of vision. Now we
  derive a proper extension from `mimeType` (e.g. `image/jpeg` → `.jpg`)
  or n8n's `fileExtension` hint when the supplied filename has none.
  Symptom previously reported: Claude responded "the file was returned
  as raw binary data without a recognized image extension".

## [0.7.0] — 2026-04-26

### Added

- **`Binary Properties` parameter** (top-level, optional). Comma- or
  space-separated list of n8n binary property names to attach as files
  for this invocation. Each binary buffer is staged into a unique
  per-invocation temp directory; the directory path is passed to the
  CLI via `--add-dir` so Claude Code's Read tool can access the files
  (including images for vision). The temp directory is cleaned up after
  the call (success, failure, or cancellation).
- Auto-prepended hint to the system prompt when attachments are present:
  Claude is told the directory and filenames so it knows what's
  available without the user listing them by hand.
- Cache key now includes a SHA-256 digest of the attachments. Different
  binary content produces different cache entries; identical content
  hits the cache.

### Limits

- Max 16 attachments per invocation, 50 MiB per file.
- Filenames are sanitized (path components stripped, shell-special chars
  replaced with `_`); duplicates get `-2`, `-3`, … suffixes.

### Use case

Drop a "Read Binary File" or HTTP-Request node before the Claude node
to fetch an image, set Binary Properties to `data`, and prompt Claude
to describe / extract / summarize it. Useful for vision workflows
(yesterday's newsletter screenshot → today's draft, chart → analysis,
etc.).

## [0.6.0] — 2026-04-26

### Changed

- **Renamed package** from `@ggomez91/n8n-nodes-claude` to
  `@ggomez91/n8n-nodes-claude-code`. The new name makes it explicit that
  this node wraps **Claude Code** (the local CLI) rather than the
  Anthropic SDK. Differentiates clearly from the existing unscoped
  `n8n-nodes-claude` package on npm (which is SDK-based).
- GitHub repository renamed accordingly:
  https://github.com/ggomez91/n8n-nodes-claude-code

### Migration

If you were running `@ggomez91/n8n-nodes-claude` (any 0.4.x or 0.5.0):

1. Uninstall the old name from your n8n install.
2. Install `@ggomez91/n8n-nodes-claude-code`.
3. Existing workflows referencing the old node type
   (`@ggomez91/n8n-nodes-claude.claude`) will show "Unrecognized node
   type" until updated. Either delete-and-re-add the Claude node, or run
   a one-shot SQL update to rewrite the type string.

## [0.5.0] — 2026-04-26

### Added

- **`System Prompt` parameter** (top-level, optional, multi-line). Supports
  n8n expressions. When set, the node passes
  `--append-system-prompt <value>` to the CLI — appending to Claude Code's
  default system prompt rather than replacing it. Useful for persona,
  output-format constraints, and consistent context across calls.
- Cache key now includes `systemPrompt`. Different system prompts produce
  different cache entries (no false hits when changing persona).

## [0.4.0] — 2026-04-26

### Added

- **Cache feature**: opt-in response caching, keyed by prompt + model +
  response format + CLI binary. Filesystem-backed, TTL-configurable. When
  enabled, repeated prompts skip the CLI entirely — saves Pro/Max rate
  limit quota and latency. Cache hits add `meta.cacheHit: true` and
  `meta.cachedAt` to the output. Failures and `json.ok: false` results
  are not cached.
- `LICENSE` file (MIT).
- This `CHANGELOG.md`.

### Changed

- Package renamed from `n8n-nodes-claude` to `@ggomez91/n8n-nodes-claude`
  (the unscoped name was already taken on npm by an unrelated package).
- `package.json` description rewritten to lead with the subscription-based
  positioning. Keywords expanded.

## [0.3.0] — 2026-04-26

### Added

- **`Model` parameter** (top-level, optional). Empty default uses the
  CLI's default model. Accepts aliases (`opus`, `sonnet`, `haiku`) or
  full IDs (e.g. `claude-sonnet-4-6`). Threaded into the CLI argv as
  `--model <value>`.
- JSON mode is now **fail-soft**: parse failures no longer fail the
  node. Output items in JSON mode always succeed and carry a new `json`
  field: `{ ok: true, value, attempts }` on success or
  `{ ok: false, error, attempts }` on failure. The original Claude
  response is always preserved in `response`.

### Removed (breaking from 0.2.0)

- `parsed` field on output items (use `$json.json.value` instead).
- `response-parse-failure` error category (JSON parse failures no
  longer fail the node).

## [0.2.0] — 2026-04-26

### Added

- **`Response Format` parameter**: `raw` (default) or `json`.
- In JSON mode, the node strips fenced code blocks (` ```json…``` ` or
  bare ` ```…``` `) and parses the response.
- **`Retries on Parse Failure`** option (in Options collection):
  configurable retries, default 0.

### Fixed

- `getNodeParameter('cliBinaryName', …)` was called for an undeclared
  top-level parameter, causing "Could not get parameter" errors at
  execute time. The lookup now uses the Options collection correctly.
- Test mock made strict to match real n8n's `getNodeParameter` behavior
  (throws on undeclared params).

## [0.1.0] — 2026-04-23

### Added

- Initial release.
- `Claude` node: takes a prompt, invokes the local Claude CLI via
  `child_process.spawn` (argv array, no shell), returns Claude's
  response as structured JSON.
- Configurable timeout (1–1800 s, default 120) with SIGTERM → 5 s →
  SIGKILL escalation.
- Subprocess cancellation on n8n workflow Stop.
- Per-item processing with order preservation, expression coercion,
  and `Continue on Fail` support.
- Six categorized error types with rich diagnostic payloads:
  `validation`, `not-found`, `exit-failure`, `parse-failure`,
  `timeout`, `cancelled`.
- 60+ tests (unit + integration) against shell-script CLI stubs (no
  subprocess mocking).
