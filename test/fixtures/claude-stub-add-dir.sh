#!/usr/bin/env bash
# Stub: extracts --add-dir from argv, lists files in that directory, returns
# them in the JSON result so tests can verify attachment staging.
ADD_DIR=""
for ((i=1; i<=$#; i++)); do
  arg="${!i}"
  if [[ "$arg" == "--add-dir" ]]; then
    j=$((i+1))
    ADD_DIR="${!j}"
    break
  fi
done

if [[ -n "$ADD_DIR" && -d "$ADD_DIR" ]]; then
  FILES_JSON=$(ls -1 "$ADD_DIR" | python3 -c 'import sys,json; sys.stdout.write(json.dumps(sys.stdin.read().splitlines()))')
else
  FILES_JSON='[]'
fi

cat <<EOF
{"type":"result","subtype":"success","result":"staged","model":"echo","stop_reason":"end_turn","add_dir":"$ADD_DIR","files":${FILES_JSON}}
EOF
exit 0
