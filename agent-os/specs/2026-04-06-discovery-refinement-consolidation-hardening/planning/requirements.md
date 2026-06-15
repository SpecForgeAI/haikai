# Spec Requirements: Discovery Refinement, Consolidation, and System Hardening

## Initial Description
Final increment (16 of 16) for the legacy/current-state discovery capability -- focusing on pipeline robustness, idempotency, data consistency, performance baseline, configuration extension readiness, observability/diagnostics, lightweight UX polish, and internal documentation to stabilize and production-harden the full discovery system.

Previous increments delivered: full discovery pipeline (Phase 0 + Phase 1a-1d), candidate generation and save-back, visibility and review workflow, log-based enrichment, and hypothesis-first Q&A with users. This final increment focuses on refinement, consolidation, and production readiness.

## Requirements Discussion

### First Round Questions

**Q1:** I assume "safe re-execution" means that re-running the full pipeline (Phase 0 through Phase 1a-1d) against the same project/repo should produce the same evidence and candidates without creating duplicates -- essentially using stable identifiers (e.g., hashing evidence source + location + type) to detect and skip already-persisted evidence/candidates on subsequent runs. Is that correct, or does idempotency also need to cover partial re-runs (e.g., re-running only Phase 1c onward after a mid-pipeline failure)?
**Answer:** Yes, full re-execution against the same inputs should be safe and non-duplicative, and partial re-runs should also behave cleanly where the existing pipeline already supports them.

**Q2:** I assume "tolerant of partial failures" means that if, say, Phase 1b fails, the pipeline should persist the successful Phase 1a results, mark the run as FAILED with a clear indication of which step failed, and allow a new run to be started (rather than requiring manual cleanup). Should a re-run after partial failure re-process all steps from scratch, or should it be able to resume from the failed step?
**Answer:** Persist what succeeded, mark the run failed with clear step context, and keep recovery simple; a fresh re-run is the default unless partial restart is already naturally supported.

**Q3:** I assume "orphaned data cleanup" refers to evidence records that no longer link to valid candidates, candidates that reference deleted entities, and stale run records in FAILED/CANCELLED status beyond a retention period. Should cleanup be automatic (triggered at pipeline start or on a schedule) or manual (an explicit "clean up" action)? And is there a retention policy you have in mind for historical runs (e.g., keep last N runs, or keep all)?
**Answer:** Keep cleanup lightweight and explicit in this increment; do not introduce aggressive automatic retention/deletion policies yet.

**Q4:** I assume "basic performance acceptable for typical repos" means establishing that the full pipeline completes within a reasonable wall-clock time (e.g., under 5 minutes for a mid-size repo). Are there specific targets you have in mind, or should this increment simply identify and remove obvious bottlenecks (e.g., N+1 queries, unnecessary sequential waits) without committing to hard SLAs?
**Answer:** Yes, remove obvious bottlenecks and improve baseline behavior without committing to hard SLAs in this increment.

**Q5:** I assume "run-level logging and phase timing" means adding structured log output (JSON or tagged lines) that records: run ID, phase/step name, start/end timestamps, evidence count per step, and any errors -- queryable from container logs. Should there also be an API endpoint to retrieve diagnostics for a given run (e.g., GET /discovery/runs/:runId/diagnostics), or is log-based observability sufficient for this increment?
**Answer:** Structured run/phase logging is the main goal; only add diagnostic read surfaces if they fit naturally and cheaply.

**Q6:** I assume "lightweight UX polish" means improvements to the existing discovery results visibility dashboard and candidate review UI -- things like clearer status labels, better empty states, progress indicators during pipeline execution, and more descriptive error messages. Does it include any changes to the hypothesis-first Q&A UI, or is that out of scope for polish?
**Answer:** Focus on discovery results/review clarity and basic usability; do not expand the scope into major new Q&A UX work.

**Q7:** I assume "internal documentation" means markdown files within the repository (e.g., in a docs/ folder or within the discovery-service/ directory) covering: pipeline phase descriptions, evidence schema reference, DecisionTask engine mechanics, analyzer-pack authoring guide, and save-back contract specification. Is that the right location and format, or do you prefer inline code comments, a wiki, or another approach?
**Answer:** Repository-based markdown documentation is the right default, supported by clear code-level contracts where useful.

