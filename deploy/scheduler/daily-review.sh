#!/bin/sh
# SPEC §4.10: run the daily review in the app (retries cover a restart in progress).
set -eu
[ -f /etc/scheduler.env ] && . /etc/scheduler.env
# Assigned first so a failed request fails the job (inside echo "$(…)" it would be hidden).
result="$(
  curl -fsS --retry 5 --retry-delay 30 --retry-all-errors --max-time 300 -X POST \
    -H "Authorization: Bearer ${CRON_SECRET}" \
    "${APP_INTERNAL_URL:-http://app:3000}/api/cron/daily-review"
)"
echo "[daily-review $(date '+%Y-%m-%d %H:%M:%S')] ${result}"
