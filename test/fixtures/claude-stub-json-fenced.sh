#!/usr/bin/env bash
# Stub: returns a fenced JSON object as Claude's response text.
cat <<'EOF'
{"type":"result","subtype":"success","result":"```json\n{\"x\":42,\"items\":[1,2,3]}\n```","model":"claude-sonnet-4-6","stop_reason":"end_turn","usage":{"input_tokens":3,"output_tokens":7},"session_id":"stub-json-fenced"}
EOF
exit 0
