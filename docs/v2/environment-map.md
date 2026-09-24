# KOVA v2.0 — Environment map (Phase 2)

Verified directly against the live Vercel project via the Vercel CLI
(logged in as `zylestial`, project `zyha/kc-kova`) and the already-linked
local Supabase CLI (`supabase/.temp/project-ref` = `rhzqdtgruhpdhopkksuf`,
matching `docs/MEMORY.md`'s prior record — now independently confirmed,
not just carried over from a previous session's claim).

## Vercel project — `kc-kova`

| Setting | Value |
|---|---|
| Project ID | `prj_E7AJFvFqQTZ5pFxVgG7jiIWt8uUt` |
| Org/team | `zyha` (`team_WiNsLjdeMSmKDueCaEGjjuuQ`) |
| Framework preset | Next.js (correctly detected) |
| Build/Install command | Framework defaults (`next build`, package-manager auto-detect) |
| Root directory | `.` |
| Node.js version | 24.x |
| Region | `iad1`, no failover regions |
| Custom domains | **None** — served only at `kc-kova.vercel.app` and per-deployment preview subdomains |
| Git integration | Connected — every push produces a deployment; `master` pushes deploy to **Production**, all other branches/PRs deploy to **Preview** (confirmed from deployment history: 3 recent `Production` entries all correspond to `master` activity, all others `Preview`, including the `v1-maintenance`/`v2-development` pushes from Phase 1) |

## Environment variables (names and scopes only — no values read or printed)

| Variable | Scope | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **Production, Preview** | App-read (`lib/env.ts`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Production, Preview** | App-read |
| `SUPABASE_SERVICE_ROLE_KEY` | **Production, Preview** | App-read — **bypasses RLS entirely** (`lib/supabase/admin.ts`) |
| `NEXT_PUBLIC_KOVA_API_BASE_URL` | Production, Preview | App-read, normally blank |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_USER`, `POSTGRES_HOST`, `POSTGRES_PASSWORD`, `POSTGRES_DATABASE`, `SUPABASE_URL`, `SUPABASE_JWT_SECRET`, `SUPABASE_ANON_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | Production only | Auto-added by Vercel's native Supabase marketplace integration. **Not read anywhere in this app's code** (`lib/env.ts` only validates the three `NEXT_PUBLIC_SUPABASE_*`/`SUPABASE_SERVICE_ROLE_KEY` names) — likely dead integration scaffolding, not a functional risk, but a cleanup candidate to confirm and remove later (adds to the §5 cleanup inventory in `docs/v2/baseline.md`). |

## ⚠️ Finding: Preview deployments currently have full production write access

**This directly violates the plan's Phase 2 requirement** ("Preview must
not use live write credentials... If no isolated test database is
available, keep preview in clearly labelled demo/read-only mode").

Today, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and —
critically — `SUPABASE_SERVICE_ROLE_KEY` are all scoped to **both**
Production and Preview. That means:

- Every Preview deployment (every branch push, every PR, including the
  `v1-maintenance`/`v2-development` pushes made in Phase 1 of this v2
  effort) points at the **same live production Supabase project**
  (`rhzqdtgruhpdhopkksuf`) and holds the **same service-role key**, which
  bypasses Row Level Security entirely.
- Any code deployed to a Preview URL — including work-in-progress v2
  feature branches once they exist — can read and write real production
  data (accounts, bookings, vehicle records) with zero RLS protection, via
  the same code paths documented in `docs/ARCHITECTURE.md` (`app/api/
  accounts/**` auth user management, `app/api/records/**` vehicle-record
  writes).
- This is **not something introduced by this v2 effort** — it's how the
  project was already configured before Phase 0 started. It is, however,
  exactly the risk the plan's Phase 2 explicitly calls out to fix before
  v2 feature branches start generating Preview builds.

**Not changed yet.** Removing Preview scope from these variables is a
shared-infrastructure change (it would affect the *current* v1.2 Preview
behavior too, not just v2), so it needs your explicit call rather than a
unilateral fix inside "inspect the environment" work. Options, per the
plan's own guidance ("do not automatically create paid remote resources"):

1. **Remove Preview scope from `SUPABASE_SERVICE_ROLE_KEY` and the two
   `NEXT_PUBLIC_SUPABASE_*` vars now.** Preview deployments would then fail
   to reach Supabase at all (safe failure — no accidental prod writes) until
   an isolated test project or read-only mode is set up. Zero cost, but
   breaks whatever Preview currently does (worth checking if anyone relies
   on it before flipping this).
2. **Create a second, free-tier Supabase project for Preview/test data**,
   scope the Preview environment variables to point at it instead, and
   migrate `0001`–`0012` onto it. This is the "isolated test data source"
   the plan describes for the Preview row of its environment table. Costs
   nothing on Supabase's free tier but is a new resource, so flagging it
   rather than creating it unasked.
3. **Leave as-is for now, fix later** — riskier the longer it's a live
   gap, but avoids any change before you've seen this report.

Recommendation: (1) now (cheap, immediate, no new resources) followed by
(2) before any v2 feature branch actually needs to exercise real Supabase
behavior in Preview (Phase 4 onward) — flagging this as an open decision
rather than acting on it.

## Local disposable instance (migration rehearsal)

Docker + `supabase start` verified working end-to-end this session:

- `supabase start` brought up a fresh local Postgres + Auth + Storage
  stack (Studio at `http://127.0.0.1:54323`).
- `supabase db reset` applied all 12 existing migrations
  (`0001_init.sql` through `0012_vehicle_driver_assignment.sql`) cleanly,
  in order, to a disposable database — confirming the full current schema
  history still replays correctly before any new v2 migrations are added
  in Phase 3.
- `supabase stop` shut it down afterward; nothing was left running, no
  production connection was ever made during this check.

This satisfies the plan's "test migrations against a disposable local
instance" requirement for the schema as it exists today, and is the
harness Phase 3's new migrations will be rehearsed against.

## Backups

**Not performed this session.** Taking a real backup of the production
Supabase project (`supabase db dump --linked`) requires connecting to
production with real credentials — per `docs/RULES.md`'s prohibited-
approaches list ("always confirm with a human before touching
production"), this needs your explicit go-ahead even though a dump is
read-only, since it establishes a live connection to the production
database and (per `docs/MEMORY.md`'s prior incident) any output must never
be pasted into this chat. If you'd like this done now, say so and I'll run
it and save the dump to a local, gitignored path — never displayed inline.

## Gate check

- v1.2 remains live: unchanged, `master`/Production untouched. ✅
- No production database/provider move: none proposed or performed. ✅
- **"v2 previews cannot accidentally alter live data" — currently
  FAILS** for the reason above; this is the one Phase 2 gate not yet met,
  and needs your decision (see the finding) before it's safe to say v2
  feature-branch Preview builds are isolated from production.
