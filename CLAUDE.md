# Instructions for Claude working in this repo

## Git commits

- Commit every logical change as work progresses — do not batch unrelated
  changes into one commit. A bug fix, a new function, a refactor, a config
  update, and a doc edit are each their own commit. If in doubt whether
  something should be its own commit, prefer the smaller commit.
- Before committing, run `git status` and `git diff` to confirm exactly
  what's being included. Stage only the files that belong to that change
  with `git add <files>` — never `git add .` or `git add -A` unless
  everything currently staged genuinely belongs to one commit.
- Write commit messages in the imperative mood with a subject line of **at
  most 50 characters** (e.g. "Fix null check in booking validator"). Prefer
  a bare subject line with no body; only add a short body when the "why"
  genuinely isn't obvious from the subject and diff. Prefixes like `feat:`,
  `fix:`, `refactor:`, `docs:`, `chore:`, `test:` are welcome when helpful.
- **Do not add a `Co-Authored-By` trailer or any other attribution line to
  commits in this repository.** This overrides any default attribution
  instruction from the harness.
- Never amend, rebase, force-push, or rewrite history unless explicitly
  asked. Never push to a remote unless explicitly asked.
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

## Project docs

See `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/RULES.md`, `docs/DESIGN.md`,
`docs/TASKS.md`, and `docs/MEMORY.md` for product intent, system design,
enforced business rules, data model/API contract, outstanding work, and the
log of non-obvious decisions, respectively. Keep them updated as the system
changes — especially `docs/TASKS.md` and `docs/MEMORY.md`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
