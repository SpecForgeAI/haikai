-- 136-discovery-finding-links.sql
-- Spec: Discovery Findings / Evidence as a First-Class Discovery Concept
--       (2026-05-16) -- Task Group 1
--
-- Polymorphic link table tying a discovery_finding to 0..N supporting entities
-- (discovery_evidence, discovery_candidate, discovery_relationship,
-- discovery_cluster, discovery_decision_task, architecture_element). Target
-- identity is stored as a (target_type, target_id) pair rather than a hard FK
-- per target table so the schema stays single-table and pack-extensible.
--
-- D6 cascade plan:
--   1) finding_id -> ON DELETE CASCADE (declared inline below). When a finding
--      is deleted (directly OR transitively via a discovery_run cascade) its
--      link rows vanish with it.
--   2) Parent-side CASCADE from linkable tables (discovery_candidate,
--      discovery_decision_task, discovery_relationship, discovery_evidence,
--      discovery_cluster, architecture_element) to discovery_finding_links
--      is INTENTIONALLY NOT IMPLEMENTED here. Because target_id is TEXT-typed
--      and target_type is a discriminator string (polymorphic FK), Postgres
--      cannot express a single ON DELETE CASCADE rule covering all parent
--      tables. Implementing it would require either per-target trigger-based
--      cascade OR per-target FK columns (one nullable column per target type),
--      which is a structural change rather than a single-changeset SQL clause.
--      Deferred to follow-up changeset 137 if needed. In v1, the dominant
--      delete path is "delete the run -> cascade to children": discovery_run
--      delete cascades to discovery_findings (changeset 135), which cascades
--      to discovery_finding_links here. Standalone deletes of a candidate /
--      relationship / decision_task / evidence / cluster / architecture_element
--      WITHOUT also deleting the run will leave orphaned link rows; the
--      service-layer reads tolerate orphans by skipping unresolvable targets.
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable. This is a NEW changeset only; changesets <= 134 are not edited.
-- Per project_pg_deferrable_set_null_action.md: capture-and-restore flows
-- that re-INSERT a linkable parent under CASCADE would lose link rows. Findings
-- are NOT part of selective-copy today, so this is a forward-compat note.

CREATE TABLE discovery_finding_links (
  id           UUID PRIMARY KEY,
  finding_id   UUID NOT NULL,
  link_type    TEXT NOT NULL,
  target_type  TEXT NOT NULL,
  target_id    TEXT NOT NULL,
  label        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_discovery_finding_link_finding
    FOREIGN KEY (finding_id) REFERENCES discovery_findings(id) ON DELETE CASCADE
);

CREATE INDEX idx_discovery_finding_link_finding_id
  ON discovery_finding_links (finding_id);
CREATE INDEX idx_discovery_finding_link_target
  ON discovery_finding_links (target_type, target_id);

COMMENT ON TABLE discovery_finding_links IS
  'Polymorphic links from a discovery_finding to its supporting (target_type, target_id) entities. ON DELETE CASCADE on finding_id only -- see header comment for the parent-side cascade plan. Spec: Discovery Findings First-Class (2026-05-16).';

COMMENT ON COLUMN discovery_finding_links.target_type IS
  'Polymorphic target discriminator. v1 values: discovery_evidence, discovery_candidate, discovery_relationship, discovery_cluster, discovery_decision_task, architecture_element. Documented-but-unused future values (no v1 emission): work_item, api_behaviour_baseline.';

COMMENT ON COLUMN discovery_finding_links.link_type IS
  'Relationship verb. v1 values: supports, derived_from, related_to, blocks, resolves, saved_as, references. Stored as TEXT for extensibility.';

COMMENT ON COLUMN discovery_finding_links.target_id IS
  'Stringified identifier of the target. UUIDs for discovery_* and architecture_element targets; other shapes possible for future target_types.';
