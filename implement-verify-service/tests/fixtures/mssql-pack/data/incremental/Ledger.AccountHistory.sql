-- Incremental top-up: Ledger.AccountHistory
-- Delta key: n/a (full reload) | strategy: full_reload | chosen by: resolved_decision
-- Parameterised by :last_high_water — the prior run's max load marker value.
-- Phase 5 of 5: increments execute WITH foreign keys and indexes enforced.
-- DELETE propagation is OUT OF SCOPE for incremental v1: incremental scripts insert and/or update only. Rows deleted at source after the bulk load are NOT removed by increments — tables configured for full reload each increment are the mechanism that catches deletes.

-- Full reload each increment (this is the delete-catching mechanism for this table):
TRUNCATE TABLE "Ledger"."AccountHistory" CASCADE;
-- Re-run the bulk extract + COPY for Ledger.AccountHistory (see the bulk script).
