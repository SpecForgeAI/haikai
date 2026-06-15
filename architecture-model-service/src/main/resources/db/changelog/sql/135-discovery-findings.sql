-- 135-discovery-findings.sql
-- Spec: Discovery Findings / Evidence as a First-Class Discovery Concept
--       (2026-05-16) -- Task Group 1
--
-- Introduces `discovery_findings` as a durable, run-scoped, reviewable record
-- alongside (not inside) the architecture model. Findings carry migration-
-- useful intelligence (risks, ambiguities, evidence gaps, runtime observations)
-- emitted by the discovery pipeline at well-defined hook points.
--
-- Scoping:
--   * run_id          -> FK to discovery_run(id), ON DELETE CASCADE so findings
--                        vanish with their parent run.
--   * project_id      -> NOT NULL; matches the path parameter on the AMS
--                        controller and the parent run's project.
--   * architecture_id -> NOT NULL; DiscoveryRunEntity.architecture_id is itself
--                        NOT NULL (Spec #4 2026-05-01), so findings inherit
--                        the same scoping.
--
-- Enumish vocabularies are stored as plain TEXT (not Postgres enums or Java
-- enums) so packs can introduce new values without DDL or service redeploy.
-- The documented v1 vocabularies are captured in COMMENT ON COLUMN below.
--
-- D5: default `status` is 'new' -- pipeline emission is neutral; reviewer
-- actions drive transitions.
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable. This is a NEW changeset only; changesets <= 134 are not edited.

CREATE TABLE discovery_findings (
  id                UUID PRIMARY KEY,
  run_id            UUID NOT NULL,
  project_id        UUID NOT NULL,
  architecture_id   UUID NOT NULL,
  finding_type      TEXT NOT NULL,
  category          TEXT NOT NULL,
  severity          TEXT NOT NULL,
  confidence        DOUBLE PRECISION,
  status            TEXT NOT NULL DEFAULT 'new',
  title             TEXT NOT NULL,
  summary           TEXT,
  detail_json       JSONB,
  source            TEXT,
  created_by_stage  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at       TIMESTAMPTZ,
  reviewer_notes    TEXT,
  CONSTRAINT fk_discovery_finding_run
    FOREIGN KEY (run_id) REFERENCES discovery_run(id) ON DELETE CASCADE
);

CREATE INDEX idx_discovery_finding_run_id
  ON discovery_findings (run_id);
CREATE INDEX idx_discovery_finding_project_id
  ON discovery_findings (project_id);
CREATE INDEX idx_discovery_finding_architecture_id
  ON discovery_findings (architecture_id);
CREATE INDEX idx_discovery_finding_status
  ON discovery_findings (status);
CREATE INDEX idx_discovery_finding_category
  ON discovery_findings (category);
CREATE INDEX idx_discovery_finding_severity
  ON discovery_findings (severity);
CREATE INDEX idx_discovery_finding_finding_type
  ON discovery_findings (finding_type);
CREATE INDEX idx_discovery_finding_source
  ON discovery_findings (source);

COMMENT ON TABLE discovery_findings IS
  'Durable, run-scoped, reviewable migration-intelligence records emitted by the discovery pipeline. Lives alongside the architecture model -- NOT inside it. Findings carry risks, ambiguities, evidence gaps, runtime observations. ON DELETE CASCADE from discovery_run. Spec: Discovery Findings First-Class (2026-05-16).';

COMMENT ON COLUMN discovery_findings.status IS
  'Reviewer lifecycle. v1 values: new (default on emit -- D5), accepted, ignored, needs_review, resolved. Stored as TEXT for pack-extensibility without DDL.';

COMMENT ON COLUMN discovery_findings.severity IS
  'Severity vocabulary. v1 values: info, low, medium, high, critical. Stored as TEXT for pack-extensibility without DDL.';

COMMENT ON COLUMN discovery_findings.finding_type IS
  'Finding type discriminator. v1 values: low_confidence_candidate, unresolved_decision_task, candidate_conflict, unmatched_runtime_endpoint, runtime_usage_observation, ambiguous_relationship, evidence_gap. Documented-but-deferred: unsupported_pattern (D4). Stored as TEXT for pack-extensibility without DDL.';

COMMENT ON COLUMN discovery_findings.category IS
  'Category vocabulary. v1 values: ambiguity, runtime_usage, evidence_gap. Stored as TEXT for pack-extensibility without DDL.';

COMMENT ON COLUMN discovery_findings.confidence IS
  'Optional confidence 0.0..1.0. Nullable. Read paths box this to Double on the entity so PATCH semantics can preserve null (project_primitive_double_dto_overwrite.md).';

COMMENT ON COLUMN discovery_findings.source IS
  'Producer source label. v1 values open-ended; documented-but-unused future value: llm_enrichment (D7 -- shape-only, no v1 emission).';

COMMENT ON COLUMN discovery_findings.created_by_stage IS
  'Pipeline stage that emitted this finding. Examples: discoveryV3Pipeline.postMerge.lowConfidence, triageEngine.decisionTaskCreation, runtimeEvidence.endpointRuntimeMatcher, findings.evidenceGapScanner.';

COMMENT ON COLUMN discovery_findings.detail_json IS
  'Optional JSONB payload with finding-type-specific structured detail.';
