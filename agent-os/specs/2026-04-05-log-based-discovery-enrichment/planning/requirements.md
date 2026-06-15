# Spec Requirements: Log-based Discovery Enrichment

## Initial Description
Implement log-based discovery enrichment — ingesting application logs, extracting evidence atoms, enriching the evidence graph/clusters/candidates, and supporting optional reprocessing of later phases — as increment 14 of 16 for the legacy/current-state discovery capability.

Previous increments established the full discovery pipeline (Phase 0 + Phase 1a-1d), candidate generation and save-back, read-only visibility, and user review and approval workflow. This increment introduces log-based enrichment, adding runtime/production signals to improve discovery accuracy.

The goal is to enable the system to ingest application logs, extract additional evidence, and enrich the existing evidence graph, clusters, and candidates. Logs contribute new evidence atoms, existing clusters/candidates can be strengthened or refined, and no destructive changes are made to already saved canonical entities.

## Requirements Discussion

### First Round Questions

**Q1:** I assume the system should support common structured log formats (e.g., JSON lines, standard syslog-style, and common framework outputs like Log4j/Logback patterns). Is that correct, or should we target a specific log format only? Also, should there be a way for the user to provide a log format hint or parser configuration, or should the system auto-detect format?
**Answer:** Support a small set of common formats with simple auto-detection; do not over-engineer format handling in this increment.

**Q2:** The description mentions file upload or reference to log file locations. I'm assuming this would be exposed as a gateway API endpoint (consistent with the existing Express/TypeScript gateway pattern) that accepts either a file upload (multipart) or a file path/URL reference. Should this be triggered through the MCP server tooling (as an agent-driven action), through a direct API call, or both?
**Answer:** Keep it consistent with existing patterns — allow ingestion through the normal gateway/MCP-driven flow rather than introducing a new special path.

**Q3:** I assume the existing evidence atom schema (from Phase 1a) will be extended with additional fields like source: "log", logOrigin (file path, line range), and timestamp/occurrenceCount metadata. Is there an existing evidence atom schema or type definition I should be aware of, and should log-derived atoms use the exact same atom types as code-derived ones (e.g., "endpoint", "service-interaction", "database-query") or introduce new log-specific types?
**Answer:** Reuse the same atom model and types where possible, with a clear source: "log" marker; avoid creating a parallel log-only schema.

**Q4:** For the optional reprocessing of phases 1b-1d after log enrichment, I assume this should be an explicit user action (e.g., "re-run clustering with log evidence") rather than automatic. Is that correct? Should it reprocess all later phases in sequence, or allow selective phase re-runs (e.g., just re-run 1c clusters without re-running 1b relationships)?
**Answer:** Make reprocessing an explicit action, and keep it simple by re-running downstream phases in sequence rather than offering fine-grained control.

**Q5:** When log evidence increases confidence of a candidate, I assume a simple additive or weighted model (e.g., "log corroboration adds X to confidence score") rather than a probabilistic framework. Is there an existing confidence scoring mechanism in the pipeline that this should integrate with, and are there rough thresholds or weights you have in mind?
**Answer:** Use a simple additive/weighting approach; no need for complex scoring models in this increment.

**Q6:** The description says basic visibility. I assume this means adding metadata to candidates/clusters indicating "log-enriched: true" with a summary of contributing log signals (e.g., "3 endpoint hits observed, 12 error traces matched"), visible in existing review UI surfaces. Is that sufficient, or should there be a dedicated view or filter for log-influenced items?
**Answer:** Basic metadata/indicators on candidates is sufficient; no dedicated filtering UX needed yet.

**Q7:** What is the expected log volume for this initial version? I assume we are targeting moderate volumes (e.g., log files up to tens of MB, not GB-scale streaming), and that processing can be batch/synchronous rather than requiring background job infrastructure. Is that correct?
**Answer:** Yes — target moderate batch volumes, not large-scale streaming.

