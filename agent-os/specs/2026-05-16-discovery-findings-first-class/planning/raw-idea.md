Feature name: Discovery Findings/Evidence as a First-Class Discovery Concept

Feature summary:
Extend discovery-service, architecture-model-service, gateway, and frontend so discovery runs can produce and review durable Discovery Findings in addition to architecture candidates, evidence atoms, relationships, clusters, and decision tasks.

Discovery Findings represent migration-useful intelligence that may not belong directly in the architecture model, such as risks, data quality issues, unresolved ambiguities, runtime observations, low-confidence detections, dependency risks, test-data hints, reconciliation hints, and evidence summaries.

This creates the platform foundation for richer code discovery, future database discovery packs, and eventual migration-planning workflows that consume:
- Current State Architecture
- Discovery Findings/Evidence
- Target State Architecture
- OAS/API Behaviour Baselines
- Current-to-target mappings
to generate an accurate hierarchical book of work: roadmap, migration backlog, epics, features, and shape-spec-ready stories.

Primary goal: Make Discovery Findings/Evidence a first-class, durable, reviewable concept without requiring every existing language/framework/dependency pack to be rewritten in this spec.

V1 scope:
- Add durable DiscoveryFinding persistence in architecture-model-service.
- Add DTOs, repository, service, controller, and REST APIs for findings.
- Add discovery-service support for emitting findings generically (FindingEmitter).
- Add central/common finding emission from existing discovery pipeline stages where possible.
- Add frontend Findings review UI to discovery run detail.
- Add Evidence Explorer improvements where needed.
- Allow findings to link to discovery evidence, candidates, relationships, decision tasks, and saved architecture elements.
- Allow user review actions: accept, ignore, mark needs review, add notes, link to candidate/evidence/architecture element.
- Keep existing candidate review/save-back flow working unchanged.
- Prepare the model so later specs can wire Java/Spring/Maven packs and DB packs into the findings system.

Out of scope for v1:
- Full Java/Spring/Maven pack-specific findings.
- Database discovery packs.
- Migration book-of-work generation.
- Creating backlog/work items directly from findings.
- Automatic semantic diff of architectures.
- Replacing existing discovery candidates/evidence/decision tasks.
- Persisting huge raw evidence blobs beyond what already exists.
- LLM-generated migration plans from findings.

Services touched: architecture-model-service, discovery-service, gateway (if proxied), frontend.

Existing concepts to preserve: DiscoveryRun, DiscoveryCandidate, DiscoveryEvidence, DiscoveryRelationship, DiscoveryCluster, DiscoveryDecisionTask, candidate review/save-back into Current State Architecture.

New concept: DiscoveryFinding — a durable, reviewable conclusion or observation produced during a discovery run. Not necessarily an architecture entity.

AMS additions:
- `discovery_findings` table with: id, run_id, project_id, architecture_id, finding_type, category, severity, confidence, status, title, summary, detail_json, source, created_by_stage, created_at, updated_at, reviewed_at (nullable), reviewer_notes (nullable). Status: new/accepted/ignored/needs_review/resolved. Severity: info/low/medium/high/critical. Category: architecture/migration_risk/data_quality/runtime_usage/dependency/security/performance/testability/reconciliation/ambiguity/evidence_gap/unsupported_pattern/business_logic/sample_data/other.
- `discovery_finding_links` table with: id, finding_id, link_type, target_type, target_id, label (nullable), created_at. Link_type: supports/derived_from/related_to/blocks/resolves/saved_as/references. Target_type examples: discovery_evidence, discovery_candidate, discovery_relationship, discovery_cluster, discovery_decision_task, architecture_element, (future-only: work_item, api_behaviour_baseline).
- DTOs: DiscoveryFindingDto, DiscoveryFindingLinkDto, CreateDiscoveryFindingRequest, UpdateDiscoveryFindingRequest, ReviewDiscoveryFindingRequest, DiscoveryFindingSearchResponse, BulkCreateDiscoveryFindingsRequest.
- REST endpoints under `/api/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/findings(/[id|bulk|/{id}/review])` and `.../findings/{findingId}/links(/{linkId})`.
- Query filters: category, findingType, severity, status, source, createdByStage, linkedTargetType, linkedTargetId.
- Validation: finding must belong to run/project/architecture; linked evidence/candidate/relationship/decision task must belong to same run; linked architecture element must belong to same architecture; status transitions validated; reviewer notes addable without status change.
- Indexes: run_id, project_id, architecture_id, status, category, severity, finding_type, source.

