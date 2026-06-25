-- 199-target-manifest-artifacts.sql
-- Spec: Confirmed Manifest Producer Wiring (Spec 5 Phase 2)
--       (2026-06-25) -- Task Group 1.
--
-- Introduces the durable store for confirmed target dependency manifests
-- (pom.xml / package.json) so the verbatim build file survives from upload
-- through to spec-gen, where the already-built seed-build-files carriage emits
-- it into the generated target codebase at the resolved per-module path.
--
-- Single table:
--
--   * target_manifest_artifacts -- one row per uploaded confirmed manifest
--     artifact (per tag). Carries the "replace latest, keep history" lifecycle
--     via is_latest (modelled on vulnerability_reports). Re-upload for the same
--     (project_id, target_architecture_id, tag) flips the prior latest artifact
--     to is_latest=false and inserts a new is_latest=true row; prior rows are
--     RETAINED (append-only, no deletes). The producer reads only the latest
--     artifacts (one per tag). The flip is scoped per
--     (project_id, target_architecture_id, tag) so distinct tags flip
--     independently and a sibling tag's latest is never demoted.
--
--     content + package_lock_content carry the verbatim manifest bytes as TEXT
--     (byte-for-byte; no trimming, re-encoding, or trailing-newline drift).
--     resolved_dependencies is JSONB (the resolved dependency list per artifact).
--
-- Enumish vocabularies (kind, ecosystem) are stored as plain TEXT (NOT Postgres
-- enums or Java enums), mirroring the discovery_findings / vulnerabilities
-- "string-typed enumish" convention so values stay extensible without DDL or
-- service redeploys. The documented v1 vocabularies are captured in
-- COMMENT ON COLUMN below; there are NO hard DB CHECK enums.
--
-- Index set mirrors vulnerability_reports: one index per read key
-- (project_id, target_architecture_id, tag, is_latest).
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable. This is a NEW changeset only (198 is the highest on disk at build
-- time); changesets <= 198 are not edited. Registered AFTER 198 in
-- db.changelog-master.yaml with the not-tableExists precondition idiom
-- (mirrors 197 / 135 / 184).

CREATE TABLE target_manifest_artifacts (
  id                      UUID PRIMARY KEY,
  project_id              UUID NOT NULL,
  target_architecture_id  UUID NOT NULL,
  tag                     TEXT NOT NULL,
  kind                    TEXT,
  ecosystem               TEXT,
  manifest_path           TEXT,
  content                 TEXT,
  package_lock_content    TEXT,
  resolved_dependencies   JSONB,
  is_latest               BOOLEAN NOT NULL DEFAULT TRUE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_target_manifest_artifact_project_id
  ON target_manifest_artifacts (project_id);
CREATE INDEX idx_target_manifest_artifact_target_architecture_id
  ON target_manifest_artifacts (target_architecture_id);
CREATE INDEX idx_target_manifest_artifact_tag
  ON target_manifest_artifacts (tag);
CREATE INDEX idx_target_manifest_artifact_is_latest
  ON target_manifest_artifacts (is_latest);

COMMENT ON TABLE target_manifest_artifacts IS
  'Durable store of confirmed target dependency manifests (pom.xml / package.json). One row per uploaded artifact (per tag). Carries the replace-latest / keep-history lifecycle (is_latest), modelled on vulnerability_reports. Re-upload for the same (project_id, target_architecture_id, tag) flips the prior latest is_latest=false and inserts a new is_latest=true row; prior rows are retained (append-only, no deletes). The producer reads only the latest artifacts (one per tag). content + package_lock_content carry verbatim manifest bytes as TEXT. Spec: Confirmed Manifest Producer Wiring (2026-06-25, Spec 5 Phase 2).';

COMMENT ON COLUMN target_manifest_artifacts.tag IS
  'Service/module tag the manifest belongs to (the per-module placement key). The is_latest flip is scoped per (project_id, target_architecture_id, tag). Stored as TEXT.';

COMMENT ON COLUMN target_manifest_artifacts.kind IS
  'Manifest kind discriminator (doc-only). v1 values: pom, package_json. Stored as TEXT for extensibility without DDL.';

COMMENT ON COLUMN target_manifest_artifacts.ecosystem IS
  'Ecosystem discriminator (doc-only). v1 values: MAVEN, NPM. Stored as TEXT.';

COMMENT ON COLUMN target_manifest_artifacts.manifest_path IS
  'Resolved per-module manifest path relative to the module root (e.g. pom.xml / package.json). Nullable when unresolved at upload.';

COMMENT ON COLUMN target_manifest_artifacts.content IS
  'The verbatim confirmed manifest file content carried byte-for-byte as TEXT (no trim / re-encode / trailing-newline drift). This is the file emitted into the generated target codebase.';

COMMENT ON COLUMN target_manifest_artifacts.package_lock_content IS
  'The verbatim lockfile content (e.g. package-lock.json) carried byte-for-byte as TEXT. Nullable -- present for NPM artifacts, absent for Maven.';

COMMENT ON COLUMN target_manifest_artifacts.resolved_dependencies IS
  'JSONB array of the resolved dependency entries for this manifest (per the gateway ResolvedDependency shape). Retained for drill-down / downstream consumers.';
