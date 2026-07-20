# AGENTS.md — `@ggomez91npm/n8n-nodes-claude-code`

Reference for AI agents (Cursor, Claude Code, etc.) doing migrations or
authoring workflows that use this n8n community node. Self-contained:
read this and you can produce a correct workflow without touching the
source.

---

## What this node is

An n8n community node that **wraps the locally-installed Claude Code
CLI** as a subprocess and returns its response as structured JSON. It
is the bridge for workflows that want Claude in n8n **without** an
Anthropic API key — billing comes from the host's Claude Pro/Max
subscription via OAuth, not from the API.

**Hard requirements on the n8n host:**
- The `claude` binary on `PATH` (or an explicit path configured per node).
- That binary authenticated (`claude` interactively at least once, or a
  pre-staged `~/.claude/.credentials.json`).

**Not for**: API-key-based workflows. If the host has `ANTHROPIC_API_KEY`
and you want per-token billing, use the SDK-based community node
(`n8n-nodes-claude` unscoped, by `emu2025`) or the official Anthropic
nodes — different beasts.

**Internal node type identifier**: `@ggomez91npm/n8n-nodes-claude-code.claude`.
**UI display name**: `Claude Code`.

---

## Parameters

All parameters resolve per input item. n8n expressions are supported on
every string field unless noted.

### Top-level (always visible)

| Name | UI label | Type | Default | Notes |
|------|----------|------|---------|-------|
| `prompt` | Prompt | string (multi-line) | (none, required) | The user prompt. Non-string expressions (numbers, objects) are coerced via `String()` / `JSON.stringify()`. Empty / whitespace-only fails fast as a `validation` error. |
| `timeoutSeconds` | Timeout (Seconds) | integer | `120` | Wall-clock cap. Range `[1, 1800]`. On expiry: SIGTERM, then SIGKILL after 5 s grace. |
| `model` | Model | string | `''` (CLI default) | Alias (`opus`, `sonnet`, `haiku`) or full ID (`claude-sonnet-4-6`, `claude-opus-4-7`, `claude-haiku-4-5-20251001`). New Anthropic models work as soon as the local CLI knows them. |
| `binaryProperties` | Binary Properties | string | `''` | Comma- or space-separated list of binary property names on the input item to attach as files. Each is staged to a temp dir + `--add-dir` is added to argv. **Required for vision workflows.** Max 16 files / 50 MiB each. |
| `systemPrompt` | System Prompt | string (multi-line) | `''` | Appended to Claude Code's default system prompt via `--append-system-prompt`. Use for persona, output-format constraints, RAG context. |
| `responseFormat` | Response Format | enum | `'raw'` | `'raw'` returns Claude's text as-is. `'json'` strips fenced code blocks (` ```json…``` `, ` ```…``` `), parses, and reports parse status — **fail-soft**: never fails the node, surfaces success/failure under the output's `json` field. |

### Inside the **Options** collection (alphabetized in UI)

| Name | UI label | Type | Default | Notes |
|------|----------|------|---------|-------|
| `cacheDir` | Cache Directory | string | `''` (= `<os.tmpdir>/n8n-nodes-claude-code-cache`) | Persistent path is recommended (`/var/lib/n8n-claude-cache`). Empty = `os.tmpdir()` (cleared on reboot). Created if missing. |
| `useCache` | Cache Responses | boolean | `false` | When on: SHA-256 over (prompt, model, system prompt, response format, CLI binary, attachments digest) keys a file-backed cache. Hits skip the CLI entirely. **Failures and `json.ok: false` results are never cached.** |
| `cacheTtlSeconds` | Cache TTL (Seconds) | integer | `0` | `0` = never expire. Otherwise, cached entries older than the TTL produce misses. |
| `cliBinaryName` | CLI Binary Name | string | `'claude'` | Name (resolved against `PATH`) or absolute path. Restricted to `[A-Za-z0-9._/\\:-]` for safety. |
| `retries` | Retries on Parse Failure | integer | `0` | Only meaningful when `responseFormat === 'json'`. Number of additional attempts after a parse failure. `0` = one attempt total, no retry. Range `[0, 5]`. |

---

## Output shape (success)

Always emitted as a single n8n item (`{ json: …, binary?: … }`).

```jsonc
{
  "success": true,
  "response": "Claude's text response, exactly as the CLI returned it (with fences in JSON mode)",
  "model": "claude-sonnet-4-6",       // optional, when CLI provides it
  "stopReason": "end_turn",            // optional
  "usage": {                           // optional
    "inputTokens": 12,
    "outputTokens": 47
  },
  "raw": { /* the full unparsed CLI JSON envelope, pass-through */ },
  "meta": {
    "elapsedMs": 1843,
    "cacheHit": true,                  // only present on cache hits
    "cachedAt": "2026-04-26T18:12:34.567Z"  // only present on cache hits
  },

  // Only when responseFormat === 'json':
  "json": {
    "ok": true,
    "value": { "any": "JSON the model emitted (after fence stripping)" },
    "attempts": 1
  }
}
```

