# claudenode

An n8n community node that invokes a locally-installed Claude CLI as a subprocess and returns the result as structured JSON. Thin adapter — no prompt templating, no workflow logic, just prompt-in → JSON-out.

Specification-driven: the full spec, plan, contracts, and task list live under `specs/001-core-node-prompt-to-json/`.

## Status

Work-in-progress. Current behavior:

- Single prompt parameter (n8n expressions supported).
- Per-item processing with order preservation and `Continue on Fail` support.
- Configurable timeout (1–1800 s, default 120) with SIGTERM → 5 s → SIGKILL escalation.
- Subprocess cancellation on n8n workflow Stop.
- Six categorized error types with rich diagnostic payloads: `validation`, `not-found`, `exit-failure`, `parse-failure`, `timeout`, `cancelled`.

Not in this version (deferred to later features):

- n8n credentials type for CLI configuration.
- Streaming output.
- Model selection / system prompt / tool use / conversation continuation.
- Windows platform support.

## Prerequisites

- **n8n** self-hosted, community or LTS.
- **Claude CLI** installed and authenticated on the host running n8n. Verify with:
  ```sh
  claude --version
  claude -p --output-format json "ping"
  ```
- **Node.js ≥ 20.15** (n8n's minimum runtime).

## Install (local development)

```sh
git clone <this-repo>
cd claudenode
npm install
npm run build

# Make the node available to a local n8n install:
npm link
cd ~/.n8n/custom
npm link claudenode

# Restart n8n. The "Claude" node appears under the "AI" category.
```

## Parameters

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| **Prompt** | yes | — | Text sent to Claude. Supports n8n expressions. |
| **Timeout (Seconds)** | yes | 120 | Wall-clock limit. Range 1–1800. |
| **Options → CLI Binary Name** | no | `claude` | Override if the binary is renamed or you want to point at a specific absolute path. Characters restricted to `[A-Za-z0-9._/\\:-]` for safety. |

## Output shape (success)

```json
{
  "success": true,
  "response": "Claude's response text",
  "model": "claude-sonnet-4-6",
  "stopReason": "end_turn",
  "usage": { "inputTokens": 10, "outputTokens": 5 },
  "raw": { "/* full unparsed CLI JSON object */": "…" },
  "meta": { "elapsedMs": 1234 }
}
```

Additional fields the CLI emits are passed through inside `raw`. The top-level shape has `additionalProperties: true`, so new CLI fields surface without a node release.

## Output shape (failure, when Continue on Fail is on)

```json
{
  "success": false,
  "category": "exit-failure",
  "message": "Claude CLI exited with a non-zero status",
  "details": { "exitCode": 2, "stderrExcerpt": "…" },
  "meta": { "itemIndex": 0, "elapsedMs": 200 }
}
```

`category` is one of: `validation`, `not-found`, `exit-failure`, `parse-failure`, `timeout`, `cancelled`. Downstream `IF` nodes can branch on `success` or `category`.

## Validation

End-to-end scenarios live in [`specs/001-core-node-prompt-to-json/quickstart.md`](specs/001-core-node-prompt-to-json/quickstart.md). Run them manually against a real n8n install to verify the feature against its spec.

## Development

```sh
npm test               # all unit + integration tests (against stub binaries)
npm run test:unit      # unit tests only
npm run test:integration
npm run lint
npm run format         # prettier --write
npm run build          # tsc + gulp build:icons
```

Integration tests spawn shell-script stubs from `test/fixtures/` — never mock `child_process`, per constitution Principle IV (Risk-Based Testing).

## Constitution

Project governance in [`.specify/memory/constitution.md`](.specify/memory/constitution.md) (v1.0.0, ratified 2026-04-22). Five principles: Single Responsibility, JSON Contract First, Local CLI Trust Boundary, Risk-Based Testing, Pragmatic Simplicity.
