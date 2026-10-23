#!/bin/sh
# Nightly backup: pg_dump (custom format) → AES-256 encryption with BACKUP_PASSPHRASE → checked by
# decrypting and listing it → kept in /backups (daily, plus a weekly copy on Sundays) → copied off-site
# with rclone when RCLONE_REMOTE is set. Older copies beyond the retention counts are removed.
# Restore with restore.sh. Run by hand: docker compose exec scheduler backup.sh
set -eu
# Fail if any command in a pipeline fails (busybox ash supports this).
set -o pipefail
[ -f /etc/scheduler.env ] && . /etc/scheduler.env

BACKUPS="${BACKUP_ROOT:-/backups}"
KEEP_DAILY="${BACKUP_KEEP_DAILY:-14}"
KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY:-8}"
STAMP="$(date +%Y-%m-%d_%H%M%S)"
NAME="ogserc-${STAMP}.dump.enc"
mkdir -p "$BACKUPS/daily" "$BACKUPS/weekly"
FILE="$BACKUPS/daily/$NAME"
TMP="$FILE.partial"
trap 'rm -f "$TMP" "$TMP.dump"' EXIT

log() { echo "[backup $(date '+%Y-%m-%d %H:%M:%S')] $*"; }
# The database URL for libpq: Prisma's "schema" parameter removed, others (e.g. sslmode) kept.
pg_url() { printf '%s' "$1" | sed -E 's/([?&])schema=[^&]*(&|$)/\1/; s/[?&]$//'; }

log "Dumping the database"
pg_dump --format=custom --no-owner --no-privileges --dbname="$(pg_url "$DATABASE_URL")" \
  --file="$TMP.dump"
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE \
  -in "$TMP.dump" -out "$TMP"
rm -f "$TMP.dump"

# A backup that cannot be decrypted and read is no backup.
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$TMP" \
  | pg_restore --list > /dev/null
mv "$TMP" "$FILE"
log "Saved $FILE ($(wc -c < "$FILE") bytes)"

if [ "$(date +%u)" = "7" ]; then
  cp "$FILE" "$BACKUPS/weekly/$NAME"
  log "Weekly copy saved"
fi

prune() { # keep the newest $2 files in $1
  ls -1t "$1"/ogserc-*.dump.enc 2>/dev/null | tail -n +"$(($2 + 1))" | while read -r old; do
    rm -f "$old" && log "Removed old backup $old"
  done
}
prune "$BACKUPS/daily" "$KEEP_DAILY"
prune "$BACKUPS/weekly" "$KEEP_WEEKLY"

if [ -n "${RCLONE_REMOTE:-}" ]; then
  rclone copy --no-traverse "$FILE" "$RCLONE_REMOTE/daily/"
  [ -f "$BACKUPS/weekly/$NAME" ] && rclone copy --no-traverse "$FILE" "$RCLONE_REMOTE/weekly/"
  log "Copied off-site to $RCLONE_REMOTE"
else
  log "WARNING: no off-site copy (RCLONE_REMOTE not set)"
fi

date +%s > "$BACKUPS/LAST_SUCCESS"
log "Backup complete"
