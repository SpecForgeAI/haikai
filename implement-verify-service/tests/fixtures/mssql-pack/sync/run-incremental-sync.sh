#!/usr/bin/env bash
# sync/run-incremental-sync.sh — DAILY one-way incremental sync (source -> shadow target).
#
# Side-by-side operating model: after the initial weekend bulk load the
# target runs as a SHADOW. This runner tops it up once a day until
# swap-over. ONE-WAY only — never write back to the source.
#
# EXECUTION MODEL (2026-08-07 — replaces the old comment-stub runner that
# executed NOTHING): the sync is AMVS-DRIVEN. The gateway endpoint below
# dispatches the real capability — keyed keyset deltas STRICTLY ABOVE the
# stored high-water (haikai_sync_state on the TARGET) are UPSERTed
# (insert_only -> ON CONFLICT DO NOTHING; insert_update -> DO UPDATE),
# full_reload tables truncate+reload, and pk-diff delete propagation is a
# bounded per-table opt-in (delete_modes in the request body). Credentials
# come from the gateway's registered stores — NEVER from this script.
#
# Environment (set all before running):
#   GATEWAY_BASE_URL — e.g. http://localhost:8081
#   PROJECT_ID       — the workspace project UUID
#   RUN_ID           — the migration execution run whose registered
#                      source/target DB credentials the gateway holds
#                      (register at Migrate confirm / baseline drift watch)
#
# Exit codes: 0 = sync clean; 2 = attention (errors / open decisions /
#             dispatch refused) — inspect the printed report.

set -euo pipefail
: "${GATEWAY_BASE_URL:?GATEWAY_BASE_URL must be set}"
: "${PROJECT_ID:?PROJECT_ID must be set}"
: "${RUN_ID:?RUN_ID must be set}"

resp="$(curl -sS -X POST \
  "${GATEWAY_BASE_URL}/api/v1/projects/${PROJECT_ID}/migration-execution-runs/${RUN_ID}/run-incremental-sync" \
  -H 'Content-Type: application/json' -d '{}')"
echo "${resp}"
status="$(printf '%s' "${resp}" | sed -n 's/.*"status":"\([a-z_]*\)".*/\1/p' | head -1)"
if [ "${status}" = "clean" ]; then
  echo "sync CLEAN"
  exit 0
fi
echo "sync ATTENTION (status=${status:-unknown}) — see the report above"
exit 2

# ---------------------------------------------------------------------
# Per-table posture at pack-generation time (the LIVE truth is the
# manifest's sync.tables section + the run report):
#   keyed tables (1):
#     Ops.SensorArchive  key=SensorArchiveID  insert_only
#   full-reload tables (3) — the delete-catching mechanism:
#     Ledger.Account
#     Ledger.AccountHistory
#     Ledger.Postings
#
# Reference SQL for a manual audit: reconcile/reconciliation.sql +
# reconcile/build-report.sh; the state table DDL is sync/000-sync-state.sql
# (the AMVS runner creates it automatically when absent).
