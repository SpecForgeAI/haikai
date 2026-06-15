-- 185-work-item-source-capability-id.sql
-- Spec: D4 -- Carry-over Completeness Gate (2026-06-14, Spec 4 of 6) -- Task Group 1
--
-- Promotes D3's per-capability provenance link from a book_of_work_json blob
-- field to a real work_item COLUMN so the D4 carry_over completeness gate's
-- coverage query is an efficient structured JOIN (work_item.source_capability_id
-- == discovery_capability.id), not a per-Migrate blob re-parse.
--
--   work_item (1 new nullable column):
--     - source_capability_id  UUID NULL -- the discovery_capability this STORY
--       was minted to cite (D3's append-capability-story). NULL for every
--       ordinary (non-capability) work item. A capability is "cited-by-story"
--       iff a work_item exists with source_capability_id == capability.id (D8).
--       Boxed UUID on the Java side per project_primitive_double_dto_overwrite.md
--       so a PATCH that omits it never wipes the column; null-guarded in
--       WorkItemMapper.updateEntityFromDto (absent on update = unchanged).
--
-- D3->D4 handoff: D3 stamps the book_of_work_json blob (stays changeset-free);
-- D4 ADDS this column AND updates D3's appendCapabilityStory to ALSO write it,
-- so BOTH the blob (D3) and the column (D4's gate join) carry the provenance.
-- The finding side reuses discoveryFindingReferences on blob items as-is -- no
-- change. Dismissal reuses the string-typed review_status / reviewerNotes -- NO
-- DDL for it; this changeset adds the single source_capability_id column and
-- NOTHING else (D10). D5 reserves changeset 186.
--
-- New nullable column, boxed reference type, no backfill: existing work_item
-- rows are untouched and read back with source_capability_id null. No
-- @PrePersist defaulting needed -- null is the valid empty state.
--
-- NEW changeset only -- never edit applied changesets (<= 184) per
-- feedback_liquibase_immutable_changesets.md. 184 (184-discovery-capability.sql)
-- is the highest on disk; this registers AFTER it in db.changelog-master.yaml.

ALTER TABLE work_item ADD COLUMN source_capability_id UUID NULL;

COMMENT ON COLUMN work_item.source_capability_id IS
  'The discovery_capability this STORY was minted to cite (D3 append-capability-story). NULL for ordinary (non-capability) work items. A capability is cited-by-story iff a work_item exists with source_capability_id == capability.id -- the D4 carry_over completeness gate joins on this column (D8). Boxed UUID / null-guarded PATCH on the Java side. Spec: D4 -- Carry-over Completeness Gate (2026-06-14, Spec 4 of 6).';
