#!/usr/bin/env bash
# Sleeps and IGNORES SIGTERM to force the runner to escalate to SIGKILL.
trap '' TERM
sleep 30
