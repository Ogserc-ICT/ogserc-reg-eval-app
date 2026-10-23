#!/bin/sh
# Restore an encrypted backup into a database on the same server.
#
#   restore.sh <backup file> <database name>      e.g. restore.sh /backups/daily/ogserc-….dump.enc ogserc_restore_test
#
# A database other than the live one is created if needed (use this for restore drills).
# Restoring over the live database ("ogserc") replaces everything in it: stop the app first and set
# RESTORE_CONFIRM=yes. See docs/DEPLOYMENT.md, "Backups".
set -eu
# Fail if any command in a pipeline fails (busybox ash supports this).
set -o pipefail
[ -f /etc/scheduler.env ] && . /etc/scheduler.env

usage="usage: restore.sh <backup file> <database name>"
FILE="${1:?$usage}"
NAME="${2:?$usage}"
[ -f "$FILE" ] || { echo "No such file: $FILE" >&2; exit 1; }
case "$NAME" in
  *[!a-z0-9_]* | "") echo "Database name may contain only a-z, 0-9 and _" >&2; exit 1 ;;
esac

# The database URL for libpq: Prisma's "schema" parameter removed, others (e.g. sslmode) kept.
pg_url() { printf '%s' "$1" | sed -E 's/([?&])schema=[^&]*(&|$)/\1/; s/[?&]$//'; }
LIVE_URL="$(pg_url "$DATABASE_URL")"
case "$LIVE_URL" in *\?*) QUERY="?${LIVE_URL#*\?}" ;; *) QUERY="" ;; esac
LIVE_BASE="${LIVE_URL%%\?*}"
LIVE_NAME="${LIVE_BASE##*/}"
SERVER_URL="${LIVE_BASE%/*}"
TARGET_URL="$SERVER_URL/$NAME$QUERY"
MAINTENANCE_URL="$SERVER_URL/postgres$QUERY"

if [ "$NAME" = "$LIVE_NAME" ]; then
  if [ "${RESTORE_CONFIRM:-}" != "yes" ]; then
    echo "This would replace the LIVE database. Stop the app, then re-run with RESTORE_CONFIRM=yes." >&2
    exit 1
  fi
elif ! psql -w -tA -c "SELECT 1 FROM pg_database WHERE datname = '$NAME'" "$MAINTENANCE_URL" \
  | grep -q 1; then
  createdb -w --maintenance-db="$MAINTENANCE_URL" "$NAME"
  echo "Created database $NAME"
fi

openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$FILE" \
  | pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction \
    --dbname="$TARGET_URL"
echo "Restored $FILE into $NAME"
