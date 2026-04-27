# Quickstart: Core n8n Claude CLI Node

**Date**: 2026-04-22
**Plan**: [plan.md](./plan.md) · **Spec**: [spec.md](./spec.md)

This is the integration walkthrough that proves the v1 feature is shipped
correctly. If every step here works on a fresh n8n install, the feature
satisfies its spec.

## Prerequisites

1. **Self-hosted n8n** (community or LTS) running on Linux or macOS.
2. **Claude CLI** installed locally and authenticated:
   ```sh
   claude --version          # confirms install
   claude --output-format json -p "ping"   # confirms auth + JSON output
   ```
3. The built community-node package available — either:
   - Installed from npm (`npm install -g claudenode` inside the n8n
     custom-extensions dir), or
   - Symlinked from a local checkout for development:
     ```sh
     cd /path/to/this/repo
     npm install
     npm run build
     npm link
     cd ~/.n8n/custom
     npm link claudenode
     ```
4. Restart n8n. The node "Claude" appears in the node panel under the
   "AI" category.

## Scenario 1 — Static prompt (validates US1 / FR-001..005)

1. Create a new workflow.
2. Add a **Manual Trigger** node.
3. Add the **Claude** node, connected to the trigger.
4. Set parameters:
   - `Prompt`: `What is 2+2? Reply with just the number.`
   - `Timeout (seconds)`: leave at default `120`.
5. Click **Execute Workflow**.

**Expected**: One output item. Open the JSON view — it MUST contain:
```json
{
  "success": true,
  "response": "4",
  "raw": { /* full CLI JSON object */ },
  "meta": { "elapsedMs": 1234 }
}
```
…and `model`, `stopReason`, `usage` if the CLI supplied them.

**Fail the spec if**: more or fewer than one output item; `success` not
present or not `true`; `response` missing; `raw` missing.

## Scenario 2 — Per-item processing (validates US2 / FR-004)

1. Replace the trigger with a **Code** node returning three items:
   ```js
   return [
     { json: { question: "What color is the sky?" } },
     { json: { question: "What is 2 + 2?" } },
     { json: { question: "Name a fruit." } },
   ];
   ```
2. In the Claude node, set the prompt to `{{ $json.question }}`.
3. Execute.

**Expected**: exactly **three** output items, in the same order as
input. Each item's `response` answers the corresponding question.

**Fail the spec if**: item count mismatch; order shuffled; one input
item produces multiple outputs.

## Scenario 3 — Validation error (validates FR-002)

1. In the Claude node, set the prompt to an empty string `""`.
2. Execute.

**Expected**: execution fails with a `validation` category error
naming the `prompt` parameter. **No subprocess was spawned** (verify
with `ps` if you want to be paranoid).

## Scenario 4 — Binary not found (validates US3 / FR-006)

1. Temporarily rename your `claude` binary on PATH (e.g.,
   `mv $(which claude) $(which claude).hidden`).
2. Execute the workflow from Scenario 1.

**Expected**: execution fails with a `not-found` category error whose
`details.binaryName` is `"claude"` and whose `details.pathHint`
contains the PATH the n8n process saw.

3. Restore the binary: `mv ~/.local/bin/claude.hidden ~/.local/bin/claude`
   (or wherever you renamed it).

## Scenario 5 — Timeout (validates FR-008)

1. In the Claude node, set:
   - `Prompt`: any prompt likely to take > 3 seconds.
   - `Timeout (seconds)`: `2`.
2. Execute.

**Expected**: execution fails with a `timeout` category error,
`details.timeoutSeconds === 2`, `details.signalEscalatedTo` is `null`
(the CLI exited cleanly on SIGTERM) or `"SIGKILL"` (it didn't).

3. Confirm no orphan: `pgrep -f claude` returns nothing related to
   that workflow.

## Scenario 6 — Continue on Fail (validates FR-009)

1. Re-do Scenario 2 (three items), but make the **second** item's
   prompt empty: `{ json: { question: "" } }`.
2. In the Claude node, enable **Settings → Continue on Fail**.
3. Execute.

**Expected**: three output items. Items 1 and 3 have `success: true`
with their answers. Item 2 has `success: false`, `category: "validation"`.

## Scenario 7 — Shell metacharacter safety (validates SC-004 / Principle III)

1. Set the prompt to: `What is the output of: $(rm -rf /tmp/should-not-exist) ; echo done?`
2. Execute.

**Expected**: Claude responds discussing the *text* of the command (or
refuses, etc.) — and `/tmp/should-not-exist` was never touched (verify
with `ls /tmp`). The prompt is forwarded as literal text via argv.

## Scenario 8 — Cancellation cleanup (validates FR-010 / SC-005)

1. Set the prompt to one that will take ~30 seconds.
2. Execute, then click **Stop** in the n8n UI within 5 seconds.
3. Within 5 seconds of clicking Stop, run `pgrep -f claude` in a shell.

**Expected**: no `claude` process related to that workflow remains.

---

## Done

If all eight scenarios pass on a clean n8n install, FR-001 through
FR-011 and SC-001 through SC-005 are satisfied. The remaining check
(< 50 ms p95 node overhead, performance goal in plan.md) is verified
by the perf assertion in `test/integration/node.execute.test.ts`.
