# Database backups

Every night at 2:00 AM (Manila) the **Backup** GitHub Action
(`.github/workflows/backup.yml`) copies the production database into one
encrypted file and uploads it to the company's Google Drive
(kayelens.kova@gmail.com), in the folder **KOVA backups**. Files older than
30 days are deleted, but only after that night's copy is up. Each file is a
few MB.

A file is named `kova-<date>T<time>Z.tar.gz.gpg` (UTC). Inside are four
files from `scripts/backup-db.sh`, made the way Supabase's own backup guide
makes them:

| File | What it holds |
| --- | --- |
| `roles.sql` | Settings on the database roles |
| `schema.sql` | Every table, function, policy and trigger |
| `data.sql` | Every row in KOVA's tables (`public`) and the sign-in accounts (`auth`) |
| `history.sql` | Which migrations have been applied |

**Not in the backup**, and to be set again by hand on a new project: the
Vercel environment variables, the Supabase dashboard settings (Auth, SMTP,
URL configuration) and the two Vault secrets for Push (`push_send_url`,
`push_send_secret`; see migration 0070). KOVA keeps no files in Supabase
Storage, so there's nothing there to lose.

## Without the password a backup is useless

Files are encrypted with `BACKUP_PASSPHRASE`. Keep that password somewhere
the company owns (for example the company Gmail's Google Password Manager),
not only in GitHub, where a secret can be replaced but never read back.

## Setup (once)

GitHub needs three repository secrets (Settings → Secrets and variables →
Actions, or `gh secret set NAME`, which asks for the value):

1. **`SUPABASE_DB_URL`**: Supabase dashboard → **Connect** → **Session
   pooler** (GitHub's machines can't reach the direct connection). It looks
   like `postgresql://postgres.<project-ref>:<password>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`.
   Percent-encode the password if it has symbols (`@` → `%40`, `#` → `%23`,
   and so on). If no one knows the database password, reset it under Project
   Settings → Database; the app doesn't use it, only the Supabase CLI does.
2. **`BACKUP_PASSPHRASE`**: a long password you choose (see above).
3. **`GDRIVE_TOKEN`**: on any computer, install rclone
   (`winget install Rclone.Rclone`) and run
   `rclone authorize "drive" "eyJzY29wZSI6ImRyaXZlLmZpbGUifQ=="`.
   Sign in as **kayelens.kova@gmail.com**. rclone prints a token, the JSON
   in braces `{...}`; that whole line is the secret. The argument limits the
   token to files rclone itself creates, so it can't read anything else in
   the Drive.

Then run it once by hand: GitHub → **Actions** → **Backup** → **Run
workflow**. The file should appear in Drive under **KOVA backups**.

## Keeping it running

- **A failed night emails the person who last edited the workflow** (GitHub's
  default for scheduled runs). Check Actions → Backup when that happens.
- **GitHub turns off scheduled workflows in a public repo after 60 days with
  no commits.** If KOVA goes quiet, open Actions → Backup and turn it back
  on, or the backups simply stop.
- **When the repo moves to the company's GitHub account**, add the three
  secrets again there; secrets don't move with a repo.

## Restoring

Restore into a **new, empty** Supabase project, never on top of the live
one. Doing it on the live database would mix two copies of every row.

You need: the backup file, the password, the new project's Session pooler
URL (as above), and `psql`, the PostgreSQL 17 client. On Windows, run these
in Git Bash; `gpg` and `tar` come with Git for Windows.

```bash
# 1. Decrypt and unpack (asks for the password)
gpg --decrypt kova-2026-10-27T1800Z.tar.gz.gpg | tar -xzf -

# 2. Role settings. An error here only means the new project already has that
#    setting (e.g. "permission denied for parameter ..."); carry on.
psql "$NEW_DB_URL" -f roles.sql

# 3. Schema and data, all or nothing. Triggers are off while the rows load,
#    so nothing fires twice and the circular schedule links load cleanly.
psql "$NEW_DB_URL" --single-transaction -v ON_ERROR_STOP=1 \
  -f schema.sql \
  -c 'SET session_replication_role = replica' \
  -f data.sql

# 4. Migration history, so `supabase db push` knows what's already applied
psql "$NEW_DB_URL" -v ON_ERROR_STOP=1 \
  -c 'create schema if not exists supabase_migrations;
      create table if not exists supabase_migrations.schema_migrations
        (version text primary key, statements text[], name text);' \
  -f history.sql
```

Then point KOVA at the new project: in Vercel, replace
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` with the new project's values and redeploy. Set
the dashboard settings and the Push Vault secrets again (see "Not in the
backup"), and run `supabase link --project-ref <new ref>`. Everyone signs
in with their usual username and password; sessions from the old project
end.

**Tested 2026-10-27**: a backup of local Supabase restored this way into a
fresh Supabase with production's versions. All 57 tables matched row for
row, and an account signed in with its password.
