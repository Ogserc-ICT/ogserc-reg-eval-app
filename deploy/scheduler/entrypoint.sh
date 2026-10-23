#!/bin/sh
# Cron jobs do not inherit the container's environment, so save what they need to a private file.
set -eu
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is required}"
: "${CRON_SECRET:?CRON_SECRET is required}"
if [ "${#BACKUP_PASSPHRASE}" -lt 20 ]; then
  echo "BACKUP_PASSPHRASE must be at least 20 characters" >&2
  exit 1
fi
umask 077
# `export -p` prints each variable already quoted for the shell.
export -p | grep -E '^export (DATABASE_URL|CRON_SECRET|BACKUP_|RCLONE_|TZ)' > /etc/scheduler.env
mkdir -p /backups/daily /backups/weekly
echo "Scheduler started: daily review 06:00, backup 02:30 (Africa/Lagos)."
[ -n "${RCLONE_REMOTE:-}" ] && echo "Off-site copies go to ${RCLONE_REMOTE}." \
  || echo "WARNING: RCLONE_REMOTE is not set; backups stay on this server only."
exec crond -f -l 8
