#!/usr/bin/env bash
# Stub for happy-path Claude CLI invocation.
# Echoes the last argument (the prompt) inside the result field so multi-item
# integration tests can verify per-item ordering.
PROMPT="${@: -1}"
ESCAPED=$(printf '%s' "$PROMPT" | python3 -c 'import json,sys; sys.stdout.write(json.dumps(sys.stdin.read()))')
cat <<EOF
{"type":"result","subtype":"success","result":${ESCAPED},"model":"claude-sonnet-4-6","stop_reason":"end_turn","usage":{"input_tokens":3,"output_tokens":7},"session_id":"stub-session"}
EOF
exit 0
