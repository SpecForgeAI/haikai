# Hook Migration Planning and API Migration Validation into Rich Discovery Data

## Feature summary

Integrate the richer discovery output — Current State Architecture plus Discovery Findings/Evidence — into migration planning and API Behaviour Baseline capture so future migration workflows can generate a highly accurate hierarchical book of work.

The migration planning workflow should consume:
1. Current State Architecture
2. Discovery Findings/Evidence
3. Target State Architecture
4. OAS/API Behaviour Baselines
5. Current-to-target mappings

to generate a structured roadmap/backlog/specification-ready hierarchy later.

This spec does NOT implement the full Product Manager migration delivery plan generation. It creates the shared discovery-context integration layer required by that future feature and improves api-migration-validation-service request generation by allowing it to use Discovery Findings/Evidence.

## Key product principle

Discovery + evidence + target architecture + mappings + API baselines must be rich enough to generate an accurate, implementation-ready hierarchical book of work.

## Primary goal

Make rich discovery context available to:
- migration planning prompts/context resolvers
- api-migration-validation-service request/scenario generation
- future Migration Test Pack and reconciliation workflows
- future shape-spec-ready story generation

## V1 scope

- Add a Migration Discovery Context builder/API.
- Aggregate Current State Architecture, Discovery Findings/Evidence, Discovery Candidates, Discovery Relationships, Decision Tasks, runtime/log evidence, DB discovery findings, and saved architecture mappings.
- Make this context available through gateway context resolvers for future migration-planning tasks.
- Make relevant discovery findings/evidence available to api-migration-validation-service during API Behaviour Baseline capture.
- Use discovery findings/evidence to improve API request generation, DB sampling hints, scenario selection, and coverage warnings.
- Add frontend indicators showing whether migration discovery context is sufficient or has gaps.
- Add tests proving discovery findings are included in migration/API baseline context.
- Do not generate the final migration roadmap/backlog in this spec.

## Out of scope

- Full Product Manager "Create Migration Delivery Plan" task.
- Generating roadmap/backlog/work items.
- Generating shape-specs.
- Target API reconciliation.
- Database reconciliation.
- Executing data migration.
- Creating actual migration test harness.
- Replacing existing discovery review UI.
- New database discovery pack implementation.
- New API Behaviour Baseline capture persistence schema.

## Services touched

- architecture-model-service
- discovery-service
- gateway
- api-migration-validation-service
- frontend

## Assumptions

- Discovery Findings/Evidence exists (predecessor `2026-05-16-discovery-findings-first-class/`).
- Java/Spring/Maven packs may emit findings (predecessor `2026-05-16-wire-java-spring-maven-findings/`).
- Database discovery packs may emit findings (predecessor `2026-05-16-database-discovery-packs-sybase-postgres/`).
- API Behaviour Baseline Capture Service exists (`2026-05-15-api-behaviour-baseline-capture-service/` and `2026-05-16-api-behaviour-capture-fixes/`).
- ArchitectureElementMapping exists (`2026-05-15-create-target-baseline-from-current-state/`).
- Current and target architectures are selected explicitly.
- OAS/API Behaviour Baselines are available where produced.

---

## Core concept: Migration Discovery Context

Migration Discovery Context is a structured, bounded, LLM-ready and UI-readable summary of discovery knowledge relevant to a migration.

It is NOT a new user-authored artefact. It is an assembled context bundle derived from existing durable data.

### Inputs
- projectId
- currentArchitectureId
- targetArchitectureId (optional in some contexts)
- selected discoveryRunIds (optional)
- selected apiBehaviourBaselineIds (optional)
- includeFindings boolean
- includeEvidence boolean
- includeRuntimeEvidence boolean
- includeDbFindings boolean
- includeMappings boolean

### Outputs
- architecture summary
- discovery run summary
- findings summary
- high-priority findings
- evidence highlights
- candidate summary
- unresolved decision tasks
- runtime/log observations
- DB profile/risk highlights
- sample-data/test-data hints
- API/OAS/API Behaviour Baseline references
- current-to-target mapping summary
- readiness/gap assessment

---

## Migration Discovery Context DTO shape

**Suggested DTO:** `MigrationDiscoveryContextDto`

