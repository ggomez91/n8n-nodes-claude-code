# Feature Specification: Core n8n Claude CLI Node — Prompt In, JSON Out

**Feature Branch**: `001-core-node-prompt-to-json`
**Created**: 2026-04-22
**Status**: Draft
**Input**: User description: "Core n8n custom node that accepts a prompt and parameters as input, invokes the local Claude CLI as a subprocess, and returns the response as structured JSON"

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Run a static prompt and receive Claude's response (Priority: P1)

A workflow author drops the Claude node into an n8n workflow, types a static
prompt into the node's prompt field, executes the workflow, and receives
Claude's response as a structured JSON output that downstream nodes can
consume.

**Why this priority**: Without this, the node has no value. This is the
minimum viable slice — everything else depends on it. It proves the CLI
invocation, JSON contract, and n8n integration end to end.

**Independent Test**: Author creates a workflow containing only a Manual
Trigger and the Claude node with a hardcoded prompt ("What is 2+2?"),
clicks Execute, and observes a single output item containing Claude's
answer in the documented JSON shape.

**Acceptance Scenarios**:

1. **Given** the node is configured with a non-empty prompt and the local
   Claude CLI is installed and authenticated, **When** the workflow is
   executed, **Then** the node produces exactly one output item containing
   Claude's response and associated metadata as a JSON object.
2. **Given** the node is configured with an empty prompt, **When** the
   workflow is executed, **Then** the node fails fast with a validation
   error before invoking the CLI, naming the missing parameter.
3. **Given** the node successfully invokes the CLI, **When** the response
   arrives, **Then** the output JSON contains, at minimum, the response
   text and a status indicator that downstream nodes can branch on.

---

### User Story 2 — Use upstream node output as the prompt (Priority: P2)

A workflow author wires the output of a previous node (e.g., a webhook
payload, a database row, a file read) into the Claude node's prompt
parameter using an n8n expression. When the workflow runs against multiple
input items, the Claude node processes each item in turn and emits one
output item per input item with the correlation preserved.

**Why this priority**: This is what makes the node useful inside real
workflows — static prompts only demonstrate the toy case. n8n's per-item
processing model is the standard integration pattern authors expect.

**Independent Test**: Author creates a workflow with a Set node producing
three items, each with a different `question` field. The Claude node uses
`{{ $json.question }}` as its prompt. After execution, the workflow shows
three output items, each containing the answer to the corresponding
question, and the order matches the input order.

**Acceptance Scenarios**:

1. **Given** the node receives N input items with valid prompt expressions,
   **When** the workflow executes, **Then** the node emits exactly N output
   items in the same order as the inputs.
2. **Given** an n8n expression in the prompt parameter resolves to a
   non-string value (e.g., a number, an object), **When** the node
   processes that item, **Then** the value is coerced to a string
   representation that the CLI can accept.
3. **Given** one input item produces a CLI failure while others succeed,
   **When** the workflow executes with default error handling, **Then** the
   failed item is reported as a failure on that item without aborting the
   whole batch (matching n8n's standard "Continue on Fail" behavior when
   enabled, otherwise aborting at the failing item).

---

### User Story 3 — Diagnose a failed invocation (Priority: P3)

A workflow author runs the node and the CLI fails (binary missing,
authentication missing, non-zero exit, malformed output, or timeout). The
node surfaces the failure as an n8n execution error with enough diagnostic
detail (failure category, captured stderr, exit code, elapsed time) for the
author to fix the underlying problem without reading the node's source.

**Why this priority**: Production workflows need to fail loudly and
informatively. Silent failures or generic "something went wrong" messages
turn 5-minute fixes into hour-long debugging sessions, but the basic
prompt-in/out path can be demonstrated without this polish, so it ranks P3.

**Independent Test**: Author renames the local Claude CLI binary on their
PATH so it cannot be found, runs the workflow, and observes the n8n
execution view showing a clearly categorized error ("CLI not found")
rather than a stack trace or a generic error.

**Acceptance Scenarios**:

1. **Given** the local Claude CLI is not installed or not on PATH, **When**
   the node executes, **Then** the error message identifies the missing
   binary and the lookup path attempted.
2. **Given** the CLI exits with a non-zero status, **When** the node
   processes the result, **Then** the error includes the exit code and the
   captured stderr text (truncated to a reasonable display size).
3. **Given** the CLI emits stdout that is not valid JSON, **When** the node
   parses it, **Then** the error categorizes the failure as a parse error
   and includes a snippet of the offending output.
4. **Given** the CLI does not return within the configured timeout, **When**
   the timeout elapses, **Then** the node terminates the subprocess and
   reports a timeout error with the elapsed seconds.

---

### Edge Cases

- The prompt parameter contains shell metacharacters (`;`, `|`, backticks,
  newlines, quotes). The node MUST treat these as literal prompt content,
  never as shell directives.
- The prompt is extremely long (e.g., 1 MB). The node either succeeds with
  the CLI's normal handling or fails with a clearly labelled
  size/limit-related error — never silently truncates.
- The CLI emits very large output (multi-megabyte). The node delivers it
  intact as the JSON output without an arbitrary truncation that the
  author was not warned about.
