-- 184-discovery-capability.sql
-- Spec: D2 -- Capability Synthesis + Batch Spines (2026-06-14, Spec 2 of 6) -- Task Group 1
--
-- The findings-side CAPABILITY grouping: the single new model concept of the
-- whole 6-spec discovery-completeness program. D1 emits one operational finding
-- PER FILE, but operational functionality is a GRAPH, not a list of files (a JIL
-- box triggers shell scripts that invoke plain-Java main() batch classes that
-- read/write Sybase tables and publish a downstream message). A capability is a
-- cross-cutting CURRENT-STATE aggregation -- "the Daily Risk Hierarchy Load
-- Pipeline, composed of these parts, on this schedule" -- so the related findings
-- become ONE migration story instead of thirty disconnected file findings.
--
-- This is Option A (a findings-side grouping), SHAPED so it can graduate to a
-- first-class "Discovered Capabilities" output (Option B) later with NO data
-- re-model -- the membership lives in its own table, so it does not move when the
-- capability graduates. TWO new tables:
--
--   discovery_capability (NEW table): one row per synthesised capability.
--     - id                      UUID PK
--     - run_id                  UUID NULL -- the discovery_run that synthesised
--                               this capability (the read key). Soft reference
--                               (no FK -- mirrors discovery_findings.run_id, which
--                               is itself nullable / FK-free at the column level).
--     - project_id              UUID NOT NULL -- the owning project (read scope).
--     - architecture_id         UUID NOT NULL -- the owning architecture (read scope).
--     - name                    TEXT NOT NULL -- the LLM-named capability label
--                               (e.g. "Daily Risk Hierarchy Load Pipeline"). The
--                               LLM is naming-only; it NEVER decides membership.
--     - kind                    TEXT NULL -- the LLM-classified kind, free-text /
--                               extensible, NO DB enum (e.g. batch_pipeline |
--                               monitoring | ftp_ingestion | deployment |
--                               housekeeping). String-as-TEXT per the AMS
--                               status-as-TEXT convention -- new pack values need
--                               no DDL.
--     - summary                 TEXT NULL -- the LLM one-line summary.
--     - review_status           TEXT NOT NULL DEFAULT 'pending_review' -- the
--                               reviewer disposition, candidate/finding-parity
--                               vocabulary: pending_review | approved | rejected |
--                               deferred (service-layer validated; no DB enum).
--                               Approving/rejecting a capability does NOT cascade
--                               to its members in D2 (members keep independent
--                               review_status; the capability disposition is a
--                               separate, additive signal -- cascade is deferred
--                               to the keystone / gate specs).
--     - previous_review_status  TEXT NULL -- the review_status value before the
--                               most recent transition (lightweight audit / re-open
--                               trail). Mirrors discovery_findings.previous_review_status.
--     - confidence              DOUBLE PRECISION NULL -- the synthesis confidence.
--                               Boxed Double on the Java side per
--                               project_primitive_double_dto_overwrite.md so a PATCH
--                               that omits it never wipes it to 0.0.
--     - detail_json             JSONB NULL -- the structured capability payload:
--                               the JIL-DAG topology snapshot (boxes / jobs /
--                               trigger DAG / schedules / machine / file-watchers),
--                               the typed invocations[] edges (D8 cross-language
--                               linkage, confidence-tagged), schedule / trigger
--                               metadata, external systems, and an aggregated
--                               behaviourBearing hint (the forward seam the later
--                               D4-gate spec consumes). JSONB via Hibernate JsonType;
--                               NULL is the valid empty state.
--     - source                  TEXT NULL -- the synthesis provenance (e.g.
--                               jil_dag_closure | co_location_heuristic).
--     - created_by_stage        TEXT NULL -- the pipeline stage that emitted the
--                               capability (e.g. capability_synthesis).
--     - created_at / updated_at TIMESTAMPTZ NOT NULL
--
--   discovery_capability_member (NEW table): the POLYMORPHIC membership. Members
--   and outbound architecture-entity links live ONLY here, never on the capability
--   row -- the Option-A -> Option-B graduation path (the membership data does not
--   move when the capability graduates).
--     - id                      UUID PK
--     - capability_id           UUID NOT NULL FK -> discovery_capability(id)
--                               ON DELETE CASCADE (a member only exists in the
--                               context of its capability).
--     - member_type             TEXT NOT NULL -- the polymorphic discriminator:
--                               discovery_finding | discovery_candidate |
--                               architecture_element | discovery_relationship.
--                               (Referential integrity for member_id is enforced
--                               at the application layer because the target table
--                               varies by member_type -- the established polymorphic
--                               precedent on discovery_cluster_member.)
--                               NOTE: discovery_finding is a valid member_type HERE,
--                               but this is a DIFFERENT mechanism from
--                               DiscoveryFindingLink -- discovery_finding stays OUT
--                               of that whitelist's ALLOWED_LINK_TARGET_TYPES.
--     - member_id               UUID NOT NULL -- the referenced member's id.
--     - created_at              TIMESTAMPTZ NOT NULL
--
-- Indexes: discovery_capability on the read keys (run_id, project_id,
-- architecture_id, review_status); discovery_capability_member on capability_id
-- (read a capability's members) + (member_type, member_id) (the reverse lookup:
-- which capabilities reference a given member).
--
-- NEW changeset only -- never edit applied changesets (<= 183) per
-- feedback_liquibase_immutable_changesets.md. 183
-- (183-migration-reconciliation-break.sql) is the highest on disk; this registers
-- AFTER it in db.changelog-master.yaml.

