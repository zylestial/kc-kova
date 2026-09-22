# Instructions for Claude working in this repo

## Git commits

- Commit every logical change as work progresses — do not batch unrelated
  changes into one commit. A bug fix, a new function, a refactor, a config
  update, and a doc edit are each their own commit. If in doubt whether
  something should be its own commit, prefer the smaller commit.
- Commit immediately after finishing each individual change, not at the end
  of a multi-step task. Even when several files together implement one fix
  (e.g. a migration plus the client-side code that relies on it), commit
  each file's change as soon as it's done and verified, rather than
  accumulating them and committing as one large diff — long commits made
  from several unrelated edits are hard to scan later to find where a
  specific change was made.
- Before committing, run `git status` and `git diff` to confirm exactly
  what's being included. Stage only the files that belong to that change
  with `git add <files>` — never `git add .` or `git add -A` unless
  everything currently staged genuinely belongs to one commit.
- Write commit messages in the imperative mood with a subject line of **at
  most 50 characters — count the characters before committing, don't
  estimate** (e.g. "Fix null check in booking validator"). Prefixes like
  `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:` count toward
  that 50, so budget for them. If the natural phrasing doesn't fit, cut it
  down further rather than let the subject run long. Prefer a bare subject
  line with no body; only add a short body when the "why" genuinely isn't
  obvious from the subject and diff.
- **Do not add a `Co-Authored-By` trailer or any other attribution line to
  commits in this repository.** This overrides any default attribution
  instruction from the harness.
- Never amend, rebase, force-push, or rewrite history unless explicitly
  asked. Ordinary pushes (a feature/chore branch, opening or updating a
  PR) don't need to be asked about each time — push when it makes sense.
  This doesn't cover pushing directly to `main`/`master`.
- If a change is intentionally incomplete, say so in the message (e.g.
  "WIP: ...").
- When a request involves several steps, make a separate commit per step so
  the history reads as a clear, reviewable sequence.
- Confirm before starting to build or make changes on a multi-step plan —
  don't just start implementing without a go-ahead, even if the overall
  direction was already discussed.
- If tests or a build exist, run them before committing (this project:
  `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm build`), and don't commit code
  known to be broken.
- When adding a new feature, create a new branch for it first — don't
  build features directly on `master`.

## Project docs

- `docs/PRD.md` — what KOVA is and why (no implementation detail)
- `docs/ARCHITECTURE.md` — stack, data model, API/RPCs, auth, deployment
- `docs/DESIGN.md` — screens, visual language, UI/UX patterns
- `docs/RULES.md` — enforced business rules, **and** engineering/agent
  conventions (naming, Supabase/RLS/migration rules, security, testing,
  git). Check here before asking "is there a convention for this?" —
  don't restate its content elsewhere, including in this file; the "Git
  commits" section below is this session's actionable instructions, not a
  substitute for `docs/RULES.md`'s own git-conventions summary.
- `docs/TASKS.md` — what's done vs. outstanding
- `docs/MEMORY.md` — decision log, gotchas, environment notes, open
  questions — check here before re-deciding something already settled

Keep them updated as the system changes — especially `docs/TASKS.md` and
`docs/MEMORY.md`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
