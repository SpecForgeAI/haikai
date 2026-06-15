-- 186-work-item-provenance.sql
-- Spec: D5 -- Net-new backlog items + provenance (2026-06-14, Spec 5 of 6)
--       -- Task Group 1
--
-- Adds the provenance marker to every work item so the migration owner can
-- distinguish like-for-like carry_over work (the default; must match
-- current-state) from genuinely-additive net_new work (deliberately OUTSIDE the
-- like-for-like envelope). D5 only SETS the marker; the reconcile consumer
-- (program D6) reads it.
--
--   work_item (1 new column):
--     - provenance  VARCHAR NOT NULL DEFAULT 'carry_over' -- {carry_over, net_new}.
--       The 'carry_over' default means EVERY existing/discovered row is already
--       correct with NO backfill (every discovered item IS like-for-like). The
--       allowed values are validated at the service/DTO layer (the column stays a
--       plain VARCHAR -- no DB enum/CHECK, matching the AMS status-as-string
--       convention). The column is authoritative AND column-only: dispatch
--       ignores it; D6's reconcile reads rows directly. No blob mirror unless the
--       reconcile-shaping spec surfaces a need.
--
-- Modelled EXACTLY on the deferred column (changeset 182): a NOT NULL column
-- with a DB DEFAULT, mirrored by an @PrePersist default + a null-guarded PATCH
-- on the Java side per project_primitive_double_dto_overwrite.md, so a builder
-- that omits provenance still inserts 'carry_over' and a PATCH that omits it
-- never wipes the column. Boxed-friendly (String is a reference type by nature).
--
-- NEW changeset only -- never edit applied changesets (<= 185) per
-- feedback_liquibase_immutable_changesets.md. 185 (185-work-item-source-
-- capability-id.sql, D4) is the highest on disk; its header already reserves 186
-- for D5. This registers AFTER it in db.changelog-master.yaml. Column-only ALTER
-- -> the not-columnExists precondition idiom (mirrors 185 / 046-work-item-
-- external-url).

ALTER TABLE work_item ADD COLUMN provenance VARCHAR NOT NULL DEFAULT 'carry_over';

COMMENT ON COLUMN work_item.provenance IS
  'Like-for-like provenance marker: carry_over (default -- must match current-state) | net_new (additive, deliberately outside the like-for-like envelope). The carry_over default means every existing/discovered row is correct with NO backfill. Allowed values validated at the service/DTO layer (plain VARCHAR, no DB enum). Column-authoritative + column-only: dispatch ignores it; the D6 reconcile consumer reads rows directly. Boxed-friendly / null-guarded PATCH on the Java side. Spec: D5 -- Net-new backlog items + provenance (2026-06-14, Spec 5 of 6).';
