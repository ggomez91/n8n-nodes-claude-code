#!/usr/bin/env bash
# Stub: emits the argv as JSON so tests can verify what flags the runner constructed.
ARGS_JSON=$(printf '%s\n' "$@" | python3 -c 'import sys,json; sys.stdout.write(json.dumps(sys.stdin.read().splitlines()))')
cat <<EOF
{"type":"result","subtype":"success","result":"ok","model":"echo","stop_reason":"end_turn","args":${ARGS_JSON}}
EOF
exit 0
