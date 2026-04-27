# Implementation Plan: Core n8n Claude CLI Node — Prompt In, JSON Out

**Branch**: `001-core-node-prompt-to-json` | **Date**: 2026-04-22 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/001-core-node-prompt-to-json/spec.md`

## Summary

Ship the v1 of an n8n community node that takes a prompt as a per-item input,
spawns the local Claude CLI as a child process (argv-array, no shell), and
emits one structured-JSON output item per input. Failures surface as
categorized n8n execution errors; cancellation kills the subprocess.

Technical approach: a single TypeScript n8n node class implementing
`INodeType`, with an isolated subprocess-runner module that owns
`child_process.spawn`, timeout, and cancellation. Pass-through of CLI's
`--output-format json` payload as the node's JSON output. Tests split into
unit (parser, error categorization, parameter validation) and integration
(real CLI invocation against a stub binary). No mocks at the subprocess
boundary in integration tests (Constitution Principle IV).

## Technical Context

**Language/Version**: TypeScript 5.x targeting Node.js ≥ 20.15 (n8n's
current minimum runtime).
**Primary Dependencies**: `n8n-workflow` (interfaces), `n8n-core` (helpers)
— both peer-deps as required by community-node packaging. No runtime
dependencies beyond those and the Node standard library; subprocess
handling uses `node:child_process` (`spawn`).
**Storage**: N/A — node is stateless between invocations.
**Testing**: Jest (n8n community-node convention). Integration tests invoke
a small stub `claude` binary checked into `test/fixtures/` via
`spawn`, exercising real subprocess semantics.
**Target Platform**: Self-hosted n8n (community + LTS) on Linux/macOS
hosts. Windows support is not promised in v1 (CLI binary discovery and
process semantics differ; see research.md).
**Project Type**: Single npm package — n8n community node. No frontend, no
service, no separate backend.
**Performance Goals**: Per-item latency dominated by CLI/Claude response
time; node overhead (parameter resolution + spawn + parse + emit) MUST
be < 50 ms p95 on a typical workflow worker.
**Constraints**:
  - No runtime deps beyond peer-deps + stdlib (Constitution Principle V).
  - Output JSON shape stable enough that additive CLI fields don't break
    the contract (Principle II).
  - No shell interpolation of user-provided text (Principle III).
  - Subprocess MUST be killed within 5 s of n8n cancellation (FR-010).
**Scale/Scope**: One node, one parameter (`prompt`) plus a `timeout`
override and a hidden `cliBinaryName` advanced setting. ~600 LOC of
production code estimated; ~400 LOC of tests.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constitution version: **1.0.0** (ratified 2026-04-22).

| Principle | Verdict | Notes |
|-----------|---------|-------|
| I. Single Responsibility (n8n Node Boundary) | ✓ PASS | Node only translates between n8n items and CLI invocations. No prompt templating, no response post-processing, no workflow logic. |
| II. JSON Contract First | ✓ PASS | Output schema documented in `contracts/node-output.schema.json` before code is written. Input parameters declared via n8n `INodeProperties` (typed). Pass-through of CLI's structured JSON output preserves additivity. |
| III. Local CLI Trust Boundary | ✓ PASS | All invocation goes through `subprocess.runner.ts` which uses `spawn(binary, [...args])` (no `shell: true`, no `exec`). Non-zero exits become categorized errors with stderr captured. Stdout parsed with explicit JSON error handling. |
| IV. Risk-Based Testing | ✓ PASS | Critical-surface tests planned: argv construction (unit), JSON parse + schema (unit), error categorization (unit), real subprocess invocation against stub binary (integration). No mocks for `child_process` in integration tests; unit tests labelled as such. |
| V. Pragmatic Simplicity | ✓ PASS | One n8n node class, one runner module, one error-mapper module. Zero runtime dependencies beyond n8n peer-deps. No abstraction over `child_process` (stdlib used directly). Credentials, streaming, model selection deferred per spec Assumptions. |

**Re-check after Phase 1 design**: ✓ PASS — see `## Post-Design Constitution
Re-Check` at end of file.

## Project Structure

### Documentation (this feature)

```text
specs/001-core-node-prompt-to-json/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── node-input.schema.json    # n8n node parameter contract
│   ├── node-output.schema.json   # JSON shape emitted to downstream nodes
│   └── error-payload.schema.json # Categorized error payload shape
├── checklists/
│   └── requirements.md  # Spec quality checklist (already passing)
├── spec.md              # Feature specification
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

Single npm package, n8n community-node layout (matches `n8n-io/n8n-nodes-starter`
conventions; deviations are explicitly noted):

```text
nodes/
└── Claude/
    ├── Claude.node.ts        # INodeType implementation (the public surface)
    ├── Claude.node.json      # n8n metadata (categories, codex)
    ├── claude.svg            # Node icon
    └── lib/
        ├── subprocess.runner.ts  # spawn + timeout + cancellation
        ├── output.parser.ts      # CLI stdout → schema-validated JSON
        ├── error.mapper.ts       # exit/parse/timeout/notfound categorization
        └── parameters.ts         # Input parameter declarations + validation

test/
├── unit/
│   ├── output.parser.test.ts
│   ├── error.mapper.test.ts
│   └── parameters.test.ts
├── integration/
│   ├── subprocess.runner.test.ts   # invokes stub binary
│   └── node.execute.test.ts        # full INodeType.execute() against stub binary
└── fixtures/
    ├── claude-stub-success.sh     # exits 0 with valid JSON on stdout
    ├── claude-stub-malformed.sh   # exits 0 with invalid JSON on stdout
    ├── claude-stub-fail.sh        # exits non-zero with stderr message
    └── claude-stub-hang.sh        # sleeps past timeout to test cancellation

package.json                # name, version, peerDeps, n8n.nodes manifest
tsconfig.json
gulpfile.js                 # icon copy task (n8n convention)
.eslintrc.js                # uses eslint-plugin-n8n-nodes-base
.prettierrc.js
jest.config.ts
.gitignore                  # to be created during /speckit.implement step 4
```

**Structure Decision**: Single npm package with the n8n community-node
layout. The `nodes/Claude/lib/` subdirectory keeps the runner, parser, and
error mapper as plain modules (no DI framework, no class wrappers) so each
can be unit-tested in isolation and the `Claude.node.ts` class stays a thin
adapter — directly enforcing Constitution Principle I (Single
Responsibility) at the file-layout level.

## Complexity Tracking

> No Constitution Check violations. Section intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| (none)    | (n/a)      | (n/a)                                |

## Post-Design Constitution Re-Check

After Phase 1 (data-model, contracts, quickstart) was drafted, re-evaluating:

- **I.** Confirmed: contracts/ contains only the input/output/error shapes,
  no business-logic schemas. Data model has three entities (input,
  output, error), all behavioral, none persisted.
- **II.** Confirmed: every contract is a JSON Schema file. Output schema
  uses `additionalProperties: true` to allow CLI-side additive fields
  without contract breakage.
- **III.** Confirmed: contracts explicitly disallow shell-interpreted
  fields. Runner contract documents `spawn` with argv array, no `shell`.
- **IV.** Confirmed: contracts double as test oracles — each contract has
  at least one corresponding test in the test plan.
- **V.** Confirmed: no new dependencies introduced during design. Three
  small modules + one node class + four stub fixtures.

**Verdict**: ✓ PASS. Ready for `/speckit-tasks`.