**Q8:** Is there anything you explicitly want to exclude beyond what's already listed (no major new features, no advanced perf optimization, no full analyzer-pack library, no deep UI redesign, no new discovery phases)? For example: should we avoid any database schema migrations in this increment, or are minor migrations acceptable for cleanup/consistency purposes?
**Answer:** Minor migrations that improve consistency are acceptable, but do not turn this increment into broad schema redesign or new feature expansion.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: Discovery Service skeleton and pipeline -- Path: `discovery-service/`
- Feature: Discovery Run Model and Orchestration (Increment 5) -- Path: `discovery-service/src/routes/phase1.ts`, `discovery-service/src/services/analyzerRegistry.ts`
- Feature: DiscoveryConfigEntity persistence stack -- Path: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/DiscoveryConfigEntity.java` and related service/controller/repository
- Feature: DiscoveryRunEntity persistence stack -- Path: `architecture-model-service/` (following DiscoveryConfigEntity pattern, introduced in Increment 5)
- Feature: Gateway discovery routes -- Path: `gateway/src/routes/discovery.ts`
- Feature: MCP discovery tools -- Path: `mcp-server/src/routes/saveDiscoveryConfigRoute.ts`, `mcp-server/src/services/discoveryConfigService.ts`
- Feature: Discovery results visibility dashboard (Increment 11) -- referenced for UX polish scope
- Feature: Candidate review and approval workflow (Increment 12) -- referenced for UX polish scope
- Feature: Candidate save-back to canonical model (Increment 13) -- referenced for idempotency and data consistency
- Feature: Log-based discovery enrichment (Increment 14) -- referenced for pipeline robustness
- Feature: Hypothesis-first discovery Q&A (Increment 15) -- referenced as out of scope for UX polish

No additional similar features were identified by the user for direct reuse beyond what was established in previous increments.

### Follow-up Questions

No follow-up questions needed. All answers were clear and provided sufficient detail for specification.

## Visual Assets

### Files Provided:
No visual assets provided (confirmed via file system check).

### Visual Insights:
N/A -- no visual assets to analyze.

## Requirements Summary

### Functional Requirements

**Pipeline Robustness and Consistency:**
- Full pipeline (Phase 0 through Phase 1a-1d) executes stably under repeated runs
- Tolerant of partial failures: persist successful step results, mark run as failed with clear step-level context
- Consistent state transitions throughout the pipeline lifecycle
- Fresh re-run is the default recovery path after failure; partial restart only where already naturally supported by existing pipeline

**Idempotency and Re-run Behavior:**
- Full re-execution against the same inputs produces no duplicates
- Stable identifiers used to detect and skip already-persisted evidence/candidates
- Phase 0 propagation does not create inconsistencies on re-run
- Save-back operations are non-duplicative (upsert semantics where applicable)
- Partial re-runs behave cleanly where the existing pipeline already supports them

**Data Consistency and Cleanup:**
- Evidence, candidate, and entity records remain consistent and traceable across runs
- Lightweight, explicit cleanup mechanisms for orphaned data (evidence without candidates, candidates without entities, stale runs)
- No aggressive automatic retention or deletion policies in this increment
- Manual or on-demand cleanup approach preferred

**Performance and Scaling Baseline:**
- Identify and remove obvious bottlenecks (N+1 queries, unnecessary sequential waits, etc.)
- Improve baseline behavior for typical repository sizes and evidence volumes
- No hard SLA commitments in this increment
- Ensure reasonable execution times without advanced optimization

**Configuration and Extension Readiness:**
- Analyzer-pack configuration hardened for stability
- Future AST enrichment hooks remain intact and usable
- Extension points are stable and well-defined for future additions
- No new analyzer packs or major configuration expansion

**Observability and Diagnostics:**
- Structured run-level logging: run ID, phase/step name, start/end timestamps, evidence counts, errors
- Phase timing captured in log output for performance visibility
- Error reporting with sufficient context for debugging
- Diagnostic read surfaces (API endpoints) only if they fit naturally and cheaply
- Log-based observability is the primary target

**UX Polish (Lightweight):**
- Improve clarity of discovery results on the visibility dashboard
- Improve candidate review UI usability (status labels, empty states, error messages)
- Basic progress indicators during pipeline execution
- Do not expand into major new Q&A UX work or deep UI redesign

**Documentation and Developer Clarity:**
- Repository-based markdown documentation covering:
  - Pipeline phase descriptions (Phase 0, Phase 1a-1d)
  - Evidence schema reference
  - DecisionTask engine mechanics
  - Analyzer-pack authoring guide
  - Save-back contract specification
- Clear code-level contracts (TypeScript interfaces, JSDoc) where useful
- Documentation lives within the repository (e.g., `discovery-service/docs/` or similar)

### Reusability Opportunities
- All existing discovery service code from Increments 1-15 forms the base for hardening work
- DiscoveryConfigEntity and DiscoveryRunEntity patterns for any minor migration work
- Existing gateway discovery routes for any proxy/routing improvements
- Existing MCP discovery tools for save-back idempotency improvements
- Existing discovery results dashboard components for UX polish
- Existing candidate review workflow components for UX polish

### Scope Boundaries

**In Scope:**
- Pipeline robustness: partial failure tolerance, consistent state transitions, stable repeated execution
- Idempotency: non-duplicative re-runs, stable identifiers, upsert semantics for save-back
- Data consistency: orphaned data detection and lightweight explicit cleanup
- Performance: remove obvious bottlenecks, improve baseline without hard SLAs
- Configuration: harden analyzer-pack config, preserve extension points
- Observability: structured logging with run/phase/timing/error context
- UX polish: discovery results clarity, candidate review usability, status messaging
- Documentation: internal markdown docs for phases, evidence schema, DecisionTask engine, analyzer packs, save-back contracts
- Minor database migrations where needed for consistency improvements

**Out of Scope:**
- Major new features or new discovery phases
- Advanced performance optimization or hard SLA commitments
- Full analyzer-pack library expansion
- Deep UI redesign or major Q&A UX changes
- Broad database schema redesign
- Aggressive automatic retention/deletion policies
- New feature expansion disguised as hardening
- Authentication/authorization changes
- WebSocket/streaming additions

### Technical Considerations
- This is the final increment (16 of 16) -- the focus is stabilization, not new capability
- The discovery-service is an Express/TypeScript micro-service with its own routes, services, and types
- The architecture-model-service (Java/Spring Boot) handles persistence for discovery config, runs, evidence, and candidates
- The gateway proxies discovery operations to the discovery-service
- Minor Liquibase migrations are acceptable for consistency but should not constitute broad schema changes
- Structured logging should follow container-friendly patterns (JSON or tagged lines queryable from Docker logs)
- Documentation should be written for internal developer consumption, not end-user facing
- All hardening work should maintain backward compatibility with existing discovery data and workflows
