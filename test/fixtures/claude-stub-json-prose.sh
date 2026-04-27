#!/usr/bin/env bash
# Stub: returns prose (no JSON) as Claude's response — to test json-mode failure.
cat <<'EOF'
{"type":"result","subtype":"success","result":"I'm sorry, I can't produce that as JSON.","model":"claude-sonnet-4-6","stop_reason":"end_turn","usage":{"input_tokens":3,"output_tokens":12},"session_id":"stub-json-prose"}
EOF
exit 0