When `responseFormat === 'json'` and parsing fails after all retries
exhausted, the same shape but:

```jsonc
{
  "success": true,                     // still success; node fails soft in json mode
  "response": "the raw text Claude returned, fences and all",
  "json": {
    "ok": false,
    "error": "Unexpected token x in JSON at position 5",
    "attempts": 3
  }
  // …other fields as above
}
```

**Branching downstream**: use an IF node on `{{ $json.json.ok }}`.

---

## Output shape (failure)

Emitted in the failure bucket when **Continue on Fail** is enabled,
otherwise thrown as `NodeOperationError` and the workflow halts at that
item (matching n8n's standard behavior).

```jsonc
{
  "success": false,
  "category": "exit-failure",          // see categories below
  "message": "Claude CLI exited with a non-zero status",
  "details": {
    "exitCode": 2,
    "stderrExcerpt": "Error: invalid auth\n…"
  },
  "meta": {
    "itemIndex": 3,
    "elapsedMs": 142
  }
}
```

### Error categories

| `category` | When it fires | Key `details` fields |
|------------|---------------|----------------------|
| `validation` | Bad parameter (empty prompt, missing binary property, oversized attachment, etc.) | `parameter`, `received` |
| `not-found` | `claude` binary missing on `PATH` (ENOENT on spawn) | `binaryName`, `pathHint` |
| `exit-failure` | CLI exited non-zero (auth missing, rate limit, etc.) | `exitCode`, `stderrExcerpt` |
| `parse-failure` | CLI's stdout wasn't valid JSON (envelope issue, not Claude's text) | `parseError`, `stdoutExcerpt` |
| `timeout` | `timeoutSeconds` elapsed; CLI was killed | `timeoutSeconds`, `signalEscalatedTo` (`'SIGKILL'` if SIGTERM was insufficient, else `null`) |
| `cancelled` | Workflow was Stopped while CLI was running | (none) |

Note: a JSON parse failure of **Claude's response text** in `responseFormat: 'json'` mode does **NOT** fire a `category` error. It surfaces under `json.ok = false` on a successful item. The `parse-failure` category is for the CLI envelope itself (Claude Code stdout is not the expected JSON format) — almost never happens in practice.

---

## Common patterns

### 1. Quick Q&A (raw text)

| Field | Value |
|-------|-------|
| Prompt | `What is the capital of Argentina?` |
| Response Format | Raw Text (default) |

Output: `{ json: { success: true, response: "Buenos Aires.", … } }`

### 2. Structured extraction (JSON mode)

| Field | Value |
|-------|-------|
| Prompt | `Extract from the text below into JSON with keys "name", "email", "phone". Only output the JSON.\n\n{{ $json.message }}` |
| Response Format | JSON |
| Options → Retries on Parse Failure | `2` (Claude sometimes adds preambles on first try) |

Downstream IF node: `{{ $json.json.ok }}` true branch reads `{{ $json.json.value.name }}`, false branch logs `{{ $json.json.error }}` for inspection.

### 3. Image vision

Pre-step: a **Read Binary File** node (or HTTP Request returning an image) producing binary on property `data`.

| Field | Value |
|-------|-------|
| Prompt | `Describe this image in 2 sentences.` |
| Binary Properties | `data` |
| Options → Cache Responses | `true` (saves quota on re-runs) |

The node stages the binary to a temp dir, passes `--add-dir`, auto-prepends a hint to the system prompt listing the staged files, runs Claude. Cleanup is automatic.

For images: ensure the binary metadata has either a `fileName` with extension or a `mimeType` (e.g., `image/png`). The node derives the staged extension from MIME if `fileName` lacks one. Without either, the file gets `.bin` and Claude's Read tool falls back to raw-binary handling (no vision).

### 4. Per-item batch with Continue on Fail

Upstream feeds 100 input items. The Claude Code node has **Continue on Fail** ON (in the node's settings panel). Failed items are emitted in the success bucket with `success: false, category: …`. Process the success bucket downstream; route failures via an IF node on `{{ $json.success }}`.

### 5. Rate-limited workflow

Add the **Cache Responses** option. Repeated runs with the same prompt skip the CLI entirely. Especially valuable on Pro/Max where you have monthly quota. TTL=0 means cache forever; set a TTL in seconds for time-bounded freshness (e.g. `86400` for 1-day cache on news/data prompts).

---

## Migration cookbook

### From: HTTP Request node hitting `api.anthropic.com/v1/messages`

Old:
```
HTTP Request
  Method: POST
  URL: https://api.anthropic.com/v1/messages
  Headers: x-api-key: {{credentials.anthropic_api_key}}
  Body JSON:
    model: "claude-sonnet-4-6"
    max_tokens: 1024
    messages: [{ role: "user", content: "{{ $json.question }}" }]
```

New:
```
Claude Code
  Prompt: {{ $json.question }}
  Model: sonnet         (or claude-sonnet-4-6)
```

The response shape changes:
- Old: `{{ $json.content[0].text }}`
- New: `{{ $json.response }}`

If the old prompt expected a system message:
```
Old: messages: [
  { role: "system", content: "You are a translator." },
  { role: "user", content: "..." }
]
```
becomes:
```
New: System Prompt: You are a translator.
     Prompt: {{ $json.text }}
```

### From: OpenAI / generic LLM nodes (text completion)

Most map directly:
- OpenAI `prompt` / `messages[user]` → Claude Code `prompt`
- OpenAI `system` message → Claude Code `systemPrompt`
- OpenAI `model` → Claude Code `model` (translate IDs: `gpt-4o` has no Claude equivalent, pick `opus`/`sonnet` based on quality/cost trade-off)
- OpenAI `response_format: json_object` → Claude Code `responseFormat: json`
- OpenAI `temperature`, `top_p`, etc. → **not exposed** by this node (Claude Code CLI doesn't expose them in print mode). If your old workflow depends on temperature tuning, this node doesn't replace it.

### From: Code node calling the Anthropic SDK directly

Same as the HTTP Request mapping. Plus: remove the `npm install @anthropic-ai/sdk` from the n8n install if nothing else uses it.

### From: n8n's AI Agent abstraction (LangChain-style chat models)

This node is **not** an AI Agent / chat-model provider in n8n's LangChain ecosystem. It's a plain action node (one prompt → one response). If your workflow uses the AI Agent's tool-using loop, you'd lose that — agents need a chat-model provider that supports tool calls, which this node doesn't expose. Use the official Anthropic chat model node for those flows; use Claude Code for one-shot prompts.

---

## Limitations / gotchas

- **No streaming**: synchronous one-shot only. Whole response arrives at once.
- **Multi-turn via sessions (v0.8.0+)**: each call returns `sessionId`; pass it back via `options.resumeSessionId` to continue that conversation (`--resume`). Sessions live on the n8n host (per OS user + process cwd). Caching is bypassed while resuming. `--continue` (implicit last-session) is intentionally not exposed — always address a session by ID.
- **No tool restriction**: Claude Code may use Read, Bash, etc. as it deems useful (subject to its own permission model). The node exposes `--add-dir` for binary attachments but no `--allowed-tools` / `--disallowed-tools` parameters.
- **No `temperature` / `top_p` / `max_tokens` knobs**: the Claude Code CLI doesn't expose these in `--print` mode.
- **Subscription rate limits apply**: you're using Pro/Max quota. Heavy batch workflows can hit the wall. Cache aggressively on idempotent prompts.
- **Vision needs proper MIME type or extension**: see the Image vision pattern above.
- **Cache key includes the CLI binary name** — different binaries (e.g., a wrapper script) produce different cache entries even for identical inputs. Almost never matters in practice; mention only if your migration changes `cliBinaryName`.
- **Cache directory grows unbounded** when TTL=0. Document the path so it can be pruned manually if needed.
- **Linux/macOS only**: shell-script test stubs are POSIX. Windows compatibility hasn't been validated.

---

## Diagnosing a failing workflow

1. **`category: 'not-found'`**: `claude` not on PATH for the user that runs n8n. SSH the host, run `which claude` as that user.
2. **`category: 'exit-failure'` with stderr mentioning auth**: re-run `claude` interactively once to refresh OAuth (`~/.claude/.credentials.json`).
3. **`category: 'timeout'`**: bump **Timeout (Seconds)**. Long prompts + extended thinking can legitimately take >120 s.
4. **`json.ok: false` repeatedly**: the prompt isn't constraining Claude well enough. Add an example, or use **Retries on Parse Failure** = 2.
5. **`response` says "raw binary data without recognized image extension"**: binary metadata had no `fileName`/`mimeType` hint. Add a Set node before to set the binary's `mimeType` explicitly.
6. **Cache never hits despite same input**: confirm one of (prompt, model, system prompt, response format, CLI binary, attachment bytes) didn't drift. n8n expressions can interpolate timestamps that change every run.

---

## Versioning & changelog

- See `CHANGELOG.md` at repo root for version history.
- Current cortex install: check `task status:cortex` (Taskfile.yml).
- Upgrade flow: `task deploy:cortex` from the repo on the dev machine. Idempotent.
