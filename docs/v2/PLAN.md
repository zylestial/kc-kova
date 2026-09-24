# KOVA v2.0 — Phased implementation plan

Source of truth for the v1.2 → v2.0 upgrade, provided by the project owner
and adopted as-is on 2026-09-24. This upgrades the **same** repository,
Vercel project and production database in place — no new repo, no second
production database, no new hosting project.

Full phase-by-phase plan (roles, workflow, data model, migration and
rollback rules): see `KOVA-v2-Claude-Implementation-Plan.md` in the repo
root, which this file defers to verbatim. Do not duplicate its content here
as it changes — this file exists so `docs/TASKS.md`/`docs/MEMORY.md` have a
stable `docs/v2/` anchor to link to, per this repo's documentation
conventions (see `docs/RULES.md`).

## Process rules that apply to every phase

- Ask **"May I start Phase N?"** before starting each phase, including
  Phase 0. Approval covers that phase only.
- After each phase: report what changed, what was removed and why, tests
  and results, and unresolved issues — then propose the next phase and wait.
- If scope conflicts with existing behavior, data rules or documents: stop
  the affected work, explain the clash with a concrete example and options,
  and ask which behavior to use. Record the decision in `docs/MEMORY.md`.
- Repository cleanup is inventoried in Phase 0, approved per-phase, and
  performed only after its replacement works — never an unreviewed mass
  deletion.
- No production data migration, live traffic switch, or production
  database/schema change without separate, explicit release approval.

## Phase list

| Phase | Scope | Deliverable |
|---|---|---|
| 0 | Inspect v1.2, verify reported behavior, cleanup inventory, conflict list | `docs/v2/baseline.md` |
| 1 | Git protection: tag `v1.2-stable`, `v1-maintenance`, `v2-development`, feature branches | `docs/v2/git-and-release.md` |
| 2 | Reuse existing Vercel project + database; preview isolation; backups | environment map |
| 3 | DB model, permissions, state transitions; full `requester` role migration | migrations + permission matrix |
| 4 | Requester/Admin request creation | — |
| 5 | Scheduler planning + Trip Record | — |
| 6 | Approval, revisions, publication | — |
| 7 | Cancellation and request unlocking | — |
| 8 | Driver completion + problem reporting | — |
| 9 | Admin finished trips and printing | — |
| 10 | End-to-end validation + migration rehearsal | — |
| 11 | Release through the same Vercel project | `docs/v2/cutover-runbook.md`, `rollback-runbook.md` |
| 12 | Stabilize and hand over | — |

## Status

Phase 0 proposed 2026-09-24, pending owner approval. No phase has started.