Fields:
- projectId
- currentArchitectureId
- targetArchitectureId (nullable)
- discoveryRunIds
- apiBehaviourBaselineIds
- generatedAt
- summary
- currentArchitectureSummary
- targetArchitectureSummary (nullable)
- discoveryRunsSummary
- findingsSummary
- highPriorityFindings
- findingsByCategory
- evidenceHighlights
- candidateSummary
- unresolvedDecisionTasks
- runtimeUsageSummary
- databaseDiscoverySummary
- apiBehaviourBaselineSummary
- architectureMappingsSummary
- readinessAssessment
- contextWarnings

`readinessAssessment` should include:
- overallStatus: `sufficient | partial | insufficient`
- apiReadiness
- dataReadiness
- infrastructureReadiness
- discoveryReadiness
- mappingReadiness
- baselineReadiness
- gaps

Example gap codes:
- `no_api_behaviour_baseline`
- `unresolved_discovery_decisions`
- `missing_current_to_target_mappings`
- `no_database_discovery_findings`
- `high_severity_unreviewed_findings`
- `missing_oas_for_in_scope_interface`
- `insufficient_runtime_evidence`
- `no_sample_data_hints`

---

## Part 1: architecture-model-service aggregation APIs

Add AMS APIs to expose rich discovery/migration context.

**Suggested endpoint:**
```
POST /api/projects/{projectId}/migration-discovery-context

Request:
{
  "currentArchitectureId": "uuid",
  "targetArchitectureId": "uuid",
  "discoveryRunIds": ["uuid"],
  "apiBehaviourBaselineIds": ["uuid"],
  "includeFindings": true,
  "includeEvidence": true,
  "includeRuntimeEvidence": true,
  "includeDbFindings": true,
  "includeMappings": true,
  "maxFindings": 100,
  "maxEvidenceItems": 100
}

Response: MigrationDiscoveryContextDto
```

### Aggregation requirements

- Load Current State Architecture summary.
- Load Target State Architecture summary when provided.
- Load discovery runs for current architecture.
- If discoveryRunIds omitted, use latest relevant completed runs for current architecture.
- Load Discovery Findings for selected runs.
- Prioritise findings: critical/high severity, needs_review, accepted, migration_risk, data_quality, business_logic, runtime_usage, reconciliation, testability, sample_data.
- Load linked evidence for high-priority findings.
- Load unresolved decision tasks.
- Load discovery candidates summary.
- Load runtime/log evidence summary where available.
- Load DB discovery findings/evidence where available.
- Load API Behaviour Baseline summaries for selected architecture/project.
- Load ArchitectureElementMappings between current and target architecture where provided.
- Produce readiness assessment.

**Do not return unbounded raw evidence. Apply limits and summarisation.**

---

## Part 2: discovery-service context support

Discovery-service should expose or support retrieval of discovery outputs in a way AMS/gateway can aggregate.

If AMS already owns all discovery state: no new discovery-service read endpoint is required.

If discovery-service owns any non-AMS discovery runtime details: add read endpoints or persist required summaries into AMS.

**Required discovery context categories:**
- run metadata
- candidates
- evidence
- findings
- relationships
- decision tasks
- runtime/log observations
- DB discovery summaries
- sample-data hints
- reconciliation hints

Discovery-service should ensure future runs persist enough summary data so AMS can assemble context without calling discovery-service for transient state.

---

## Part 3: gateway migration context resolver

Add a gateway context resolver for future migration planning tasks.

**Suggested resolver name:** `migration-discovery-context`

### Input parameters
- projectId
- currentArchitectureId
- targetArchitectureId
- discoveryRunIds (optional)
- apiBehaviourBaselineIds (optional)
- maxFindings (optional)
- maxEvidenceItems (optional)

### Responsibilities
- Call AMS migration-discovery-context endpoint.
- Transform response into prompt-ready context.
- Keep prompt content bounded.
- Include citations/IDs/references to durable objects.
- Preserve enough structured detail for later save-back/book-of-work generation.

### Prompt-ready structure should include
- migration context summary
- current architecture highlights
- target architecture highlights
- high-priority findings
- unresolved decisions
- evidence-backed risks
- API baseline coverage
- data/database discovery highlights
- current-to-target mapping coverage
- readiness gaps
- recommended prerequisite work where gaps exist

