# Phase 1 Data Model: Core n8n Claude CLI Node

**Date**: 2026-04-22
**Plan**: [plan.md](./plan.md)

The node is stateless — nothing is persisted between executions. The
"data model" therefore describes the **in-flight shapes** that flow
through `INodeType.execute()`: input, intermediate, and output. Each
shape has a corresponding JSON Schema in `contracts/`.

---

## Entity 1: NodeInputItem

The unit the node consumes. Comes from the upstream n8n item plus the
node's resolved parameters.

| Field | Type | Required | Source | Notes |
|-------|------|----------|--------|-------|
| `prompt` | string | yes | node param `prompt` (n8n expression) | Validated non-empty before invocation. |
| `timeoutSeconds` | integer | yes | node param `timeoutSeconds` | Default 120, range `[1, 1800]`. |
| `cliBinaryName` | string | yes | node param (advanced) | Default `"claude"`. Resolved against `PATH` by the OS. |
| `itemIndex` | integer | yes | n8n runtime | Used for per-item error attribution. |

**Validation rules** (enforced before subprocess invocation):
- `prompt` MUST be a string. n8n expressions yielding numbers/objects
  are coerced via `String(value)` (FR-002 acceptance scenario 2 of US2).
- `prompt` MUST have non-zero length after trimming.
- `timeoutSeconds` MUST be an integer in `[1, 1800]`.
- `cliBinaryName` MUST match `/^[A-Za-z0-9._-]+$/` (defense in depth —
  prevents the override field from itself becoming an injection vector,
  Principle III).

**State transitions**: none. NodeInputItem is constructed from
n8n-supplied data, validated once, and consumed.

---

## Entity 2: SubprocessResult

Internal — produced by `subprocess.runner.ts`, consumed by
`output.parser.ts` and `error.mapper.ts`. Not exposed to workflow authors.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `exitCode` | integer \| null | yes | `null` only when terminated by signal. |
| `signal` | string \| null | yes | e.g. `"SIGTERM"`, `"SIGKILL"`; `null` when exited normally. |
| `stdout` | Buffer | yes | Bounded (see constraints below). |
| `stderr` | Buffer | yes | Bounded. |
| `elapsedMs` | integer | yes | Wall-clock from spawn to exit. |
| `terminationReason` | enum | yes | `"exited"` \| `"timeout"` \| `"cancelled"` \| `"spawn-error"` |
| `spawnError` | Error \| null | yes | Populated only when `terminationReason === "spawn-error"` (e.g., `ENOENT`). |

**Constraints**:
- `stdout` and `stderr` are each capped at 10 MiB. Beyond cap, the
  runner stops appending and sets a `truncated: true` flag (carried
  alongside the buffer; not in the schema since this is internal).
- `terminationReason === "timeout"` MUST imply `signal !== null`
  (the runner sent a signal).

**State transitions**:

```
[initial] ──spawn()──► [running] ──┬─ child exits ─► [exited]
                                   ├─ timeout fires ─► [terminating] ──5s──► [killed]
                                   └─ cancel signal ─► [terminating] ──5s──► [killed]
```

`[exited]`, `[killed]`, and `[spawn-error]` are terminal. The runner
resolves its returned promise exactly once, on entering any terminal
state.

---

## Entity 3: NodeOutputItem

The shape emitted to downstream nodes on success. Conforms to
`contracts/node-output.schema.json`.

| Field | Type | Required | Source | Notes |
|-------|------|----------|--------|-------|
| `success` | boolean | yes | always `true` for success items | Downstream `IF` nodes can branch on this. |
| `response` | string | yes | parsed from CLI JSON | The text content of Claude's response. |
| `model` | string | no | parsed from CLI JSON | Model identifier the CLI reports. |
| `stopReason` | string | no | parsed from CLI JSON | e.g. `"end_turn"`, `"max_tokens"`. |
| `usage` | object | no | parsed from CLI JSON | Token counts (input/output) when CLI provides them. |
| `raw` | object | yes | unparsed CLI JSON object | Pass-through; allows downstream consumers to read fields the node doesn't promote. |
| `meta` | object | yes | constructed by node | `{ elapsedMs, model? }` for observability. |

The schema uses `additionalProperties: true` at the top level so
additive CLI fields surface without a node release.

---

## Entity 4: ErrorPayload

The shape emitted when "Continue on Fail" is enabled and an item fails,
**and** the shape attached to the `NodeOperationError` `description`
field when an execution-level error is thrown. Conforms to
`contracts/error-payload.schema.json`.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `success` | boolean | yes | Always `false`. |
| `category` | enum | yes | One of: `validation`, `not-found`, `exit-failure`, `parse-failure`, `timeout`, `cancelled`. |
| `message` | string | yes | Human-readable, single sentence. |
| `details` | object | yes | Category-specific diagnostic fields (see below). |
| `meta` | object | yes | `{ elapsedMs, itemIndex }`. |

**Category-specific `details`**:

| Category | Required `details` fields |
|----------|--------------------------|
| `validation` | `parameter` (which param failed), `received` (what was seen, redacted/truncated) |
| `not-found` | `binaryName`, `pathHint` (the `PATH` env value at lookup time) |
| `exit-failure` | `exitCode`, `stderrExcerpt` (last 4 KiB) |
| `parse-failure` | `parseError` (the JSON parser message), `stdoutExcerpt` (first 2 KiB) |
| `timeout` | `timeoutSeconds`, `signalEscalatedTo` (`"SIGKILL"` if SIGTERM was insufficient, else null) |
| `cancelled` | (no extra fields) |

---

## Relationships

```
NodeInputItem  ──(parameters)──►  SubprocessResult
                                       │
                                       ├──►  NodeOutputItem    (success path)
                                       │
                                       └──►  ErrorPayload      (failure paths)
```

Each input item produces exactly one output (either `NodeOutputItem`
in the success bucket or `ErrorPayload` in the failure bucket). Order
is preserved by the sequential per-item loop.
