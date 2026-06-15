# Increment 14 of 16 — Log-based discovery enrichment (v1)

## Delivery context

This is increment **14 of 16** for the new **legacy / current-state discovery** capability.

Previous increments established:
- full discovery pipeline (Phase 0 + Phase 1a–1d),
- candidate generation and save-back,
- read-only visibility,
- user review and approval workflow.

This increment introduces **log-based enrichment**, adding runtime/production signals to improve discovery accuracy.

## Goal

Enable the system to:
- ingest application logs,
- extract additional evidence,
- enrich the existing evidence graph, clusters, and candidates.

At the end of this increment:
- logs contribute new evidence atoms,
- existing clusters/candidates can be strengthened or refined,
- no destructive changes are made to already saved canonical entities.

## In scope

### 1. Log ingestion (basic)
Introduce a simple mechanism to provide logs to the discovery system, such as:
- file upload
- reference to log files/locations

No need for streaming or real-time ingestion in this increment.

### 2. Log-based evidence extraction (1a extension)
Extend Phase 1a to support log-derived evidence, including:

- endpoint usage (URLs, routes)
- service interaction patterns
- error traces and stack hints
- database/query usage signals
- user flow hints (where visible)

Log-derived evidence should:
- produce additional 1a evidence atoms
- include source = "log"
- include timestamps or occurrence metadata where possible

### 3. Evidence integration
Merge log-derived evidence into the existing discovery run:

- attach to existing atoms where relevant
- create new atoms where needed
- update confidence of related relationships/clusters

No need for complex reconciliation — basic integration is sufficient.

### 4. Optional reprocessing of later phases
Allow (basic) reprocessing of:
- 1b relationships
- 1c clusters
- 1d candidates

after log enrichment.

This can be:
- a simple re-run of later phases,
- or incremental update logic.

### 5. Candidate enrichment (non-destructive)
Allow log evidence to:
- increase confidence of candidates
- fill missing attributes (e.g. endpoints actually used)
- highlight unused/low-signal candidates

Do not:
- automatically delete or overwrite saved canonical entities.

### 6. Visibility of log influence
Expose (at a basic level):
- that log data contributed to a candidate
- increased confidence or additional signals

No deep log inspection UI required.

## Out of scope

Do **not** implement:
- real-time/streaming log ingestion
- complex log parsing frameworks
- advanced correlation across distributed systems
- automatic deletion of candidates/entities based on logs
- frontend-heavy log visualization
- AST enrichment
- language/version-specific analyzer packs

## Required design constraints

### Logs as enrichment, not replacement
Logs augment discovery — they do not replace code-based evidence.

### Non-destructive updates
Existing candidates and saved entities must not be removed or corrupted.

### Deterministic-first extraction
Log parsing should be rule-based; no heavy LLM use in this increment.

### Traceability
Log-derived evidence must be clearly identifiable:
- source = log
- origin reference (file/time)

### Incremental integration
The system must handle log enrichment without requiring a full reset of discovery state.

## Acceptance criteria

1. Logs can be ingested into the discovery system.
2. Log-derived evidence atoms are created and stored.
3. Evidence graph is enriched with log signals.
4. Relationships/clusters/candidates can be reprocessed or updated.
5. Candidate confidence can be adjusted based on logs.
6. Log influence is visible at a high level.
7. No destructive changes are made to existing canonical entities.

## Notes for later increments

This increment enables:
- Increment 15: hypothesis-first discovery and Q&A with users
- deeper refinement loops combining code, logs, and human input

The implementation should prioritize:
- safe enrichment,
- clear separation of evidence sources,
- and minimal disruption to existing discovery results.
