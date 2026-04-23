<!--
SYNC IMPACT REPORT
==================
Version change: (uninitialized template) → 1.0.0
Bump rationale: Initial ratification — first concrete constitution replacing
the placeholder template. MAJOR baseline since no prior governance existed.

Modified principles: (all newly defined; no prior versions)
  - I. Single Responsibility (n8n Node Boundary)
  - II. JSON Contract First
  - III. Local CLI Trust Boundary
  - IV. Risk-Based Testing
  - V. Pragmatic Simplicity

Added sections:
  - Additional Constraints (n8n + CLI runtime requirements)
  - Development Workflow (solo, lightweight)
  - Governance

Removed sections: None

Templates requiring updates:
  - .specify/templates/plan-template.md      ✅ no changes needed (Constitution
    Check section is principle-agnostic; gates resolved per feature)
  - .specify/templates/spec-template.md      ✅ no changes needed
  - .specify/templates/tasks-template.md     ✅ no changes needed
  - .specify/templates/checklist-template.md ✅ no changes needed
  - CLAUDE.md                                ✅ no changes needed (Spec Kit
    placeholder; populated per feature by /speckit.plan)

Follow-up TODOs: None
-->

# claudenode Constitution

## Core Principles

### I. Single Responsibility (n8n Node Boundary)

The node has exactly one job: invoke the local Claude CLI on behalf of an n8n
workflow and emit the result as structured JSON. Business logic, prompt
templating beyond parameter substitution, response post-processing, and
workflow orchestration MUST live in the calling n8n workflow — not inside
this node.

**Rationale**: An n8n custom node is most reusable when it is a thin,
predictable adapter. Embedding workflow concerns inside the node forces every
caller to inherit them and turns version bumps into breaking changes.

### II. JSON Contract First

Every node output MUST be valid JSON whose shape is documented before
implementation. Inputs MUST be validated against declared parameter types
before the CLI is invoked. Schema changes are versioned: additive fields
are MINOR, renames or removals are MAJOR.

**Rationale**: Downstream n8n nodes consume this output programmatically.
Silent shape drift breaks workflows in production with no compile-time
warning. A documented JSON contract is the only stable interface.

### III. Local CLI Trust Boundary

The Claude CLI is invoked as a child process and treated as an untrusted
external surface:

- User-supplied prompt text MUST be passed via stdin or argv arrays — never
  interpolated into a shell command string.
- Non-zero CLI exit codes MUST surface as n8n node errors with the captured
  stderr included in the error payload.
- stdout MUST be parsed with explicit error handling; malformed output MUST
  fail the node, not silently degrade.

**Rationale**: Subprocess invocation from a workflow tool is a classic
command-injection vector. Treating the CLI boundary as untrusted is cheaper
than auditing every caller.

### IV. Risk-Based Testing

Automated tests are required for the critical surfaces:

- CLI invocation (argument construction, environment, working directory)
- JSON parsing and schema validation of output
- Error propagation (non-zero exits, malformed JSON, timeouts)

Exploratory or scaffolding code MAY rely on manual smoke tests in n8n until
it stabilizes. The CLI subprocess MUST NOT be mocked in integration tests —
tests either invoke the real CLI (or a recorded fixture binary) or are
labelled unit tests with no integration claim.

**Rationale**: Solo project; full TDD slows iteration without proportional
return. But the surfaces above are exactly where mocked tests historically
mask production bugs, so they earn the test cost.

### V. Pragmatic Simplicity

Prefer the smallest workable implementation. New abstractions, configuration
knobs, or indirection layers MUST be justified by an existing second use
case — not a hypothetical future one. n8n node lifecycle conventions
(`description`, `execute`, credential types) take precedence over custom
patterns.

**Rationale**: Solo maintainer, minimal ceremony. Premature abstraction is
the dominant source of dead code in single-author projects, and divergence
from n8n conventions makes the node harder to upgrade with the n8n platform.

## Additional Constraints

**Runtime**: Node.js LTS, compatible with the n8n custom node API in use at
the time of release. The node MUST function with a Claude CLI binary
discovered on `PATH` or via an explicit credential-supplied path.

**Packaging**: Distributed as an installable n8n community node package.
Build artifacts MUST be reproducible from the committed source — no
post-publish manual edits.

**Dependencies**: Runtime dependencies are kept minimal. Anything beyond
the n8n workflow types and Node.js standard library requires explicit
justification in the plan's Complexity Tracking section.

## Development Workflow

- Solo maintainer; no formal review gate.
- Every change MUST pass the Spec Kit Constitution Check during `/speckit.plan`.
- Commits use conventional, descriptive messages (no enforced style guide).
- Releases follow SemVer. A release artifact MUST NOT ship without the
  critical-surface tests from Principle IV passing locally.

## Governance

This constitution supersedes ad-hoc preferences and prior conventions. The
maintainer MAY amend it unilaterally, subject to the following:

- **Amendment procedure**: Edit `.specify/memory/constitution.md`, update the
  Sync Impact Report at the top, and bump the version per the rules below.
- **Versioning policy**: SemVer.
  - MAJOR — backward-incompatible removal or redefinition of a principle.
  - MINOR — new principle or materially expanded section.
  - PATCH — wording, clarification, typo fixes; no semantic change.
- **Compliance review**: Every `/speckit.plan` run MUST evaluate the feature
  against the Core Principles in its Constitution Check. Violations MUST be
  recorded in Complexity Tracking with explicit justification.
- **Runtime guidance**: Per-feature technical context lives in the active
  plan (`specs/<feature>/plan.md`) and in `CLAUDE.md`.

**Version**: 1.0.0 | **Ratified**: 2026-04-22 | **Last Amended**: 2026-04-22
