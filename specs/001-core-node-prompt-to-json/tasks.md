---

description: "Task list for feature 001 — Core n8n Claude CLI Node"
---

# Tasks: Core n8n Claude CLI Node — Prompt In, JSON Out

**Input**: Design documents from `/specs/001-core-node-prompt-to-json/`
**Prerequisites**: plan.md (✓), spec.md (✓), research.md (✓), data-model.md (✓), contracts/ (✓), quickstart.md (✓)

**Tests**: Test tasks are included because Constitution Principle IV
(Risk-Based Testing) mandates automated tests for the critical surfaces
of this node — CLI invocation, JSON parsing, and error propagation.
Tests for those surfaces are not optional.

**Organization**: Tasks are grouped by user story (US1, US2, US3) so
each story can be implemented and validated independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- File paths are relative to repo root.

## Path Conventions

Single npm package, n8n community-node layout (per plan.md):

- Node code: `nodes/Claude/`
- Internal modules: `nodes/Claude/lib/`
- Tests: `test/unit/`, `test/integration/`, `test/fixtures/`
- Project root: `package.json`, `tsconfig.json`, etc.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization, build/lint/test toolchain, no domain logic yet.

- [X] T001 Create directory structure at repo root: `nodes/Claude/lib/`, `test/unit/`, `test/integration/`, `test/fixtures/`
- [X] T002 Create `package.json` with: name `claudenode`, version `0.1.0`, engines.node `>=20.15`, peerDependencies `n8n-workflow` and `n8n-core`, devDependencies (typescript ^5, jest ^29, ts-jest, @types/node, @types/jest, eslint, eslint-plugin-n8n-nodes-base, prettier, gulp), scripts (`build`, `lint`, `format`, `test`, `test:unit`, `test:integration`), and the `n8n` manifest field declaring `dist/nodes/Claude/Claude.node.js`
- [X] T003 [P] Create `tsconfig.json` targeting ES2022, strict mode on, `outDir: "dist"`, `rootDir: "."`, `include: ["nodes/**/*", "test/**/*"]`
- [X] T004 [P] Create `jest.config.ts` using `ts-jest`, `testMatch: ["**/test/**/*.test.ts"]`, separate projects for `unit` and `integration` (so `test:unit` and `test:integration` scripts can target them)
- [X] T005 [P] Create `.eslintrc.js` extending the recommended config from `eslint-plugin-n8n-nodes-base/configs/nodes`
- [X] T006 [P] Create `.prettierrc.js` (single quotes, semicolons, trailing commas — matches n8n convention)
- [X] T007 [P] Create `gulpfile.js` with a `build:icons` task that copies `nodes/Claude/*.svg` into `dist/nodes/Claude/`
- [X] T008 [P] Create `.gitignore` with `node_modules/`, `dist/`, `coverage/`, `*.log`, `.env*`, `.DS_Store`
- [X] T009 Run `npm install` to populate `node_modules/` and produce a `package-lock.json`

**Checkpoint**: `npm run build` succeeds (no source files yet, but tsc and gulp run cleanly), `npm run lint` succeeds, `npm test` exits zero (no tests yet).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Cross-story types, node metadata, and the icon — everything every user story needs before its implementation tasks can begin.

**⚠️ CRITICAL**: No user story work may begin until this phase is complete.

- [X] T010 Create shared TypeScript types in `nodes/Claude/lib/types.ts` derived from `specs/001-core-node-prompt-to-json/contracts/`: `NodeInputItem`, `SubprocessResult`, `NodeOutputItem`, `ErrorPayload`, and the `ErrorCategory` enum (`'validation' | 'not-found' | 'exit-failure' | 'parse-failure' | 'timeout' | 'cancelled'`)
- [X] T011 [P] Create `nodes/Claude/claude.svg` — a minimal Anthropic-orange placeholder icon (24×24, single-color, ≤2 KB)
- [X] T012 [P] Create `nodes/Claude/Claude.node.json` with `node`, `nodeVersion: "0.1.0"`, `codexVersion: "1.0"`, `categories: ["AI"]`, and a brief description