**Q8:** Beyond the out-of-scope items listed, is there anything else you want to make sure we do NOT build in this increment? Any specific edge cases or scenarios to avoid?
**Answer:** Yes — exclude complex correlation across systems, advanced log analytics, and any automatic destructive changes to candidates/entities.

### Existing Code to Reference
No similar existing features identified for reference. The user did not provide specific file paths or module names for the existing discovery pipeline, Phase 1a evidence extraction, evidence atom schema, candidate confidence scoring, or file upload mechanisms.

### Follow-up Questions
No follow-up questions were needed.

## Visual Assets

### Files Provided:
No visual assets provided. Mandatory bash check of the visuals folder confirmed no image files present.

## Requirements Summary

### Functional Requirements
- Ingest application logs into the discovery system via normal gateway/MCP-driven flow (file upload or file path/location reference)
- Support a small set of common log formats (JSON lines, syslog-style, common framework patterns) with simple auto-detection
- Extract evidence from logs including: endpoint usage (URLs, routes), service interaction patterns, error traces and stack hints, database/query usage signals, and user flow hints
- Produce log-derived evidence atoms using the same atom model and types as code-derived atoms, with a clear `source: "log"` marker
- Include log origin metadata (file path, line range) and timestamp/occurrence metadata on log-derived atoms
- Merge log-derived evidence into the existing discovery run — attach to existing atoms where relevant, create new atoms where needed
- Update confidence of related relationships/clusters using a simple additive/weighting approach
- Support explicit reprocessing of downstream phases (1b relationships, 1c clusters, 1d candidates) in sequence after log enrichment
- Allow log evidence to increase confidence of candidates, fill missing attributes (e.g., endpoints actually used), and highlight unused/low-signal candidates
- Expose basic metadata/indicators on candidates showing that log data contributed (e.g., log-enriched flag, summary of contributing signals)

### Reusability Opportunities
- Existing Phase 1a evidence extraction logic should be extended rather than duplicated
- The same evidence atom model/schema should be reused with the addition of log-specific metadata fields
- Existing gateway/MCP-driven flow patterns should be followed for the ingestion endpoint
- Discovery pipeline orchestration (phase chaining) should be leveraged for the reprocessing capability
- Existing candidate confidence scoring mechanism should be extended with additive log-based adjustments

### Scope Boundaries
**In Scope:**
- Basic log ingestion (file upload and file path/location reference) through existing gateway/MCP patterns
- Simple auto-detection of common log formats
- Rule-based (deterministic) log parsing and evidence extraction
- Log-derived evidence atoms with source: "log" and origin/timestamp metadata
- Basic evidence integration (attach to existing atoms, create new ones, update confidence)
- Explicit sequential reprocessing of phases 1b-1d after enrichment
- Non-destructive candidate enrichment (confidence boost, attribute filling, low-signal highlighting)
- Basic log influence visibility via metadata/indicators on candidates

**Out of Scope:**
- Real-time/streaming log ingestion
- Complex log parsing frameworks or advanced format handling
- Advanced correlation across distributed systems
- Advanced log analytics
- Automatic deletion or overwriting of candidates/entities based on logs
- Any automatic destructive changes to candidates or saved canonical entities
- Frontend-heavy log visualization or dedicated log filtering UX
- AST enrichment
- Language/version-specific analyzer packs
- Complex probabilistic confidence scoring models
- Fine-grained selective phase re-runs (e.g., just 1c without 1b)
- Heavy LLM use for log parsing

### Technical Considerations
- Log parsing should be rule-based and deterministic-first; no heavy LLM use in this increment
- Log-derived evidence must be clearly traceable: source = "log", origin reference (file/time)
- The system must handle log enrichment incrementally without requiring a full reset of discovery state
- Target moderate batch volumes (tens of MB log files), not GB-scale or streaming
- Processing can be batch/synchronous; no background job infrastructure required for this increment
- Logs augment discovery — they do not replace code-based evidence
- Existing candidates and saved entities must not be removed or corrupted
- This increment enables increment 15 (hypothesis-first discovery and Q&A with users) and deeper refinement loops combining code, logs, and human input
