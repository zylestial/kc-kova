#!/usr/bin/env bash
# Dumps the database (roles, schema, data and migration history, the way
# Supabase's own backup guide does) into one encrypted file. Run nightly by
# .github/workflows/backup.yml; restore with docs/BACKUPS.md.
#
# Usage: SUPABASE_DB_URL=... BACKUP_PASSPHRASE=... scripts/backup-db.sh <out-dir>
# SUPABASE_DB_URL must be percent-encoded. Set SUPABASE to the CLI command
# when it isn't on PATH (e.g. SUPABASE="pnpm exec supabase").
set -euo pipefail

out="${1:?usage: scripts/backup-db.sh <out-dir>}"
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is not set}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is not set}"
supabase=${SUPABASE:-supabase}

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

$supabase db dump --db-url "$SUPABASE_DB_URL" -f "$work/roles.sql" --role-only
$supabase db dump --db-url "$SUPABASE_DB_URL" -f "$work/schema.sql"
# Data is KOVA's tables and the sign-in accounts. KOVA keeps no files in
# Storage, and Supabase's own schemas come with every new project.
$supabase db dump --db-url "$SUPABASE_DB_URL" -f "$work/data.sql" --use-copy --data-only --schema public,auth
$supabase db dump --db-url "$SUPABASE_DB_URL" -f "$work/history.sql" --use-copy --data-only --schema supabase_migrations

# A dump that ran but came back empty must fail, not be uploaded as a backup.
for table in '"public"."accounts"' '"auth"."users"'; do
  grep -q "^COPY $table " "$work/data.sql" || { echo "data.sql has no $table" >&2; exit 1; }
done
grep -q '^COPY "supabase_migrations"."schema_migrations" ' "$work/history.sql" || { echo "history.sql has no migrations" >&2; exit 1; }

mkdir -p "$out"
file="$out/kova-$(date -u +%Y-%m-%dT%H%MZ).tar.gz.gpg"
# The passphrase goes in on fd 3, so it never shows in the process list.
tar -czf - -C "$work" roles.sql schema.sql data.sql history.sql |
  gpg --batch --yes --pinentry-mode loopback --passphrase-fd 3 \
    --symmetric --cipher-algo AES256 --output "$file" 3<<<"$BACKUP_PASSPHRASE"
echo "$file"