**Checkpoint**: Types compile against the JSON Schemas in `contracts/` (manual cross-check). Node metadata file is valid JSON.

---

## Phase 3: User Story 1 — Static prompt → JSON response (Priority: P1) 🎯 MVP

**Goal**: A workflow author drops the node into a workflow, sets a static prompt, executes, and gets one structured-JSON output item containing Claude's response.

**Independent Test**: Run `quickstart.md` Scenario 1 against an n8n install with the built node loaded. Output item must contain `success: true`, non-empty `response`, `raw`, and `meta.elapsedMs`. Validation/not-found/exit-failure/parse-failure error scenarios (Scenarios 3 and 4, plus the `exit-failure` and `parse-failure` portions of Scenario 7) must surface as categorized errors.

### Tests for User Story 1 (Constitution Principle IV — required)

> Write these tests FIRST, ensure they FAIL before implementation in this phase.

- [X] T013 [P] [US1] Unit test for parameter validation in `test/unit/parameters.test.ts` — covers: non-string prompt rejected, empty/whitespace prompt rejected, `timeoutSeconds` out of `[1, 1800]` rejected, `cliBinaryName` failing the safe pattern rejected, valid input passes through unchanged
- [X] T014 [P] [US1] Unit test for output parsing in `test/unit/output.parser.test.ts` — covers: valid CLI JSON → correctly mapped `NodeOutputItem` (response, model, stopReason, usage, raw, meta); CLI JSON with extra fields preserved in `raw`; CLI JSON missing optional fields produces output without them
- [X] T015 [P] [US1] Unit test for error mapper categories validation/not-found/exit-failure/parse-failure in `test/unit/error.mapper.test.ts` — each category produces an `ErrorPayload` matching `contracts/error-payload.schema.json`
- [X] T016 [P] [US1] Create stub binaries `test/fixtures/claude-stub-success.sh` (exit 0, valid JSON on stdout including `response`, `model`, `stop_reason`, `usage`), `test/fixtures/claude-stub-malformed.sh` (exit 0, non-JSON garbage on stdout), `test/fixtures/claude-stub-fail.sh` (exit 2, error message on stderr) — all marked executable
- [X] T017 [US1] Integration test for subprocess runner happy path in `test/integration/subprocess.runner.test.ts` — spawns `claude-stub-success.sh` via the runner, asserts `terminationReason === 'exited'`, `exitCode === 0`, stdout contains the expected JSON
- [X] T018 [US1] Integration test for end-to-end node execution in `test/integration/node.execute.test.ts` — instantiates the node, calls `execute()` with a mocked `IExecuteFunctions` whose `getInputData` returns one item and whose parameter getters return `{ prompt: "test", timeoutSeconds: 10, cliBinaryName: "claude-stub-success.sh" }` (with the fixtures dir prepended to `PATH`); asserts exactly one output item conforming to `node-output.schema.json`

### Implementation for User Story 1

- [X] T019 [P] [US1] Implement parameter declarations and validation in `nodes/Claude/lib/parameters.ts` — exports the `INodeProperties[]` array (prompt as string with expression support, timeoutSeconds as number with default 120, cliBinaryName as hidden advanced string with default "claude") and a `validateAndNormalize(rawParams): NodeInputItem` function
- [X] T020 [P] [US1] Implement output parser in `nodes/Claude/lib/output.parser.ts` — exports `parseCliOutput(stdout: Buffer, elapsedMs: number): NodeOutputItem`; uses `JSON.parse` inside a try/catch and throws a typed `ParseFailure` error on failure that the error mapper recognizes
- [X] T021 [P] [US1] Implement error mapper for the four US1 categories in `nodes/Claude/lib/error.mapper.ts` — exports `mapToError(category, details, meta): ErrorPayload` and a helper `toNodeOperationError(payload): NodeOperationError` for surfacing through n8n
- [X] T022 [US1] Implement happy-path subprocess runner in `nodes/Claude/lib/subprocess.runner.ts` — exports `async function runCli(input: NodeInputItem): Promise<SubprocessResult>`; uses `spawn(input.cliBinaryName, [...args], { shell: false })`, accumulates stdout/stderr in bounded buffers (10 MiB each), resolves with the `SubprocessResult` on `'exit'`. Timeout and cancellation WERE implemented in this task (not stubbed) to avoid a second rewrite in US3
- [X] T023 [US1] Implement the `Claude.node.ts` class in `nodes/Claude/Claude.node.ts` — declares `INodeTypeDescription` (using parameters from T019), implements `execute(this: IExecuteFunctions)`: iterates `getInputData()` once, calls `validateAndNormalize`, `runCli`, `parseCliOutput`, returns `[outputItems]`. Continue-on-fail and expression coercion from US2 were also implemented here (cheaper than a separate refactor)
- [X] T024 [US1] Wire end-to-end error handling for the four US1 categories in `Claude.node.ts` — `validateAndNormalize` failures → `validation`; `spawn` `ENOENT` → `not-found`; non-zero exit → `exit-failure`; parser exception → `parse-failure`. Each surfaces via `toNodeOperationError`

