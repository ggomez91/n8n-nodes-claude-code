# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
