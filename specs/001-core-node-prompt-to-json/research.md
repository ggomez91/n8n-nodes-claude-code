# Phase 0 Research: Core n8n Claude CLI Node

**Date**: 2026-04-22
**Plan**: [plan.md](./plan.md)

This document records the technical decisions made to resolve unknowns
surfaced in the plan's Technical Context, plus best-practice findings for
the dependencies and integrations involved.

---

## R1. Language and project layout

**Decision**: TypeScript 5.x, single npm package laid out per
`n8n-io/n8n-nodes-starter`.

**Rationale**:
- The n8n community-node ecosystem is overwhelmingly TypeScript; the
  official starter, the linter (`eslint-plugin-n8n-nodes-base`), and the
  workflow type definitions (`n8n-workflow`) are all TS-first.
- TypeScript surfaces parameter-shape mistakes at build time, supporting
  Constitution Principle II (JSON Contract First) without runtime cost.
- The starter layout is what n8n reviewers and verified-publisher tooling
  expect; deviating costs review cycles for no benefit.

**Alternatives considered**:
- *Plain JavaScript with JSDoc*: rejected — loses build-time contract
  enforcement, breaks tooling expectations, and imposes ongoing JSDoc
  discipline that the starter community doesn't share.
- *Custom monorepo with shared lib*: rejected as YAGNI per Principle V.
  One node, one package.

---

## R2. Subprocess invocation strategy

**Decision**: `child_process.spawn(binary, args[], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] })`.
Stream stdout and stderr into bounded buffers via `'data'` events.
Cancellation via `subprocess.kill('SIGTERM')` followed by a 5-second
`SIGKILL` escalation.

**Rationale**:
- `spawn` with an argv array and `shell: false` is the only stdlib
  invocation form that guarantees no shell interpretation of prompt
  content — direct compliance with Constitution Principle III and FR-003.
- `exec`/`execFile`/`spawn` with `shell: true` all introduce a shell that
  expands `$(…)`, backticks, etc.; rejected outright.
- Buffering stdout/stderr explicitly (rather than using `execFile`'s
  promisified buffering) gives us a single place to enforce a max-output
  byte ceiling and to start tearing down on timeout/cancel without losing
  data already received.