CREATE TABLE discovery_capability (
  id                          UUID PRIMARY KEY,
  run_id                      UUID NULL,
  project_id                  UUID NOT NULL,
  architecture_id             UUID NOT NULL,
  name                        TEXT NOT NULL,
  kind                        TEXT NULL,
  summary                     TEXT NULL,
  review_status               TEXT NOT NULL DEFAULT 'pending_review',
  previous_review_status      TEXT NULL,
  confidence                  DOUBLE PRECISION NULL,
  detail_json                 JSONB NULL,
  source                      TEXT NULL,
  created_by_stage            TEXT NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_discovery_capability_run_id ON discovery_capability(run_id);
CREATE INDEX idx_discovery_capability_project_id ON discovery_capability(project_id);
CREATE INDEX idx_discovery_capability_architecture_id ON discovery_capability(architecture_id);
CREATE INDEX idx_discovery_capability_review_status ON discovery_capability(review_status);

CREATE TABLE discovery_capability_member (
  id                          UUID PRIMARY KEY,
  capability_id               UUID NOT NULL,
  member_type                 TEXT NOT NULL,
  member_id                   UUID NOT NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_dcm_capability
    FOREIGN KEY (capability_id) REFERENCES discovery_capability(id) ON DELETE CASCADE
);

CREATE INDEX idx_discovery_capability_member_capability_id ON discovery_capability_member(capability_id);
CREATE INDEX idx_discovery_capability_member_member ON discovery_capability_member(member_type, member_id);

COMMENT ON TABLE discovery_capability IS
  'One synthesised CAPABILITY per row: a cross-cutting current-state aggregation of related discovery findings / candidates / architecture elements (e.g. "Daily Risk Hierarchy Load Pipeline") so they become ONE migration story instead of many disconnected file findings. Option A (findings-side grouping), shaped to graduate to a first-class output (Option B) with no data re-model. Membership lives in discovery_capability_member, never on this row. Spec: D2 -- Capability Synthesis + Batch Spines (2026-06-14, Spec 2 of 6).';

COMMENT ON COLUMN discovery_capability.kind IS
  'The LLM-classified capability kind, free-text / extensible, NO DB enum (e.g. batch_pipeline | monitoring | ftp_ingestion | deployment | housekeeping). String-as-TEXT per the AMS status-as-TEXT convention. The LLM is naming-only -- it classifies the kind but NEVER decides membership (membership is deterministic).';

COMMENT ON COLUMN discovery_capability.review_status IS
  'The reviewer disposition (candidate/finding-parity vocabulary, service-layer validated; no DB enum): pending_review | approved | rejected | deferred. DB DEFAULT pending_review. Approving/rejecting a capability does NOT cascade to its members in D2 -- members keep independent review_status; the capability disposition is a separate, additive signal (cascade deferred to the keystone / gate specs).';

COMMENT ON COLUMN discovery_capability.previous_review_status IS
  'The review_status value before the most recent review transition (lightweight audit / re-open trail). NULL when no transition has occurred yet. Mirrors discovery_findings.previous_review_status.';

COMMENT ON COLUMN discovery_capability.confidence IS
  'The synthesis confidence. Boxed Double on the Java side per project_primitive_double_dto_overwrite.md so a PATCH that omits it never wipes it to 0.0. NULL is the valid empty state.';

COMMENT ON COLUMN discovery_capability.detail_json IS
  'The structured capability payload: the JIL-DAG topology snapshot (boxes / jobs / trigger DAG / schedules / machine / file-watchers), the typed invocations[] edges (D8 cross-language linkage, confidence-tagged), schedule / trigger metadata, external systems, and an aggregated behaviourBearing hint (the forward seam the later D4-gate spec consumes). JSONB via Hibernate JsonType; NULL is the valid empty state.';

COMMENT ON TABLE discovery_capability_member IS
  'The POLYMORPHIC membership of a discovery_capability. member_type discriminates the target table for member_id (discovery_finding | discovery_candidate | architecture_element | discovery_relationship); referential integrity for member_id is enforced at the application layer (the discovery_cluster_member polymorphic precedent). NOTE: discovery_finding is a valid member_type HERE but is a DIFFERENT mechanism from DiscoveryFindingLink -- discovery_finding stays OUT of ALLOWED_LINK_TARGET_TYPES. FK capability_id -> discovery_capability(id) ON DELETE CASCADE.';

COMMENT ON COLUMN discovery_capability_member.member_type IS
  'The polymorphic discriminator for member_id: discovery_finding | discovery_candidate | architecture_element | discovery_relationship. Free-text TEXT per the AMS status-as-TEXT convention; the service layer validates the value set. discovery_finding is valid HERE (membership) but NOT a DiscoveryFindingLink target -- distinct mechanisms.';
