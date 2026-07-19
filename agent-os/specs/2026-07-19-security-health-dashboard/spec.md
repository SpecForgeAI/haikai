# Security Health Dashboard (department-level) — 3-spec build

Date: 2026-07-19. Mode: Fable 5 direct implementation (agent-os artifact trail retained).
Branch: `feature/security-health-dashboard`. One commit per spec; merge to main jointly after review.

## Vision (from design conversation, 2026-07-18/19)

A project represents a whole area (e.g. a bank's Risk department) owning 100s of repos /
10s-100s of applications. The Security area grows a department-level health dashboard:

- **Security Overview**: a derived, persisted "Security Summary" diagram (application boxes +
  data-movement edges rolled up via application points) overlaid with per-application severity
  circles computed at render time from the latest findings report; a "Not matched" pseudo-box;
  basic editing (move/resize) + Regenerate (preserve surviving positions); compact upload history.
- **Findings Register**: the flattened detail screen (deliberate flattening in exactly ONE place),
  deep-linked from diagram clicks with filters applied, over a parameterized endpoint
  (filters + column set).
- **Upload wizard** (launched from Security Overview): multi-file GitLab vulnerability-export
  selection (parsed per-file, appended into ONE report), association-level confirm
  (application-only wired in v1), column matcher (generic attributes ← file columns, parser-proposed
  defaults, prefilled from last confirmed mapping), interactive value matcher (distinct linking
  values → applications; alias-persisting; unmatched allowed).

## Data model (one-fact-one-home)

- `security_findings` — what the scanner asserted, verbatim; attribution (level, application_id,
  match_status) set by the wizard's value-matching. NO Tool/Scanner/Group/Activity/Comments/
  Dismissal/TrackedContext columns and NO raw_row (user-scoped v1 subset).
- `cves` — world facts per CVE (cve.org/OSV authority). Ingest creates PENDING stubs only;
  enrichment (gateway OSV bridge → AMS enrichment endpoint) fills them; never blocks ingest.
- `cwes` — world facts per CWE (MITRE authority), seeded from the real MITRE view-1000 catalog
  (944 rows, retrieved 2026-07-19); pending stubs for unseen ids.
- Join tables `security_finding_cves` / `security_finding_cwes` (M:N by identifier string —
  multi-CVE files need no schema change).
- `security_finding_reports` — snapshot-list lifecycle (every upload = new report, newest
  `is_latest`, history retained); carries per-upload association_level + confirmed column_mapping
  (audit + next-upload prefill).
- `security_linking_aliases` — project-scoped alias memory ("MRX (Risk)" → application MRX).

**Register note (deviation from conversation):** the flattened register is implemented as a
service-layer projection (`SecurityRegisterService`) rather than a literal SQL VIEW — the single
deliberate flattening point is preserved, but the H2 test profile (Hibernate ddl-auto, Liquibase
disabled) cannot see Liquibase-created views, and per-finding aggregation of M:N CVE/CWE joins
(one register ROW per finding) needs dialect-portable aggregation. Same contract, same principle.

## Specs

1. **security-health-foundation** (AMS): changesets 211 (tables) + 212 (CWE seed), entities,
   repositories, ingestion/register/rollup/alias/reference services + controllers, tests.
2. **security-upload-wizard-ingest** (gateway + frontend): GitLab-export parser (Ruby-hash
   Location), multi-file append, mapping propose/prefill, distinct-value extraction, ingest
   forward, OSV enrichment wiring (bridge → AMS cves), 4-step wizard UI.
3. **security-read-surfaces** (frontend): Security Overview screen + generated "Security Summary"
   DiagramEntity + severity circles + Regenerate + history modal; Findings Register screen.

## Deferred (recorded, NOT built)

Service/component association levels (schema carries `level` from day one); repo modeling
(1:1 service:repo assumed); finding-class table split (no discriminator in v1 — user excluded
Tool); register-configurability UI (endpoint is parameterized from day one); remediation/action
plans; cross-upload finding lifecycle diffs (source_finding_id captured to enable later);
multi-CVE-per-cell delimiter handling beyond join-table shape; CWE enrichment beyond the seed.

## Untouched

Existing migration-workflow Security screen, `vulnerabilities` / `vulnerability_reports` tables
and every consumer of them. User's uncommitted local changes stay out of commits.