**The resolver must not invent missing details.**

If context is insufficient: mark readiness as partial/insufficient, include explicit gaps, recommend prerequisite discovery/mapping/API-baseline work.

---

## Part 4: api-migration-validation-service integration

Enhance API Behaviour Baseline Capture so it can optionally use Discovery Findings/Evidence.

### Use cases
- Better request/scenario generation.
- Better DB sampling hints.
- Better endpoint prioritisation.
- Better warning/coverage assessment.
- Better business-behaviour notes.

### Input

When creating/starting capture session, allow optional:
- discoveryRunIds
- includeDiscoveryContext boolean
- maxDiscoveryFindings
- maxEvidenceItems

### Service behaviour
- Before capture loop, fetch migration discovery context or API-focused discovery context.
- Provide relevant context to the LLM tool loop.
- Include only bounded summaries and relevant evidence, not huge raw payloads.

### Relevant discovery inputs for API capture
- endpoint candidates
- runtime/log endpoint usage
- unmatched runtime endpoints
- missing contract detail findings
- hardcoded URL/integration findings
- raw SQL findings related to endpoint code
- stored procedure/JDBC findings related to endpoint code
- DB sample-data hints
- data quality findings relevant to request generation
- candidate service/interface/endpoint relationships
- OAS/interface references
- decision tasks affecting API behaviour

### How it should help
- prioritise high-usage endpoints
- generate more meaningful scenario names
- identify endpoints with insufficient evidence
- suggest path/query/body values from DB sample-data hints
- avoid endpoints known to be unsupported/ambiguous
- add warnings where behaviour is uncertain
- annotate captures with discovery evidence references

### api-migration-validation-service changes
- Add AMS client call to migration-discovery-context endpoint.
- Add context injection into captureLoopRunner initial prompt.
- Add per-operation discovery hints lookup.
- Add optional discoveryContextSummary to session/run metadata if useful.
- Do not persist raw secrets or unbounded evidence.

### Tool loop prompt should explicitly state
- Discovery findings are supporting evidence.
- Do not invent behaviour beyond OAS/API response evidence.
- Use DB sample hints where available.
- If discovery indicates uncertainty, record a note/warning.

---

## Part 5: frontend integration

### A. API Behaviour Baseline capture wizard

Add optional Discovery Context step or section.

Fields:
- include discovery context checkbox
- discovery run selector
- show latest completed discovery runs for current architecture
- show finding summary for selected runs
- show warning if no discovery findings available

Default: include latest relevant discovery context if available.

Display:
- selected run count
- finding counts by severity/category
- unresolved decision task count
- sample-data hint count
- API/runtime finding count
- DB finding count if available

### B. Capture results review

Show discovery-supported notes where available:
- scenario generated using DB sample hint
- endpoint prioritised due to runtime usage
- warning: endpoint has missing contract detail finding
- warning: unresolved decision task affects this endpoint
- warning: no discovery evidence linked to this endpoint

### C. Future migration planning readiness panel

Add a lightweight readiness panel, if there is a suitable Product/Migration prep area.

The panel should show whether the project has:
- Current State Architecture
- Target State Architecture
- Discovery Findings/Evidence
- OAS/API Behaviour Baseline
- Current-to-target mappings

Status: `ready | partial | missing`

**This panel does NOT generate roadmap/backlog yet.**

---

## Part 6: readiness/gap assessment rules

Implement simple deterministic readiness rules.

**API readiness:**
- sufficient: OAS specs and API Behaviour Baseline exist for in-scope interfaces.
- partial: OAS exists but no baseline.
- insufficient: no OAS/interface detail.

**Discovery readiness:**
- sufficient: completed discovery run has reviewed/accepted findings and candidates.
- partial: findings exist but many high-severity/unreviewed items remain.
- insufficient: no completed discovery run.

**Data readiness:**
- sufficient: data architecture exists and DB discovery findings/profile exist.
- partial: data architecture exists but no DB findings.
- insufficient: no data architecture.

**Mapping readiness:**
- sufficient: ArchitectureElementMappings exist between current and target.
- partial: mappings exist only for some major domains.
- insufficient: no mappings.

