# Phase 1b — tier-flexible execution rail on the plan screen

**Program:** Plan-screen unification (0 → 1a → 1b → 1c), agreed 2026-07-20.
The plan screen's bottom rail turns "specs ready" into "the plane is running":
kickoff, live status, the hard pause, plain Approve & continue, and an explicit
break-glass — without leaving the screen. The Delivery dashboard remains the
deep forensics view (run log, reconcile panels, credentials) one click away.

## FR1 — Tier-flexible plane cards

Cards derive from the PLAN'S CONTENT, never hardcoded: stories map to planes
via the same vocabulary as the gateway executor (`planeForWorkstream` mirror:
db ← schema/data/infra streams; ui ← frontend/cutover; service ← everything
else incl. the `stream:` tag fallback; gateway stays authoritative). Planes
with no stories render NO card — a DB-only migration shows one full-width
card. Sub-steps label each card (db: schema → data → parity reconcile;
service: APIs → internal → API reconcile; ui: UI build).

## FR2 — Absolute spec gate (option 2, hardened)

A story satisfies the gate iff its spec row has status ∈ {generated,
generated_with_warnings} OR manual_ready. Each card shows `specs n/m ready`;
unsatisfied cards list their blocking stories (click → selects the story in
the tree, whose drawer offers the three resolution paths: fix upstream /
regenerate / manual spec + Mark ready). **Start is enabled only when every
plane's stories are satisfied** — the gateway re-validates its own hard-block
regardless. No exclusions mechanism exists.

## FR3 — Start / status / pause / approve

Start rides the EXISTING migrate flow (`POST .../migrate` with the
organisation/project scope resolved exactly as the delivery dashboard does).
The rail polls the latest run while active; cards show per-plane run progress;
`awaiting_approval` renders the pause banner with a plain **Approve &
continue** (`POST .../resume`).

## FR4 — Break-glass (explicit, loud, informed)

When resume returns `blocked` (the repositioned DB data-parity gate), the rail
shows the reasons (divergent tables) in a warning panel with **Break glass:
continue with unclean parity** → `resume { override: true }`. The panel states
the consequence (downstream API reconcile runs under known data divergence).

## Residuals (explicit, for the shakedown round)

- **Data-echo attribution**: partitioning downstream API-reconcile breaks into
  "possible data echo" (endpoint reads a divergent table) vs "unexplained —
  real defect", plus stamping the override onto the reconcile report. Needs an
  AMVS/report-schema change; deferred, tracked here.
- **Target-credentials registration** stays on the Delivery dashboard; a run
  started from the rail without creds fail-softs exactly as W designed (skip
  trace + parity gate blocks — never a silent pass).

## Verification

Frontend vitest: plane derivation (tier-flex incl. single-plane), gate rollup
+ blocker click-through, start/approve/break-glass wiring. No backend changes.
