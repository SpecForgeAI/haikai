-- 211-security-health-foundation.sql
-- Spec: Security health dashboard (2026-07-19, Spec 1 of 3) -- data foundation.
--
-- Department-level security health: a project models a whole area (e.g. a bank
-- Risk department); uploaded scanner exports (GitLab vulnerability CSV in v1)
-- are ingested into a STRUCTURED store under the one-fact-one-home rule:
--
--   * security_finding_reports -- one row per upload (multi-file uploads are
--     appended into ONE report). Snapshot-list lifecycle: every upload inserts
--     a new is_latest=true row and demotes the prior latest for the same
--     (project_id, architecture_id); history is RETAINED (no deletes). Carries
--     the per-upload association_level + the user-confirmed column_mapping
--     (audit trail + next-upload prefill).
--
--   * security_findings -- what the scanner ASSERTED, verbatim (reported copy;
--     never overwritten by enrichment), plus wizard-resolved attribution:
--     level ('application' in v1), application_id (applications.id, TEXT),
--     match_status (auto|manual|unmatched). Unmatched rows are KEPT (the
--     "Not matched" bucket on the Security Overview diagram).
--
--   * cves -- world facts per CVE (cve.org / OSV authority). Ingest creates
--     PENDING stubs only; the gateway OSV bridge fills them asynchronously via
--     the enrichment endpoint. Nothing ever blocks on enrichment.
--
--   * cwes -- world facts per CWE (MITRE authority). Seeded by changeset 212
--     from the real MITRE view-1000 catalog; ingest creates pending stubs for
--     ids outside the seed.
--
--   * security_finding_cves / security_finding_cwes -- M:N joins BY IDENTIFIER
--     STRING (CVE-... / CWE-...): join rows are valid before the referenced
--     cves/cwes stub exists, and multi-CVE files need no schema change.
--
--   * security_linking_aliases -- project-scoped value-matching memory
--     ("MRX (Risk)" -> application MRX), taught in the wizard's interactive
--     value matcher and auto-applied on subsequent uploads.
--
-- Deliberately ABSENT (user-scoped v1 subset of the GitLab export):
-- Tool / Scanner Name / Group Name / Activity / Comments / Dismissal Reason /
-- Tracked Context Name columns and raw_row. The flattened "Findings Register"
-- is a service-layer projection (SecurityRegisterService), not a DB view.
--
-- Enumish vocabularies are plain TEXT (NOT enums), per the discovery-family
-- convention; documented values live in COMMENT ON COLUMN below.
--
-- Per feedback_liquibase_immutable_changesets.md: NEW changeset only (210 is
-- the highest on disk at build time); changesets <= 210 are not edited.

CREATE TABLE security_finding_reports (
  id                  UUID PRIMARY KEY,
  project_id          UUID NOT NULL,
  architecture_id     UUID NOT NULL,
  source              TEXT NOT NULL,
  association_level   TEXT NOT NULL,
  original_filenames  JSONB,
  column_mapping      JSONB,
  uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_latest           BOOLEAN NOT NULL DEFAULT TRUE,
  row_count_ingested  INTEGER,
  row_count_dropped   INTEGER,
  notes               TEXT
);

CREATE INDEX idx_sec_finding_report_project_id
  ON security_finding_reports (project_id);
CREATE INDEX idx_sec_finding_report_architecture_id
  ON security_finding_reports (architecture_id);
CREATE INDEX idx_sec_finding_report_is_latest
  ON security_finding_reports (is_latest);

CREATE TABLE security_findings (
  id                    UUID PRIMARY KEY,
  project_id            UUID NOT NULL,
  architecture_id       UUID NOT NULL,
  report_id             UUID NOT NULL,
  ingested_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  linking_value         TEXT NOT NULL,
  level                 TEXT NOT NULL,
  application_id        TEXT,
  match_status          TEXT NOT NULL,
  severity              TEXT NOT NULL,
  severity_raw          TEXT,
  title                 TEXT,
  description           TEXT,
  detected_at           TIMESTAMPTZ,
  location              TEXT,
  source_path           TEXT,
  cvss_vector_reported  TEXT,
  source_finding_id     TEXT,
  other_identifiers     JSONB,
  CONSTRAINT fk_sec_finding_report
    FOREIGN KEY (report_id) REFERENCES security_finding_reports(id) ON DELETE CASCADE
);

CREATE INDEX idx_sec_finding_project_id
  ON security_findings (project_id);
CREATE INDEX idx_sec_finding_architecture_id
  ON security_findings (architecture_id);
CREATE INDEX idx_sec_finding_report_id
  ON security_findings (report_id);
CREATE INDEX idx_sec_finding_application_id
  ON security_findings (application_id);
CREATE INDEX idx_sec_finding_severity
  ON security_findings (severity);
CREATE INDEX idx_sec_finding_match_status
  ON security_findings (match_status);
CREATE INDEX idx_sec_finding_source_finding
  ON security_findings (report_id, source_finding_id);