- The CLI emits valid JSON on stderr while exit code is zero. Stdout is
  the contract; stderr is diagnostic. The node uses stdout for the result.
- Multiple Claude nodes execute concurrently in different workflows on the
  same n8n instance. Each invocation is isolated (independent subprocess,
  independent working directory expectations).
- The user re-executes the workflow before a previous CLI invocation has
  finished (n8n typically queues; the node MUST not leak orphaned
  subprocesses if the n8n execution is cancelled).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The node MUST accept a `prompt` parameter (string,
  required, supports n8n expressions) as its primary input.
- **FR-002**: The node MUST validate that the resolved prompt is a
  non-empty string before invoking the CLI; failures here are reported as
  validation errors without subprocess invocation.
- **FR-003**: The node MUST invoke the local Claude CLI as a child
  process, passing the prompt via a mechanism that prevents shell
  interpretation of prompt content (argv array or stdin — never string
  interpolation into a shell command).
- **FR-004**: The node MUST process input items one at a time, emitting
  exactly one output item per input item in the same order.
- **FR-005**: The node MUST emit each output item as a JSON object whose
  shape is documented and stable, containing at minimum: the response
  text, an indicator of success/failure, and any structured metadata the
  CLI provides (e.g., model name, stop reason, token counts when
  available).
- **FR-006**: The node MUST surface non-zero CLI exit codes as n8n
  execution errors, including the exit code and captured stderr in the
  error payload.
- **FR-007**: The node MUST treat malformed (non-JSON-parseable when JSON
  is expected) CLI output as a failure with a diagnostic message
  identifying the parse error and including a snippet of the output.
- **FR-008**: The node MUST enforce a configurable execution timeout
  (with a sensible default in the 60–120 second range), terminate the
  subprocess on timeout, and report the timeout as a categorized error.
- **FR-009**: The node MUST respect n8n's "Continue on Fail" item-level
  setting: when enabled, a per-item failure marks that item as failed
  without aborting subsequent items.
- **FR-010**: The node MUST NOT leak subprocesses: if the n8n execution
  is cancelled mid-invocation, the spawned CLI process MUST be terminated.
- **FR-011**: The node MUST be discoverable in the n8n UI under a
  recognizable name and category, with a description and parameter help
  text sufficient for a first-time user to configure it correctly.

### Key Entities *(include if feature involves data)*

- **Prompt Input**: The text payload submitted to Claude. Always a
  string. Per-item; resolved from a static value or an n8n expression.
- **Node Output Item**: A single n8n item emitted per input item. A JSON
  object containing the response text, success indicator, and any
  metadata returned by the CLI (model, stop reason, usage counts).
- **Error Payload**: When the node reports a failure (whole-execution or
  per-item), the structured error contains a category (validation,
  not-found, exit-failure, parse-failure, timeout, cancelled), a
  human-readable message, and diagnostic context (exit code, stderr
  excerpt, elapsed time, lookup path — whichever apply to the category).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A workflow author who has the Claude CLI already installed
  and authenticated can drop the node into a new workflow, configure a
  static prompt, and see a successful response in under 5 minutes from
  first install of the node package.
- **SC-002**: 100% of CLI failures (binary missing, non-zero exit,
  malformed output, timeout) surface to the author as categorized n8n
  execution errors — none are reported as generic "internal error" or as
  silently empty output items.
- **SC-003**: Across a batch of 100 input items, the order of output
  items matches the order of input items in 100% of executions.
- **SC-004**: A prompt containing shell metacharacters (a curated set
  including `;`, `|`, backticks, newlines, single and double quotes,
  `$()`) produces the same response text whether or not those characters
  are present — i.e., the metacharacters are treated as literal prompt
  content with zero command-injection paths.
- **SC-005**: When the n8n execution is cancelled while the CLI is
  running, the spawned subprocess terminates within 5 seconds of the
  cancellation; no orphaned `claude` processes remain in the process
  table.

## Assumptions

- **Local CLI installation is out of scope.** Authors are responsible for
  installing and authenticating the Claude CLI on the host running n8n
  before using the node. The node detects but does not install the CLI.
- **CLI binary discovery via PATH is the default.** The node looks up
  `claude` (or the platform-equivalent name) on the executing user's
  PATH. Configuration of an alternative path is deferred to a later
  feature (credentials/config).
- **Synchronous invocation only.** Streaming output is explicitly out of
  scope for this feature; the node waits for the full CLI response
  before emitting an output item.
- **One prompt parameter, no advanced model controls in v1.** Parameters
  such as system prompt, model selection, max tokens, temperature, tool
  use, and conversation/session continuation are deferred to later
  features. Authors get whatever defaults the CLI applies.
- **Per-item processing matches n8n convention.** No batching, no
  parallel CLI invocation within a single execution; one CLI subprocess
  per input item, in order.
- **The CLI's structured output is the source of truth for the node's
  JSON output.** The node passes through fields the CLI provides; it
  does not invent or rename fields. If the CLI's output shape changes,
  the node's output shape changes accordingly (and a MAJOR version bump
  is required per Constitution Principle II).
- **n8n compatibility target**: current n8n LTS / community edition at
  time of release. Compatibility with older versions is not promised.
