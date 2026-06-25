-- 197-vulnerabilities.sql
-- Spec: Vulnerability store + manual capture + current-state view
--       (2026-06-24, Spec 1 of 6 in the CVE-reduction initiative) -- Task Group 1.
--
-- Introduces the dedicated, queryable current-state CVE / CWE / CVSS / advisory
-- store: the FIRST structured vulnerability store anywhere in the product
-- (today only free-text CVE prose exists via the risky_dependency heuristic).
-- This spec OWNS the entity contract that Specs 2 (OSV enrichment) and 4
-- (reduction + "target status" column) build on.
--
-- Two tables:
--
--   * vulnerability_reports -- one row per uploaded SCA report version. Carries
--     the "replace latest, keep history" lifecycle via is_latest, plus the
--     no-silent-drop accounting (row_count_ingested / row_count_dropped / notes)
--     and the recorded parse_strategy. Re-upload for the same
--     (project_id, architecture_id, source) flips the prior latest report to
--     is_latest=false and inserts a new is_latest=true row; prior reports +
--     their vulnerabilities rows are RETAINED (no deletes).
--
--   * vulnerabilities -- one row per captured advisory, scoped to a report
--     (report_id, NOT NULL). Coordinate + resolved-edge-version matching sets
--     match_status='matched' (with matched_library_id + matched_declared_version)
--     or KEEPS the row as match_status='unmatched' (the "orphan" flag) -- never
--     dropped. raw_row + fixed_in_versions are JSONB. The
--     affected_version / affected_version_range / fixed_in_versions /
--     matched_declared_version columns are the LOCKED cross-spec contract Spec 4
--     consumes for version-range comparison -- keep them stable.
--
-- Enumish vocabularies (severity, source, match_status, ecosystem, format,
-- parse_strategy) are stored as plain TEXT (NOT Postgres enums or Java enums),
-- mirroring the discovery_findings "string-typed enumish" convention so pack /
-- tool / source values stay extensible without DDL or service redeploys. The
-- documented v1 vocabularies are captured in COMMENT ON COLUMN below; there are
-- NO hard DB CHECK enums.
--
-- Index set mirrors discovery_findings: one index per read key.
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable. This is a NEW changeset only (196 is the highest on disk at build
-- time); changesets <= 196 are not edited. Registered AFTER 196 in
-- db.changelog-master.yaml with the not-tableExists precondition idiom
-- (mirrors 135 / 184).

CREATE TABLE vulnerability_reports (
  id                  UUID PRIMARY KEY,
  project_id          UUID NOT NULL,
  architecture_id     UUID NOT NULL,
  source              TEXT NOT NULL,
  original_filename   TEXT,
  format              TEXT,
  uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_latest           BOOLEAN NOT NULL DEFAULT TRUE,
  row_count_ingested  INTEGER,
  row_count_dropped   INTEGER,
  parse_strategy      TEXT,
  notes               TEXT
);

CREATE INDEX idx_vulnerability_report_project_id
  ON vulnerability_reports (project_id);
CREATE INDEX idx_vulnerability_report_architecture_id
  ON vulnerability_reports (architecture_id);
CREATE INDEX idx_vulnerability_report_source
  ON vulnerability_reports (source);
CREATE INDEX idx_vulnerability_report_is_latest
  ON vulnerability_reports (is_latest);

CREATE TABLE vulnerabilities (
  id                        UUID PRIMARY KEY,
  project_id                UUID NOT NULL,
  architecture_id           UUID NOT NULL,
  report_id                 UUID NOT NULL,
  ingested_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cve_id                    TEXT,
  cwe                       TEXT,
  title                     TEXT,
  details                   TEXT,
  cvss                      DECIMAL(4,1),
  severity                  TEXT NOT NULL,
  severity_raw              TEXT,
  affected_coordinate       TEXT,
  ecosystem                 TEXT,
  affected_version          TEXT,
  affected_version_range    TEXT,
  fixed_in_versions         JSONB,
  source                    TEXT NOT NULL,
  raw_row                   JSONB,
  match_status              TEXT NOT NULL,
  matched_library_id        TEXT,
  matched_declared_version  TEXT,
  CONSTRAINT fk_vulnerability_report
    FOREIGN KEY (report_id) REFERENCES vulnerability_reports(id) ON DELETE CASCADE
);

CREATE INDEX idx_vulnerability_project_id
  ON vulnerabilities (project_id);
CREATE INDEX idx_vulnerability_architecture_id
  ON vulnerabilities (architecture_id);
