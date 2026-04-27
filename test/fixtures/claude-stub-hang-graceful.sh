#!/usr/bin/env bash
# Sleeps forever but exits cleanly on SIGTERM (the graceful case).
trap 'exit 143' TERM
sleep 30 &
wait $!