- `SIGTERM` first, `SIGKILL` after 5 s: matches FR-010 ("terminate within
  5 s of cancellation") while letting a well-behaved CLI exit cleanly.

**Alternatives considered**:
- *`execa` (third-party)*: ergonomic but adds a runtime dependency that
  Constitution Principle V requires us to justify. The functionality we
  need (argv-array spawn, timeout, cancellation, captured streams) is
  ~120 lines of `child_process` code we own and can test directly.
- *`child_process.fork`*: rejected — designed for spawning Node scripts
  with IPC; the CLI is an arbitrary binary.
- *`spawnSync`*: rejected — blocks the event loop; n8n executes node
  logic on the main loop in many deployment configurations.

---

## R3. Claude CLI output format

**Decision**: Invoke the CLI with `--output-format json` (or its
equivalent flag, resolved at install time by reading `claude --help`),
parse stdout as JSON, and pass the parsed object through as the n8n
output item's JSON field.

**Rationale**:
- The CLI's structured output is the source of truth for any field the
  workflow author wants to consume (response text, model, stop reason,
  usage). Re-wrapping it loses information and creates a second contract
  to maintain.
- Pass-through with `additionalProperties: true` in the schema means
  additive CLI changes don't require a node release (Principle II).
- Parsing in a dedicated `output.parser.ts` module gives one place to
  surface parse failures with categorized errors (Principle III).

**Alternatives considered**:
- *Wrap CLI text output in `{ "response": "..." }`*: rejected — opaque to
  authors who want metadata, forces a node release every time the CLI
  exposes a new useful field.
- *Parse twice (text response + structured envelope)*: rejected —
  double-source-of-truth, Principle V violation.

**Open follow-up**: confirm the actual flag name (`--output-format json`
vs `--json` vs `--format json`) at the start of `/speckit-implement` by
running `claude --help` against the installed CLI. If the flag differs,
update the runner contract; the schema does not change.

---

## R4. CLI binary discovery

**Decision**: Default to spawning by binary *name* (`claude`), letting
the OS resolve via `PATH`. Expose a hidden advanced parameter
`cliBinaryName` (default `"claude"`) so power users can override without
us shipping a credentials type yet. Absolute-path discovery and explicit
credential-driven config are deferred to a later feature (per spec
Assumptions — credentials/config out of scope).

**Rationale**:
- Matches the spec's explicit deferral of credentials/config to a later
  feature while still letting authors point at a renamed or wrapped
  binary if needed.
- `spawn` with a bare name uses the executing process's `PATH`, which
  for n8n is whatever the n8n service was started with. This is the
  least-surprise default for self-hosted users.

**Alternatives considered**:
- *Search `PATH` ourselves and resolve to an absolute path*: rejected —
  duplicates what the OS does, adds platform-specific code (`PATHEXT` on
  Windows, etc.), and gives us nothing back.
- *Require an absolute path parameter*: rejected — bad UX for the 90%
  case where `claude` is on `PATH`.

---

## R5. Timeout default and configurability

**Decision**: Expose `timeoutSeconds` as a node parameter. Default
`120`. Range validated `[1, 1800]`. On timeout, send `SIGTERM`, wait up
to 5 s, then `SIGKILL`, then surface a categorized `timeout` error.

**Rationale**:
- Spec FR-008 calls for "60–120 second range" default; 120 picks the
  more forgiving end, since real prompts (with thinking, tool use) can
  legitimately run > 60 s.
- 30-minute upper bound covers extended-thinking or large-prompt cases
  without letting a misconfigured workflow hang an n8n worker
  indefinitely.

**Alternatives considered**:
- *Hardcoded 60 s*: rejected — would break legitimate long-running
  prompts on first day, forcing an immediate parameter addition.
- *No timeout (CLI-side only)*: rejected — violates FR-008 explicitly.

---

## R6. Per-item processing model

**Decision**: Strictly sequential, one CLI invocation per input item, in
input order. Implemented with a plain `for` loop over
`this.getInputData()` inside `INodeType.execute()` — no `Promise.all`,
no queue, no parallelism.

**Rationale**:
- Matches spec FR-004 and the Assumption about per-item processing.
- Sequential order is the only way to satisfy SC-003 ("100% input/output
  order match") without per-item correlation tracking.
- Avoids overwhelming a single host with concurrent CLI invocations
  (each one likely also opens a network connection to Anthropic).
- Trivial to reason about for cancellation: at any moment exactly one
  subprocess is alive.

**Alternatives considered**:
- *Bounded concurrency with a small worker pool*: rejected as YAGNI
  (Principle V) and as scope creep — concurrency tuning is its own
  feature with its own tradeoffs.

---

## R7. Error categorization

**Decision**: Six categories, mapped in `error.mapper.ts`:

| Category | Trigger |
|----------|---------|
| `validation` | Empty/non-string prompt resolved from input item |
| `not-found` | Spawn fails with `ENOENT` (binary missing on PATH) |
| `exit-failure` | Subprocess exits with non-zero status |
| `parse-failure` | Stdout is not valid JSON or fails schema validation |
| `timeout` | Configured timeout elapsed before exit |
| `cancelled` | n8n execution cancelled while subprocess running |

Each category produces an n8n `NodeOperationError` with a payload conforming
to `contracts/error-payload.schema.json`.

**Rationale**:
- Six discrete categories cover every failure mode named in spec FR-002,
  FR-006, FR-007, FR-008, FR-010 and edge cases.
- A small fixed enum (rather than free-text error messages) makes it
  practical to write `error.mapper.test.ts` once and assert exhaustive
  coverage.
- `NodeOperationError` (from `n8n-workflow`) is the n8n-native way to
  surface item-level failures that respect "Continue on Fail".

**Alternatives considered**:
- *Flat string error messages*: rejected — defeats automated handling in
  downstream `IF` nodes and makes test assertions brittle.
- *Throw raw `Error`*: rejected — bypasses n8n's "Continue on Fail" and
  shows up as a generic execution error.

---

## R8. Test framework and integration-test isolation

**Decision**: Jest + `ts-jest`. Unit tests under `test/unit/` (no
subprocess, no filesystem). Integration tests under `test/integration/`
spawn small POSIX-shell stub binaries from `test/fixtures/`. CI matrix
runs on Linux only for v1 (Windows shell stubs would need separate
`.cmd` versions; deferred per Target Platform decision).

**Rationale**:
- Jest is the n8n community-node convention; using anything else loses
  community recipes (mocks, snapshot, custom matchers).
- Real shell-script stubs exercise real `child_process` semantics
  (signals, exit codes, stream timing) — what Constitution Principle IV
  demands ("no mocks for the CLI subprocess in integration tests").
- Stubs are tiny (5–15 lines each), checked into the repo, and
  deterministic — superior to recording fixtures from a real Claude CLI
  invocation that drifts over time.

**Alternatives considered**:
- *Vitest*: faster but breaks community alignment and adds a
  configuration burden for ESM/CJS interop with `n8n-workflow`.
- *Mocking `child_process.spawn` with `jest.mock`*: rejected — exactly
  the anti-pattern the constitution prohibits in integration tests; the
  whole point is to catch interactions the mock would paper over.

---

## R9. Linting and packaging

**Decision**: ESLint with `eslint-plugin-n8n-nodes-base` (the official
n8n linter for community nodes). Prettier for formatting. `npm` as the
package manager (no `pnpm`/`yarn`-specific lockfiles in the repo).
Build via `tsc` for `.ts`→`.js` and a `gulp` task to copy the SVG icon
into `dist/` (the n8n starter's convention).

**Rationale**:
- `eslint-plugin-n8n-nodes-base` enforces the conventions n8n's
  verified-publisher review requires (filename casing, `displayName`
  formatting, parameter description punctuation, etc.). Skipping it
  guarantees rework before listing.
- `npm` lockfile is what the n8n verification pipeline reads; using a
  different package manager forces converters in CI for no benefit.
- Gulp icon-copy is a single 8-line task — keeping the convention costs
  nothing and means contributors recognize the build immediately.

**Alternatives considered**:
- *No linter*: rejected — each parameter description typo would cost a
  publish-review iteration.
- *esbuild/swc instead of tsc*: rejected — `tsc` produces declaration
  files n8n inspects; swapping the build adds work for no shipped
  benefit.

---

## R10. Windows support deferral

**Decision**: v1 ships and CI-tests on Linux + macOS only. The
package.json `os` field MAY constrain installs accordingly. Windows
support is a follow-up feature.

**Rationale**:
- Stub binaries are shell scripts (POSIX). Cross-platform stubs require
  parallel `.cmd`/`.ps1` versions and CI matrix expansion.
- Process semantics differ: `SIGTERM` is not POSIX-meaningful on
  Windows, so the cancellation logic needs alternate paths.
- Most self-hosted n8n deployments run on Linux containers; Windows is
  not the primary target.

**Alternatives considered**:
- *Best-effort Windows support without CI*: rejected — silently broken
  features are worse than explicitly-deferred ones.

---

## Summary

| ID | Topic | Decision (one-liner) |
|----|-------|----------------------|
| R1 | Language | TypeScript 5.x, n8n starter layout |
| R2 | Subprocess | `spawn` with argv array, `shell: false`, SIGTERM→SIGKILL cancellation |
| R3 | CLI output | `--output-format json`, pass-through to node output |
| R4 | Binary discovery | `PATH` lookup of `claude`, hidden override param |
| R5 | Timeout | Default 120 s, range [1, 1800] |
| R6 | Concurrency | Strictly sequential per input item |
| R7 | Error model | Six fixed categories via `NodeOperationError` |
| R8 | Tests | Jest + real shell-script stubs (no subprocess mocking) |
| R9 | Lint/build | ESLint n8n plugin, Prettier, npm, tsc + gulp |
| R10 | Platform | Linux + macOS only in v1; Windows deferred |

All "NEEDS CLARIFICATION" items resolved. Ready for Phase 1.