Discovery-service additions:
- New generic utility `services/findings/FindingEmitter.ts` with `emitFinding({...})` and `emitFindings([...])`. Normalizes type/category/severity/status; attaches run/project/architecture IDs; attaches evidence/candidate/relationship/decision-task links; dedupes obvious repeats (key: runId + findingType + category + title + primary linked target); persists via archModelClient; non-critical failures log warning and DO NOT fail the discovery run.
- archModelClient methods: createDiscoveryFinding, bulkCreateDiscoveryFindings, listDiscoveryFindings, updateDiscoveryFinding, reviewDiscoveryFinding, createDiscoveryFindingLink.
- v1 central finding sources (without rewriting every pack):
  A. Low-confidence candidates (low_confidence_candidate / ambiguity / low-medium)
  B. Unresolved decision tasks (unresolved_decision_task / ambiguity / medium)
  C. Candidate conflicts/duplicates (candidate_conflict / ambiguity / medium)
  D. Runtime/log endpoint not matched to code (unmatched_runtime_endpoint / runtime_usage / medium-high)
  E. Endpoint candidate with runtime evidence (runtime_usage_observation / runtime_usage / info)
  F. Ambiguous relationship inference (ambiguous_relationship / ambiguity / low-medium)
  G. Unsupported/partially supported pattern (unsupported_pattern / unsupported_pattern / medium)
  H. Evidence gaps (evidence_gap / evidence_gap / medium) — endpoint without response schema, interface without contract detail, service candidate with no owner, data entity without attributes
- LLM enrichment compatibility: do NOT require LLM enrichment in v1, but ensure finding shape (summary, detail_json, confidence, source, created_by_stage) supports it.
- Existing candidate save-back flow must continue unchanged.

Frontend additions:
- New Findings tab on Discovery Run Detail.
- Findings list/table: severity, category, type, title, summary, confidence, status, source/stage, linked target count, created at. Filters: status/severity/category/type/source/text-search. Default grouping: severity then category.
- Finding detail drawer/modal: title/summary/detail JSON readable, severity/category/type/status, confidence, source/stage, linked evidence/candidates/relationships/decision tasks/architecture elements, reviewer notes. Actions: accept/ignore/mark needs review/mark resolved/add notes/open linked items/link to architecture element where practical.
- Evidence Explorer improvements: show which findings reference each evidence item; if no dedicated explorer exists, provide linked evidence panel in finding detail drawer. User can navigate finding↔evidence, finding↔candidate, and from candidate/evidence back to linked findings.
- Review actions update AMS (accepted/ignored/needs_review/resolved).
- Discovery run detail summary counts: total / critical+high / needs_review / accepted / ignored.

Gateway: proxy routes for list findings, get finding, create/update/review finding, list/create/delete finding links. No business logic in gateway.

Testing requirements: AMS tests (create with validation, list, filter, update, link create/reject/delete, bulk create), discovery-service tests (FindingEmitter normalize+persist+failure-soft, dedupe, each v1 finding source), frontend tests (Findings tab, table render, filters, drawer open, linked refs, accept/ignore/needs-review/notes actions, summary counts update), gateway tests if added.

Acceptance criteria summary: durable scope-validated persistence, link types as listed, existing candidate flows unchanged, FindingEmitter present, v1 finding sources emit, reviewable in frontend, queryable/filterable, durable post-run, generic enough for later packs, doesn't pollute architecture model, future migration planning can consume.

Implementation notes:
- Do not rename existing DiscoveryEvidence.
- DiscoveryEvidence remains raw/supporting evidence.
- DiscoveryFinding is a reviewed/derived observation.
- DiscoveryCandidate remains the path to save architecture model elements.
- Findings should NOT automatically become architecture entities.
- Findings should support future "create work item" action (out of scope v1).
- Keep categories broad/extensible.
- Avoid enum rigidity if codebase prefers string fields for discovery extensibility.
- Prefer detail_json for pack-specific data.
- Do not require LLM enrichment to emit in v1.
- Keep code pack-specific finding enhancements for the next spec.