**Baseline readiness:**
- sufficient: API Behaviour Baseline active and has accepted captures.
- partial: capture session exists but baseline not saved.
- insufficient: no capture session/baseline.

**Decision readiness:**
- sufficient: no unresolved high-priority decision tasks.
- partial: low/medium unresolved decisions exist.
- insufficient: high/critical unresolved decisions exist.

**Overall:**
- sufficient only when core selected migration streams are sufficient.
- partial if some gaps can be resolved by prerequisite stories.
- insufficient if critical inputs are missing.

---

## Part 7: tests

### AMS tests
1. Builds migration discovery context with current architecture only.
2. Builds migration discovery context with current and target architectures.
3. Includes selected discovery findings.
4. Prioritises high severity findings.
5. Includes linked evidence summaries.
6. Includes unresolved decision tasks.
7. Includes runtime/log finding summaries.
8. Includes DB discovery finding summaries.
9. Includes API Behaviour Baseline summary.
10. Includes ArchitectureElementMapping summary.
11. Applies maxFindings and maxEvidenceItems limits.
12. Returns readiness assessment with expected gaps.
13. Uses latest completed discovery run when discoveryRunIds omitted.
14. Rejects context request when architecture/project mismatch.

### Gateway tests
15. migration-discovery-context resolver calls AMS.
16. Resolver emits bounded prompt-ready context.
17. Resolver marks insufficient context when required inputs are missing.
18. Resolver includes IDs/references to findings/evidence/baselines/mappings.

### api-migration-validation-service tests
19. Capture session can request discovery context.
20. Service fetches discovery context before capture loop.
21. LLM prompt includes relevant endpoint/runtime/sample-data hints.
22. Discovery context is bounded and does not include excessive raw evidence.
23. API capture proceeds when discovery context is unavailable but logs warning.
24. Endpoint with runtime usage finding is prioritised or annotated.
25. Endpoint with missing contract detail finding produces warning/note.
26. DB sample-data hint can be passed to request generation prompt.

### Frontend tests
27. Capture wizard shows discovery context selector.
28. Latest completed discovery run can be selected.
29. Finding summary renders in wizard.
30. Capture review displays discovery-supported notes/warnings.
31. Readiness panel shows missing Current State Architecture, Target State Architecture, Discovery Findings/Evidence, API Baseline, and mappings.
32. Readiness status updates when inputs are present.

### Integration tests
33. Given discovery findings, API baseline, and mappings exist, migration-discovery-context returns them in one response.
34. Given no discovery findings, response includes explicit gap.
35. Given high-severity unresolved finding, readiness is partial or insufficient according to rules.

---

## Acceptance criteria

1. AMS can assemble a bounded Migration Discovery Context from current architecture, target architecture, discovery findings/evidence, API baselines, and mappings.
2. Gateway exposes a migration-discovery-context resolver for future migration planning tasks.
3. api-migration-validation-service can include discovery findings/evidence in API Behaviour Baseline capture.
4. API capture prompt receives endpoint-specific discovery hints where available.
5. Discovery findings can influence scenario selection, warnings, DB sample hints, and coverage notes.
6. Frontend lets users select/include discovery context when capturing API behaviour baselines.
7. Frontend shows readiness/gap indicators for migration preparation.
8. The system clearly distinguishes available evidence from missing prerequisites.
9. No migration roadmap/backlog generation is implemented in this spec.
10. The resulting context is suitable for the future Product Manager migration workflow to generate an accurate hierarchical book of work.

---

## Implementation notes

- Keep this spec focused on context integration, not generation of the final migration plan.
- Do not move discovery ownership into api-migration-validation-service.
- Do not duplicate findings/evidence persistence.
- Keep AMS as the source of truth for durable context.
- Keep discovery context bounded for LLM use.
- Prefer deterministic readiness rules in v1.
- Make context useful both to humans and LLM prompts.
- Ensure future migration planning can consume the same context resolver.
- Preserve the key product principle in comments/docs where appropriate:
  > Discovery + evidence + target architecture + mappings + API baselines must be rich enough to generate an accurate, implementation-ready hierarchical book of work.
