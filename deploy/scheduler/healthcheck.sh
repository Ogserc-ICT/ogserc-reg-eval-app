#!/bin/sh
# Unhealthy when cron is not running, or (after the first day) the last good backup is over 26 hours old.
pgrep crond > /dev/null || exit 1
LAST=/backups/LAST_SUCCESS
if [ -f "$LAST" ]; then
  [ $(( $(date +%s) - $(cat "$LAST") )) -lt 93600 ] || exit 1
fi
exit 0