CREATE INDEX idx_vulnerability_report_id
  ON vulnerabilities (report_id);
CREATE INDEX idx_vulnerability_cve_id
  ON vulnerabilities (cve_id);
CREATE INDEX idx_vulnerability_affected_coordinate
  ON vulnerabilities (affected_coordinate);
CREATE INDEX idx_vulnerability_severity
  ON vulnerabilities (severity);
CREATE INDEX idx_vulnerability_match_status
  ON vulnerabilities (match_status);
CREATE INDEX idx_vulnerability_source
  ON vulnerabilities (source);

COMMENT ON TABLE vulnerability_reports IS
  'One row per uploaded SCA report version. Carries the replace-latest / keep-history lifecycle (is_latest) and the no-silent-drop accounting (row_count_ingested / row_count_dropped / notes). Re-upload for the same (project_id, architecture_id, source) flips the prior latest report is_latest=false and inserts a new is_latest=true row; prior reports + their vulnerabilities rows are retained (no deletes). Spec: Vulnerability store + manual capture (2026-06-24, Spec 1).';

COMMENT ON COLUMN vulnerability_reports.source IS
  'Producer source label. v1 values: internal_report (manual upload), automated (OSV enrichment, Spec 2). The is_latest flip is scoped per (project_id, architecture_id, source). Stored as TEXT for pack-extensibility without DDL.';

COMMENT ON COLUMN vulnerability_reports.format IS
  'Upload format. v1 values: csv, xlsx, json. Stored as TEXT.';

COMMENT ON COLUMN vulnerability_reports.parse_strategy IS
  'LLM-flexible parse strategy used. v1 values: whole_doc, column_mapping. Deterministic extraction follows either way. Stored as TEXT.';

COMMENT ON COLUMN vulnerability_reports.row_count_dropped IS
  'Count of rows dropped during parse / dedup (unparseable or collapsed duplicates). NEVER a silent drop -- the corresponding summary is written into notes.';

COMMENT ON TABLE vulnerabilities IS
  'Dedicated, queryable current-state CVE / CWE / CVSS / advisory store. One row per captured advisory, scoped to a report (report_id). Coordinate + resolved-edge-version matching sets match_status=matched (with matched_library_id + matched_declared_version) or keeps the row as match_status=unmatched (orphan) -- never dropped. raw_row + fixed_in_versions are JSONB. affected_version / affected_version_range / fixed_in_versions / matched_declared_version are the LOCKED cross-spec contract Spec 4 consumes. Spec: Vulnerability store + manual capture (2026-06-24, Spec 1).';

COMMENT ON COLUMN vulnerabilities.severity IS
  'Severity normalized to the info..critical ladder (same ladder as discovery_findings.severity). v1 values: info, low, medium, high, critical. Stored as TEXT for pack-extensibility without DDL.';

COMMENT ON COLUMN vulnerabilities.severity_raw IS
  'Raw severity value preserved verbatim from the report (the normalized value lives in severity).';

COMMENT ON COLUMN vulnerabilities.source IS
  'Producer source label. v1 values: internal_report (manual upload), a tool name, or automated (OSV, Spec 2). Stored as TEXT.';

COMMENT ON COLUMN vulnerabilities.match_status IS
  'Coordinate match status. v1 values: matched, unmatched (the orphan flag). Unmatched rows are kept, never dropped. Stored as TEXT.';

COMMENT ON COLUMN vulnerabilities.ecosystem IS
  'Ecosystem discriminator (doc-only). v1 values: MAVEN, NPM, PYPI, NUGET, GO, OTHER. Mirrors libraries.ecosystem. Stored as TEXT.';

COMMENT ON COLUMN vulnerabilities.affected_coordinate IS
  'Affected coordinate: group:artifact (Maven) / full pkg (npm). Matches libraries.name for the coordinate-level match.';

COMMENT ON COLUMN vulnerabilities.fixed_in_versions IS
  'JSONB string-array of fixed-in versions. Empty-array default; primarily populated by OSV (Spec 2), accepted from the report when present. LOCKED cross-spec contract consumed by Spec 4.';

COMMENT ON COLUMN vulnerabilities.raw_row IS
  'The raw ingested row retained verbatim for drill-down (JSONB). Never dropped -- preserves the native advisory id + any columns the structured fields did not capture.';

COMMENT ON COLUMN vulnerabilities.matched_declared_version IS
  'The resolved dependency-edge version captured at match time (from code_unit_dependencies.declared_version). LOCKED cross-spec contract consumed by Spec 4 for range comparison.';
