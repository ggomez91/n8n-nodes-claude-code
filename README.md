# n8n-nodes-claude-code

[![npm version](https://img.shields.io/npm/v/@ggomez91npm/n8n-nodes-claude-code.svg)](https://www.npmjs.com/package/@ggomez91npm/n8n-nodes-claude-code)
[![license](https://img.shields.io/npm/l/@ggomez91npm/n8n-nodes-claude-code.svg)](LICENSE)

**Use Claude in n8n with your existing Claude Pro/Max subscription. No API key, no per-token billing.**

This community node wraps the locally-installed [Claude Code](https://claude.ai/code) CLI as a subprocess and returns its response as structured JSON. Claude is authenticated via the CLI's normal OAuth flow, so all calls bill against your Pro/Max plan — not the Anthropic API.

> **Looking for the API-key version?** Use [`n8n-nodes-claude`](https://www.npmjs.com/package/n8n-nodes-claude) (unscoped) instead. That one wraps the Anthropic SDK and bills per token. This one does not.

---

## What it does

- Send a prompt → get Claude's response back as a structured JSON output item
- **JSON mode**: parse Claude's response as JSON (with fenced-code-block stripping + retry on parse failure). Fail-soft so workflows don't crash on malformed output.
- **Vision**: attach n8n binary data (images, PDFs) as files Claude can Read
- **Cache**: opt-in filesystem cache to skip the CLI on repeated prompts (saves rate-limit quota + latency)
- **System prompt**: per-call persona/context that doesn't pollute the user prompt
- **Model selection**: pick `opus` / `sonnet` / `haiku` or a full ID
- **Per-item processing** with order preservation and `Continue on Fail`
- **Categorized errors**: 6 distinct failure types with diagnostic payloads

---

## Prerequisites

1. **n8n self-hosted** (community or LTS). This is a community node — n8n Cloud doesn't support installing them.
2. **Claude Code CLI** installed on the host running n8n, authenticated. Test with:
   ```sh
   claude --version
   claude -p --output-format json "ping"
   ```
3. **Node.js ≥ 20.15** (n8n's minimum runtime).

The CLI auth (`~/.claude/.credentials.json`) is per-user. Make sure the user account that runs n8n is the one that authenticated.

---

## Install

### From the n8n UI (recommended)

1. n8n → **Settings** → **Community Nodes** → **Install**
2. Enter package name: `@ggomez91npm/n8n-nodes-claude-code`
3. Click Install. n8n restarts automatically.
4. The **Claude Code** node appears in the node panel under the AI category.

### Manual install (Docker, or for tighter control)

```sh
cd ~/.n8n/nodes      # or wherever your n8n nodes dir lives
npm install @ggomez91npm/n8n-nodes-claude-code
# restart n8n
```

---

## Quick start

### 1. Q&A

| Field | Value |
|-------|-------|
| Prompt | `What is the capital of Argentina?` |

Output (`$json`):
```json
{
  "success": true,
  "response": "Buenos Aires.",
  "model": "claude-sonnet-4-6",
  "meta": { "elapsedMs": 1240 }
}
```

### 2. Structured JSON extraction

| Field | Value |
|-------|-------|
| Prompt | `Extract the name and email from this text into JSON. Only output JSON.\n\n{{ $json.message }}` |
| Response Format | `JSON` |
| Options → Retries on Parse Failure | `2` |

Output:
```json
{
  "success": true,
  "response": "```json\n{\"name\":\"...\",\"email\":\"...\"}\n```",
  "json": {
    "ok": true,
    "value": { "name": "Ada Lovelace", "email": "ada@example.com" },
    "attempts": 1
  }
}
```

Branch downstream with an IF node: `{{ $json.json.ok }}`.

### 3. Image vision

Pre-step: any node producing binary data on property `data` (Read Binary File, HTTP Request, etc.).

| Field | Value |
|-------|-------|
| Prompt | `Describe this image in 2 sentences.` |
| Binary Properties | `data` |

The node stages the binary into a temp dir, passes `--add-dir` so Claude's Read tool can access it, runs Claude (which uses its vision capability for images), and cleans up afterward.

### 4. Idempotent runs (cache)

Set **Options → Cache Responses** ON. Identical (prompt, model, system prompt, format, attachments) hits the cache instead of spawning a new CLI. Output gets `meta.cacheHit: true` on hits. Cleared by deleting files under the configured Cache Directory.

---

## Parameters

Top-level:

| Parameter | Type | Default | Notes |
|-----------|------|---------|-------|
| Prompt | string | (required) | Multi-line. Supports n8n expressions. |
| Timeout (Seconds) | int | 120 | Range 1–1800. SIGTERM → 5 s → SIGKILL on expiry. |
| Model | string | empty | `opus` / `sonnet` / `haiku` or full ID. Empty = CLI default. |
| Binary Properties | string | empty | Comma-separated property names to attach. Required for vision. |
| System Prompt | string | empty | Multi-line. Appended to Claude Code's default. |
| Response Format | enum | `Raw Text` | `Raw Text` or `JSON` (fail-soft parsing). |

Inside the **Options** collection:

| Parameter | Type | Default | Notes |
|-----------|------|---------|-------|
| Cache Directory | string | `<tmpdir>/n8n-nodes-claude-code-cache` | Use a persistent path for cache that survives reboots. |
| Cache Responses | bool | `false` | Opt-in. Failures and `json.ok: false` results are NOT cached. |
| Cache TTL (Seconds) | int | `0` | `0` = never expire. |
| CLI Binary Name | string | `claude` | Override if your binary is renamed. |
| Retries on Parse Failure | int | `0` | JSON mode only. Range 0–5. |

Full output schemas, error categories, migration recipes, and gotchas: see [**AGENTS.md**](AGENTS.md).

---

## Multi-turn conversations (sessions)

Every call returns a `sessionId` on the output item (from the CLI envelope). To continue that
conversation in a later call, pass it back via **Options → Resume Session ID** — the node runs
`claude --resume <ID>` and Claude remembers the whole prior exchange. Sessions live on the
machine that runs n8n (per OS user + working directory of the n8n process), so they survive
n8n restarts. Caching is automatically bypassed on resumed calls.

```text
Turn 1: Claude Code node → output { response, sessionId: "8f14…" }
Turn 2: Options → Resume Session ID = {{ $json.sessionId }} → Claude continues the conversation
```

---

## When NOT to use this node

- You want **per-token API billing** (use [`n8n-nodes-claude`](https://www.npmjs.com/package/n8n-nodes-claude) or the official Anthropic node).
- You need **streaming** responses (this node is synchronous one-shot).
- You need **temperature / top_p / max_tokens** control (Claude Code CLI doesn't expose them).
- You need a **chat-model provider for n8n's AI Agent** (this is an action node, not a langchain chat model).

---

## Limits

- 16 binary attachments per call, 50 MiB per file
- One CLI invocation per input item, sequential (not parallel)
- Linux/macOS verified; Windows compatibility not validated
- Cache directory grows unbounded when TTL=0; prune manually if needed

---

## Development

```sh
git clone https://github.com/ggomez91/n8n-nodes-claude-code.git
cd n8n-nodes-claude-code
npm install
task --list          # see available tasks
task check           # lint + tests (must pass before publish)
task deploy:cortex   # build + scp + install + restart on a remote n8n
```

Tests run against shell-script CLI stubs (no `child_process` mocking, per project Constitution Principle IV — Risk-Based Testing). All 129 tests across unit + integration suites complete in ~12 s.

---

## License

MIT — see [LICENSE](LICENSE).
