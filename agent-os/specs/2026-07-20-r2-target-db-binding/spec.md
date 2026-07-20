# Residual 2 — declared target-DB binding + Start-stage credentials

**Program:** Plan-screen unification residuals (2026-07-20). User inversion:
the plan CREATES the target database, so the plan DECLARES its coordinates and
supplies them to the operator — the operator confirms and provides only
SECRETS, never re-typing what the tool decided. Data parity is assumed to run
on the local machine; the spec that creates the target DB confirms the binding.

## FR1 — the binding is a pack artifact

`PackManifest.target_db` (generation-time): engine postgresql, host
`localhost`, port 5432, database `haikai_target`, schema `public`, username
`postgres`, + an explanatory note. NEVER carries credentials. Absent on
pre-binding packs (all consumers tolerate null).

## FR2 — the seed spec confirms it

The DB-pack carriage detects the story carrying the MASTER changelog (the
story that creates the database) and appends a "Target database (declared
binding)" section to its spec text — engine, JDBC URL, schema, username, and
the confirm-before-applying instruction. Other pack stories are unchanged.

## FR3 — status endpoint (presence + coordinates, never secrets)

`GET /api/v1/projects/:projectId/migration-credentials-status?architectureId&runId`
returns `{ target_binding, source: {registered + non-secret coords},
target_registered }` from the pack manifest + the two in-memory stores.
Passwords never ride this endpoint.

## FR4 — Start-stage dialog on the rail

Start opens a confirm dialog: target coordinates PREFILLED from the binding
(editable for genuine environment differences), password field only; source-DB
status line (registered ✓ with coordinates / pointer to the drift-watch
registration). Confirm = triggerMigrate → on 202 register the target-DB
secrets against the new runId (in-memory, per-run). Blank password = explicit
skip (data load + parity fail-soft; approval gate blocks — Spec W semantics).
The DB card shows `target DB creds: registered ✓ / NOT registered` while a run
is active with a **Provide credentials…** re-registration path (covers the
in-memory store being dropped by a gateway restart).

## Verification

Gateway: manifest binding + no-secrets assertions; carriage seed-spec
confirmation both ways. Frontend: dialog prefill-from-binding, confirm →
trigger + register-with-runId. All green.
