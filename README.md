# KOVA

Kayelen's Operations and Vehicle Allocation — an internal fleet booking and
trip-logging system. It does not include demo accounts, browser-only
records, fake passwords, or role-preview shortcuts.

This is a single Next.js app that serves **both** the frontend and its own
backend: screens (`app/*.tsx`) talk only to this app's own API routes
(`app/api/**/route.ts` via `lib/kova-api.ts`), and those routes are the only
code that talks to Supabase (Postgres + Auth + Row Level Security). See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full request-flow
diagram and [docs/PRD.md](docs/PRD.md) for what the product does and why.

## Requirements

- Node.js 22.13 or newer
- pnpm 11
- A Supabase project — either a real one (supabase.com) or a local one via
  [Docker](https://www.docker.com/products/docker-desktop/) + the
  [Supabase CLI](https://supabase.com/docs/guides/cli/getting-started)
  (`npm install -g supabase`)

## Setup

1. Install dependencies: `pnpm install`.
2. Copy `.env.example` to `.env.local`.
3. Get Supabase credentials and put them in `.env.local`:
   - **Local Supabase (recommended for development):** with Docker running,
     run `supabase start` from the repo root (`supabase/config.toml` is
     already committed, so no `supabase init` is needed). This applies
     every migration in `supabase/migrations/` to a fresh local Postgres
     instance and prints a `NEXT_PUBLIC_SUPABASE_URL`/
     `NEXT_PUBLIC_SUPABASE_ANON_KEY`/`SERVICE_ROLE_KEY` (use as
     `SUPABASE_SERVICE_ROLE_KEY`) — copy those into `.env.local`. Studio
     (a local dashboard) runs at the printed `STUDIO_URL`
     (`http://127.0.0.1:54323` by default). Stop it later with
     `supabase stop`.
   - **A real Supabase project:** create one at supabase.com, then copy
     `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`/
     `SUPABASE_SERVICE_ROLE_KEY` from its **Project Settings → API** page
     into `.env.local`, and apply the schema with
     `supabase link --project-ref <ref>` then `supabase db push`.
4. Leave `NEXT_PUBLIC_KOVA_API_BASE_URL` blank — this app serves its own
   API from the same origin, so it's only needed if you're pointing the
   frontend at a KOVA API hosted elsewhere.
5. Every account is provisioned by an Admin — there's no public sign-up and
   no seed data. To get a first Admin account on a fresh database, run
   `node scripts/create-admin.mjs`: it asks for a username, name and
   password and refuses to run once an Admin exists. It uses the URL and
   service-role key from `.env.local`; to target another project (e.g.
   production), set `NEXT_PUBLIC_SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` in the shell first.
6. Start the dev server: `pnpm dev`.

## Running and testing

| Command | What it does |
| --- | --- |
| `pnpm dev` | Start the dev server (Turbopack) |
| `pnpm build` | Production build |
| `pnpm start` | Run a production build |
| `pnpm lint` | ESLint |
| `pnpm exec tsc --noEmit` | Type-check |
| `pnpm test` | Run the Vitest unit test suite |

Run `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, and `pnpm build`
before committing — the same checks CI (`.github/workflows/ci.yml`) runs on
every push and pull request.

## Security boundary

The frontend mirrors permissions only for the user experience. This app's
own backend (not an external one) authenticates every request and enforces
roles, booking ownership, Vehicle and Driver conflicts, submitted-record
locks, and Admin-only Finance/PDF actions, via a combination of Row Level
Security policies and route-level checks — see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#authorization-two-enforcement-layers)
and [docs/RULES.md](docs/RULES.md). Passwords are hashed by Supabase Auth
and never returned by this app's own code.

## More docs

- [docs/PRD.md](docs/PRD.md) — what KOVA is and why
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — stack, data model, API, auth, deployment
- [docs/DESIGN.md](docs/DESIGN.md) — screens, visual language, UI patterns
- [docs/RULES.md](docs/RULES.md) — business rules plus engineering/agent conventions
- [docs/roles/README.md](docs/roles/README.md) — consolidated role guide for Requesters, Schedulers, Admins, and Drivers
- [docs/roles/admin-guide.md](docs/roles/admin-guide.md) — single combined workflow from Admin setup through Driver completion
- [docs/TASKS.md](docs/TASKS.md) — what's done vs. outstanding
- [docs/MEMORY.md](docs/MEMORY.md) — decision log, gotchas, open questions
- [docs/archive/](docs/archive/) — history: the older decision log and task history, the v2.0 plan and phase notes, and the original API contract