CREATE TABLE cves (
  id                 UUID PRIMARY KEY,
  cve_id             TEXT NOT NULL,
  summary            TEXT,
  description        TEXT,
  cvss_vector        TEXT,
  cvss_score         DECIMAL(4,1),
  severity_official  TEXT,
  cwe_ids            JSONB,
  aliases            JSONB,
  reference_urls     JSONB,
  published_at       TIMESTAMPTZ,
  modified_at        TIMESTAMPTZ,
  kev_listed         BOOLEAN,
  epss_score         DECIMAL(6,5),
  source             TEXT,
  fetched_at         TIMESTAMPTZ,
  enrichment_status  TEXT NOT NULL DEFAULT 'pending',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_cves_cve_id UNIQUE (cve_id)
);

CREATE INDEX idx_cves_enrichment_status
  ON cves (enrichment_status);

CREATE TABLE cwes (
  id                 UUID PRIMARY KEY,
  cwe_id             TEXT NOT NULL,
  name               TEXT,
  description        TEXT,
  source             TEXT,
  fetched_at         TIMESTAMPTZ,
  enrichment_status  TEXT NOT NULL DEFAULT 'pending',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_cwes_cwe_id UNIQUE (cwe_id)
);

CREATE TABLE security_finding_cves (
  id          UUID PRIMARY KEY,
  finding_id  UUID NOT NULL,
  cve_id      TEXT NOT NULL,
  CONSTRAINT fk_sec_finding_cve_finding
    FOREIGN KEY (finding_id) REFERENCES security_findings(id) ON DELETE CASCADE,
  CONSTRAINT uq_sec_finding_cve UNIQUE (finding_id, cve_id)
);

CREATE INDEX idx_sec_finding_cve_cve_id
  ON security_finding_cves (cve_id);

CREATE TABLE security_finding_cwes (
  id          UUID PRIMARY KEY,
  finding_id  UUID NOT NULL,
  cwe_id      TEXT NOT NULL,
  CONSTRAINT fk_sec_finding_cwe_finding
    FOREIGN KEY (finding_id) REFERENCES security_findings(id) ON DELETE CASCADE,
  CONSTRAINT uq_sec_finding_cwe UNIQUE (finding_id, cwe_id)
);

CREATE INDEX idx_sec_finding_cwe_cwe_id
  ON security_finding_cwes (cwe_id);

CREATE TABLE security_linking_aliases (
  id           UUID PRIMARY KEY,
  project_id   UUID NOT NULL,
  level        TEXT NOT NULL,
  alias_value  TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  entity_name  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ,
  CONSTRAINT uq_sec_linking_alias UNIQUE (project_id, level, alias_value)
);

CREATE INDEX idx_sec_linking_alias_project
  ON security_linking_aliases (project_id);

COMMENT ON TABLE security_finding_reports IS
  'One row per security-findings upload (multi-file uploads appended into ONE report). Snapshot-list lifecycle: new upload inserts is_latest=true and demotes the prior latest for the same (project_id, architecture_id); history retained. Carries per-upload association_level + user-confirmed column_mapping (audit + next-upload prefill). Spec: Security health dashboard (2026-07-19, Spec 1 of 3).';

COMMENT ON COLUMN security_finding_reports.association_level IS
  'The level the file linking column binds findings to. v1 values: application (service / application_component reserved for later specs). TEXT, no enum.';

COMMENT ON COLUMN security_finding_reports.source IS
  'Producer label. v1 value: gitlab_export. TEXT for extensibility.';

COMMENT ON TABLE security_findings IS
  'What the scanner asserted, verbatim (reported copy, never overwritten by enrichment) + wizard-resolved attribution. Unmatched rows are KEPT (Not-matched bucket). CVE/CWE links live in security_finding_cves / security_finding_cwes (M:N by identifier string).';

COMMENT ON COLUMN security_findings.level IS
  'Attribution level of this finding. v1: application. TEXT, no enum.';

COMMENT ON COLUMN security_findings.application_id IS
  'Resolved applications.id (TEXT id family) when matched; NULL when match_status=unmatched.';

COMMENT ON COLUMN security_findings.match_status IS
  'Linking-value resolution outcome. v1 values: auto (exact/alias match), manual (user-picked in wizard), unmatched (kept, Not-matched bucket). TEXT, no enum.';

COMMENT ON COLUMN security_findings.severity IS
  'Severity normalized to the info..low..medium..high..critical ladder (same ladder as vulnerabilities.severity). Raw value preserved in severity_raw.';

COMMENT ON TABLE cves IS
  'World facts per CVE (cve.org / OSV authority) under the one-fact-one-home rule: uploads NEVER write here; ingest creates pending stubs; the gateway OSV bridge enriches asynchronously. enrichment_status: pending | enriched | not_found.';

COMMENT ON TABLE cwes IS
  'World facts per CWE (MITRE authority). Seeded from the MITRE view-1000 catalog (changeset 212); pending stubs for unseen ids.';

COMMENT ON TABLE security_linking_aliases IS
  'Project-scoped value-matching memory: alias_value (as seen in uploaded files) -> entity_id at level. Taught in the wizard value matcher; auto-applied on later uploads.';
