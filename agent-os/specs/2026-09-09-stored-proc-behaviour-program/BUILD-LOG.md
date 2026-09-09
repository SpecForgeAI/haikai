# Stored Proc & Function Behaviour Program — Build Log

## STATUS: SHAPED 2026-09-09 — awaiting the owner's explicit build go

Design of record:
`agent-os/planning/2026-09-09-stored-proc-behaviour-baseline-shaping.md`
(read FIRST: doctrine, the 20 owner-confirmed decisions, out-by-decision
list, build assumptions). Specs in this folder:

| # | Spec | Size | Depends on | Status |
|---|------|------|------------|--------|
| 1 | Routine catalog + static profile | M | — | shaped |
| 2 | Invocation surface + descriptor | L | 1 | shaped |
| 3 | Proc behaviour capture | L | 1, 2 (Sybase side) | shaped |
| 4 | Translation workbench loop | L | 1, 2 (Postgres side), 3 | shaped |
| 5 | Execution integration | M | 4 | shaped |

Build order 1 → 2 → 3 → 4 → 5 (2 and 3 may overlap once 1's entity
exists). One commit per spec on `feature/stored-proc-behaviour-program`;
--no-ff merge to main at the end; push.

Build conventions (standing): direct implementation with the agent-os trail
kept; anchored edits only (never bulk-rewrite files); verify failing suites
against a baseline worktree before touching them; pre-existing reds listed
in the shaping doc stay untouched; never write client-derived tokens.

### Work-machine pickup (clone + copy convention — big change ⇒ FRESH CLONE)

To be completed per spec at build time. Expected shape:
1. AMS REBUILD — changesets 229 (routines), 230 (proc behaviour), 231
   (workbench/parity) apply on boot.
2. REBUILD the sybase-discovery-sidecar jar (`/call` + guard) and restart
   it bare (no Docker on the work machine).
3. Restart discovery-service, AMVS, gateway, frontend. New env knobs (all
   optional, defaults in the shaping doc): PROC_CALL_SESSION_SET,
   PROC_CALL_MAX_ROWS_PER_RESULT_SET, PROC_LLM_ATTEMPTS_PER_ROUTINE,
   PROC_TRANSLATE_ATTEMPT_CAP, PROC_TRANSLATE_CONCURRENCY,
   PROC_TRANSLATE_EVIDENCE_LADDER, SCL_PROC_CLOSURE_MAX_DEPTH.
4. FIRST OPERATIONAL STEPS: re-run the DB scan (routine catalog + S0) →
   Live behaviour → "Stored procs and functions" capture → pin → pack
   Translations tab → Build target → Translate & reconcile all.

### Shakedown checklist (live) — to be filled at build time

### Per-spec notes — to be filled at build time