**Checkpoint**: All US1 tests pass. Quickstart Scenarios 1, 3, 4, and the `exit-failure`/`parse-failure` portions of Scenario 7 pass against an n8n instance with the built node loaded. The MVP is shippable.

---

## Phase 4: User Story 2 — Per-item processing with expressions (Priority: P2)

**Goal**: When the workflow feeds N input items into the node, the node emits N output items in input order; expression-resolved non-string prompts are coerced; "Continue on Fail" is respected.

**Independent Test**: Run `quickstart.md` Scenarios 2 and 6. Scenario 2 must yield three output items in input order with correct per-item answers. Scenario 6 must yield three items, with item 2 failing with `validation` while items 1 and 3 succeed.

### Tests for User Story 2

- [X] T025 [P] [US2] Unit test for expression coercion in `test/unit/parameters.test.ts` (extend, don't replace) — covers: number prompt coerced to string via `String(value)`; object prompt coerced; null/undefined prompt rejected as validation error
- [X] T026 [US2] Integration test for multi-item ordering in `test/integration/node.execute.test.ts` (extend, don't replace) — calls `execute()` with three input items; asserts exactly three output items in the same order, each containing the corresponding response from `claude-stub-success.sh` (modified to echo the prompt back so order is verifiable)
- [X] T027 [US2] Integration test for continue-on-fail behavior in `test/integration/node.execute.test.ts` (extend) — three input items with the second having an empty prompt, `continueOnFail` returning true; asserts three output items where item 2 has `success: false`, `category: "validation"`, and items 1 and 3 succeed

### Implementation for User Story 2

- [X] T028 [US2] Add string coercion to `validateAndNormalize` in `nodes/Claude/lib/parameters.ts` — non-string-but-defined values are coerced via `String(value)` before the non-empty check; null/undefined still rejected as validation errors
- [X] T029 [US2] Refactor the execute loop in `nodes/Claude/Claude.node.ts` to honor `getNodeParameter('continueOnFail', itemIndex, false)` — on per-item failure: if continueOnFail, push an `ErrorPayload`-shaped JSON to a separate failure bucket; else throw the `NodeOperationError` immediately (aborts remaining items)
- [X] T030 [US2] Update `claude-stub-success.sh` in `test/fixtures/` to echo the prompt back inside the JSON `response` field so multi-item tests can verify ordering deterministically

**Checkpoint**: US1 + US2 tests pass. Quickstart Scenarios 2 and 6 pass.

---

## Phase 5: User Story 3 — Error diagnostics (timeout + cancellation + rich details) (Priority: P3)

**Goal**: Every failure mode surfaces with a categorized error and rich `details` payload sufficient to diagnose without reading source. Timeout terminates the subprocess; n8n cancellation terminates within 5 seconds.

**Independent Test**: Run `quickstart.md` Scenarios 5, 7 (full), and 8. Scenario 5 must surface a `timeout` error with `signalEscalatedTo` correctly populated. Scenario 8 must leave no orphan `claude` processes after cancellation.

### Tests for User Story 3

- [X] T031 [P] [US3] Unit tests for the remaining two categories `timeout` and `cancelled` in `test/unit/error.mapper.test.ts` (extend) — assert `details` shapes match `error-payload.schema.json` for each
- [X] T032 [P] [US3] Unit tests for rich `details` payloads in `test/unit/error.mapper.test.ts` (extend) — `not-found` includes `pathHint`; `exit-failure` includes `stderrExcerpt` truncated to ≤4 KiB; `parse-failure` includes `stdoutExcerpt` truncated to ≤2 KiB; `timeout` includes `signalEscalatedTo`. Implemented as end-to-end continue-on-fail tests in `test/integration/node.execute.test.ts`, which is a stricter check (validates the full emission path, not just mapToError in isolation)
- [X] T033 [P] [US3] Create stub `test/fixtures/claude-stub-hang.sh` (sleeps for 30 s, ignores SIGTERM via `trap '' TERM` so the runner is forced to escalate to SIGKILL); also create `test/fixtures/claude-stub-hang-graceful.sh` (sleeps for 30 s but exits cleanly on SIGTERM)
- [X] T034 [US3] Integration test for timeout in `test/integration/subprocess.runner.test.ts` (extend) — invokes `claude-stub-hang-graceful.sh` with `timeoutSeconds: 1`; asserts `terminationReason === 'timeout'`, exit within 2 s wall-clock, `signalEscalatedTo === null`. Then invokes `claude-stub-hang.sh` with `timeoutSeconds: 1`; asserts `signalEscalatedTo === 'SIGKILL'`, exit within 7 s wall-clock
- [X] T035 [US3] Integration test for cancellation in `test/integration/subprocess.runner.test.ts` (extend) — starts a `claude-stub-hang-graceful.sh` invocation, aborts via `AbortSignal`, asserts `terminationReason === 'cancelled'`, exit within 6 s

### Implementation for User Story 3

- [X] T036 [US3] Implement timeout in `nodes/Claude/lib/subprocess.runner.ts` — set a `setTimeout` for `timeoutSeconds * 1000` ms after spawn; on fire, send `SIGTERM`, set a 5 s `setTimeout` to send `SIGKILL` if still alive, resolve with `terminationReason: 'timeout'` and the appropriate `signalEscalatedTo`
- [X] T037 [US3] Implement cancellation in `nodes/Claude/lib/subprocess.runner.ts` — accept an optional `AbortSignal` (or expose a `cancel()` method on the returned promise); on signal/cancel, same SIGTERM→5s→SIGKILL escalation; resolve with `terminationReason: 'cancelled'`
- [X] T038 [US3] Wire cancellation into `Claude.node.ts` execute() — pass `this.getExecutionCancelSignal?.()` (n8n ≥ 1.x) into the runner so workflow Stop terminates in-flight CLI invocations
- [X] T039 [US3] Enrich error mapper details payloads in `nodes/Claude/lib/error.mapper.ts` — populate `pathHint` from `process.env.PATH`, truncate `stderrExcerpt` to last 4 KiB, truncate `stdoutExcerpt` to first 2 KiB; add `timeout` and `cancelled` category branches

**Checkpoint**: All three user stories' tests pass. Quickstart Scenarios 5, 7 (full), and 8 pass.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Ship-readiness — docs, performance assertion, lint clean, manual smoke pass.

- [X] T040 [P] Run `npm run lint` and `npm run format -- --check`; fix any violations
- [X] T041 [P] Add a performance assertion to `test/integration/node.execute.test.ts` — measure node-side overhead (total elapsed minus subprocess elapsed) across 20 invocations against `claude-stub-success.sh`; assert p95 < 50 ms (matches plan.md performance goal)
- [X] T042 [P] Write `README.md` at repo root with: short description, install instructions for n8n self-hosters, prerequisites (Claude CLI installed and authenticated), parameter table, link to `quickstart.md` for end-to-end validation
- [ ] T043 Run all 8 scenarios in `specs/001-core-node-prompt-to-json/quickstart.md` manually against a real n8n install and a real Claude CLI (not just the stubs); record any deviations — **DEFERRED: requires a real n8n instance; user task**
- [X] T044 Confirm the actual CLI flag name (`--output-format json` vs `--json` vs `--format json`, per research.md R3) by running `claude --help`; if it differs from the plan's assumption, update `subprocess.runner.ts` and add a note to research.md — confirmed `-p --output-format json`; runner implemented with those flags

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion. Blocks all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational. The MVP slice.
- **User Story 2 (Phase 4)**: Depends on Foundational. Builds on US1's `Claude.node.ts` and `parameters.ts` (touches the same files), so should follow US1 in serial unless two devs coordinate via PRs.
- **User Story 3 (Phase 5)**: Depends on Foundational. Builds on US1's `subprocess.runner.ts` and `error.mapper.ts`. Can be developed in parallel with US2 if files are coordinated (different functions in the same module).
- **Polish (Phase 6)**: Depends on US1 (T040–T042 only need US1) or all user stories (T043–T044).

### Within Each User Story

- Tests written FIRST (constitution-mandated for critical surfaces).
- Within implementation: parameters + parser + mapper modules can be implemented in parallel `[P]`; the `Claude.node.ts` wiring depends on all three.

### Parallel Opportunities

**Setup (Phase 1)**: T003–T008 all `[P]` — six config files, no overlap. T002 must precede T009.

**Foundational (Phase 2)**: T011 and T012 `[P]` — different files. T010 (types) is the gating task.

**US1 tests (Phase 3)**: T013–T016 all `[P]` — four different test/fixture files.

**US1 implementation modules (Phase 3)**: T019–T021 all `[P]` — three different `lib/` files. T022 (runner) is also independent of those three. T023 (`Claude.node.ts` wiring) depends on T019–T022.

**US3 tests (Phase 5)**: T031–T033 all `[P]` — different files.

**Polish (Phase 6)**: T040–T042 all `[P]` — independent.

---

## Parallel Example: User Story 1

```bash
# After Phase 2 completes, launch US1 tests in parallel:
Task: "Unit test for parameter validation in test/unit/parameters.test.ts"
Task: "Unit test for output parsing in test/unit/output.parser.test.ts"
Task: "Unit test for error mapper categories in test/unit/error.mapper.test.ts"
Task: "Create three stub binaries in test/fixtures/"

# Confirm tests fail (no implementation yet), then launch US1 lib modules in parallel:
Task: "Implement parameters.ts"
Task: "Implement output.parser.ts"
Task: "Implement error.mapper.ts"

# Then T022 (runner) and T023 (Claude.node.ts wiring) in series.
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 (Setup) — toolchain ready.
2. Phase 2 (Foundational) — types and metadata in place.
3. Phase 3 (US1) — write tests, watch them fail, implement, watch them pass.
4. **STOP and validate**: Run quickstart Scenarios 1, 3, 4 against a real n8n install. If they pass, the MVP is shippable as `0.1.0`.

### Incremental Delivery

- After US1 → tag `0.1.0`, optionally publish to npm as a preview.
- After US2 → tag `0.2.0` (per-item processing makes it useful in real workflows).
- After US3 → tag `0.3.0` (production-ready error diagnostics).
- After Polish → tag `1.0.0` and submit for n8n verified-publisher review.

### Solo Strategy (matches Constitution governance)

Solo maintainer: do phases strictly in order. The `[P]` markers are still useful as "tasks where I can multitask within a phase" — e.g., open three editor tabs for the three lib modules and write them as one logical unit.

---

## Notes

- `[P]` tasks = different files, no dependencies on incomplete tasks.
- `[Story]` label maps each implementation task to a user story for traceability.
- US1 alone is a complete, demoable MVP. US2 and US3 are independently testable increments.
- Tests for the constitution's "critical surfaces" (CLI invocation, JSON parsing, error propagation) MUST fail before their implementation tasks begin and pass after.
- Subprocess mocking is forbidden in `test/integration/` per Constitution Principle IV; only `test/unit/` may use mocks.
- After each phase, commit (the `after_*` git extension hooks make this one prompt).
