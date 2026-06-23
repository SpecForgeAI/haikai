/**
 * Per-source builders for the seven v1 Discovery Finding emission points.
 *
 * Spec: 2026-05-16 Discovery Findings -- Task Group 5 (Phase 3 / Commit 3).
 *
 * Each builder returns a `FindingEmitInput` (no I/O). Callers in the pipeline
 * pass the result to `findingEmitter.emitFinding` (or accumulate into
 * `emitFindings`). Centralising shape construction here keeps the call
 * sites short, the dedupe / normalization behaviour consistent, and the
 * tests focused on the shape per source rather than the pipeline plumbing.
 *
 * Source G `unsupported_pattern` is DEFERRED (D4). There is intentionally
 * NO builder for it -- the test suite asserts `unsupported_pattern` is
 * never emitted in v1.
 */

import type { FindingEmitInput } from './FindingEmitter';
import type { DiscoveryFindingLinkPayload } from '../archModelClient';
import { AMBIGUOUS_THRESHOLD } from '../../constants/linkerDefaults';

/**
 * Source A: low-confidence candidate (post-merge in `discoveryV3Pipeline`).
 *
 * Severity ladder mirrors the existing triage thresholds:
 *   - confidence < AMBIGUOUS_THRESHOLD (currently 0.5) -> 'low' severity
 *   - confidence in [AMBIGUOUS_THRESHOLD, 0.7)          -> 'medium' severity
 *   - confidence >= 0.7 is NOT emitted as a finding (handled elsewhere).
 */
export function buildLowConfidenceCandidateFinding(args: {
  candidateId: string;
  candidateName: string;
  candidateType: string;
  confidence: number;
  supportingEvidenceIds?: string[];
}): FindingEmitInput {
  const severity = args.confidence < AMBIGUOUS_THRESHOLD ? 'low' : 'medium';
  const links: DiscoveryFindingLinkPayload[] = [
    {
      linkType: 'supports',
      targetType: 'discovery_candidate',
      targetId: args.candidateId,
    },
    ...(args.supportingEvidenceIds ?? []).map((evidenceId) => ({
      linkType: 'derived_from',
      targetType: 'discovery_evidence' as const,
      targetId: evidenceId,
    })),
  ];
  return {
    findingType: 'low_confidence_candidate',
    category: 'ambiguity',
    severity,
    title: `Low-confidence candidate: ${args.candidateName}`,
    summary:
      `Candidate '${args.candidateName}' (${args.candidateType}) has confidence ${args.confidence.toFixed(2)}, ` +
      `below the auto-accept threshold. Review or supplement evidence.`,
    confidence: args.confidence,
    source: 'pipeline_triage',
    createdByStage: 'discoveryV3Pipeline.postMerge.lowConfidence',
    links,
  };
}

/**
 * Source B: unresolved decision task.
 *
 * Emitted alongside DecisionTask creation in `runManager.executeStep1b`.
 * Severity is fixed at 'medium' (D5 / spec). Links to the decision task
 * and (when available) to the related candidate(s) that produced it.
 */
export function buildUnresolvedDecisionTaskFinding(args: {
  decisionTaskId: string;
  taskType: string;
  title?: string;
  relatedCandidateIds?: string[];
  relatedEvidenceIds?: string[];
}): FindingEmitInput {
  const links: DiscoveryFindingLinkPayload[] = [
    {
      linkType: 'related_to',
      targetType: 'discovery_decision_task',
      targetId: args.decisionTaskId,
    },
    ...(args.relatedCandidateIds ?? []).map((id) => ({
      linkType: 'related_to',
      targetType: 'discovery_candidate' as const,
      targetId: id,
    })),
    ...(args.relatedEvidenceIds ?? []).map((id) => ({
      linkType: 'derived_from',
      targetType: 'discovery_evidence' as const,
      targetId: id,
    })),
  ];
  return {
    findingType: 'unresolved_decision_task',
    category: 'ambiguity',
    severity: 'medium',
    title: args.title ?? `Unresolved decision task (${args.taskType})`,
    summary:
      `Decision task '${args.taskType}' was created during triage and has not been resolved. ` +
      `Review the candidate set or competing options.`,
    source: 'pipeline_triage',
    createdByStage: 'triageEngine.decisionTaskCreation',
    links,
  };
}

/**
 * Source C: candidate conflict / duplicate (D3 -- in v1).
 *
 * Two distinct emission sites in the pipeline:
 *   1. `discoveryV3Pipeline.dedup` -- LLM dedup site, one finding per
 *      collapsed pair. Links the surviving + dropped candidates.
 *   2. `triageEngine.competingRelationships` -- when triage identifies
 *      a competing-relationships group, one finding per group.
 *
 * Severity 'medium', category 'ambiguity'.
 */
export function buildCandidateConflictFinding(args: {
  conflictingCandidateIds: string[];
  conflictDescription: string;
  stage: 'discoveryV3Pipeline.dedup' | 'triageEngine.competingRelationships';
  title?: string;
}): FindingEmitInput {
  const links: DiscoveryFindingLinkPayload[] = args.conflictingCandidateIds.map((id) => ({
    linkType: 'related_to',
    targetType: 'discovery_candidate' as const,
    targetId: id,
  }));
  return {
    findingType: 'candidate_conflict',
    category: 'ambiguity',
    severity: 'medium',
    title: args.title ?? 'Candidate conflict detected',
    summary: args.conflictDescription,
    source:
      args.stage === 'discoveryV3Pipeline.dedup'
        ? 'pipeline_dedup'
        : 'pipeline_triage',
    createdByStage: args.stage,
    links,
  };
}

/**
 * Source D: unmatched runtime endpoint observed in logs.
 *
 * Severity laddered by observed-usage count:
 *   - observedUsageCount >= 100 -> 'high'
 *   - otherwise -> 'medium'
 *
 * Links to the runtime evidence rows (when those have been persisted) and
 * to any near-miss candidate ids the caller can identify.
 */
export function buildUnmatchedRuntimeEndpointFinding(args: {
  method: string;
  pathTemplate: string;
  observedUsageCount: number;
  status2xxCount: number;
  status3xxCount: number;
  runtimeEvidenceIds?: string[];
  nearMissCandidateIds?: string[];
}): FindingEmitInput {
  const severity = args.observedUsageCount >= 100 ? 'high' : 'medium';
  const links: DiscoveryFindingLinkPayload[] = [
    ...(args.runtimeEvidenceIds ?? []).map((id) => ({
      linkType: 'derived_from',
      targetType: 'discovery_evidence' as const,
      targetId: id,
    })),
    ...(args.nearMissCandidateIds ?? []).map((id) => ({
      linkType: 'related_to',
      targetType: 'discovery_candidate' as const,
      targetId: id,
    })),
  ];
  return {
    findingType: 'unmatched_runtime_endpoint',
    category: 'runtime_usage',
    severity,
    title: `Unmatched runtime endpoint: ${args.method} ${args.pathTemplate}`,
    summary:
      `Observed ${args.observedUsageCount} successful (2xx+3xx) requests in logs ` +
      `but no code-discovered endpoint candidate matched.`,
    detailJson: {
      method: args.method,
      pathTemplate: args.pathTemplate,
      observedUsageCount: args.observedUsageCount,
      status2xxCount: args.status2xxCount,
      status3xxCount: args.status3xxCount,
    },
    source: 'runtime_log_enrichment',
    createdByStage: 'runtimeEvidence.endpointRuntimeMatcher',
    links,
  };
}

/**
 * Source D extension (Spec 2026-05-16 Wire Java/Spring/Maven Findings, D2):
 * an endpoint candidate that was discovered in code but had NO matching
 * runtime traffic in the processed log window.
 *
 * Why an info-severity finding type rather than (a) an extension to the
 * existing `unmatched_runtime_endpoint` shape or (b) a Spring-specific
 * `endpoint_code_runtime_mismatch` type:
 *  - `unmatched_runtime_endpoint` is "runtime hit / no code" -- the
 *    `runtime_evidence_ids` field is mandatory there. The no-usage case is
 *    "code / no runtime hit" -- there are no runtime evidence rows to link.
 *    Keeping them as separate finding types preserves the dedupe semantics
 *    of `(runId | findingType | category | title | primaryLinkedTarget)`.
 *  - The predecessor `runtime_usage_observation` (Source E) is already
 *    reserved for the matched case where `observedUsageCount > 0`. Using
 *    that type for the zero-usage case would produce title collisions
 *    (`"Runtime usage: GET /foo"`) and overload the semantic.
 *
 * Source = `runtime_log_enrichment` (same as Source D);
 * createdByStage = `runtimeEvidence.runDiscoveryRuntimeEvidence` (matches
 * the existing no-usage application step). Severity fixed at 'info' --
 * absence of usage is a signal, not a defect.
 *
 * Links: the endpoint candidate id (`supports`) so the Findings tab can
 * filter no-usage observations by candidate.
 */
export function buildUnusedCodeEndpointFinding(args: {
  candidateId: string;
  method: string;
  pathTemplate: string;
  note?: string;
}): FindingEmitInput {
  const links: DiscoveryFindingLinkPayload[] = [
    {
      linkType: 'supports',
      targetType: 'discovery_candidate',
      targetId: args.candidateId,
    },
  ];
  return {
    findingType: 'unused_code_endpoint',
    category: 'runtime_usage',
    severity: 'info',
    title: `No runtime usage observed: ${args.method} ${args.pathTemplate}`,
    summary:
      `Endpoint candidate '${args.method} ${args.pathTemplate}' was discovered in code ` +
      `but no matching runtime traffic was observed in the processed log window.`,
    detailJson: {
      codeEndpointMethod: args.method,
      codeEndpointPath: args.pathTemplate,
      usageCount: 0,
      note:
        args.note ??
        'No matching log observations in processed log window. Absence of data is not evidence of removal.',
    },
    source: 'runtime_log_enrichment',
    createdByStage: 'runtimeEvidence.runDiscoveryRuntimeEvidence',
    links,
  };
}

/**
 * Source E: runtime usage observation on a matched endpoint candidate.
 *
 * Severity 'info' (informational only -- the match itself is a positive
 * signal; the finding is for traceability not triage).
 */
export function buildRuntimeUsageObservationFinding(args: {
  candidateId: string;
  method: string;
  pathTemplate: string;
  observedUsageCount: number;
  runtimeEvidenceIds?: string[];
}): FindingEmitInput {
  const links: DiscoveryFindingLinkPayload[] = [
    {
      linkType: 'supports',
      targetType: 'discovery_candidate',
      targetId: args.candidateId,
    },
    ...(args.runtimeEvidenceIds ?? []).map((id) => ({
      linkType: 'derived_from',
      targetType: 'discovery_evidence' as const,
      targetId: id,
    })),
  ];
  return {
    findingType: 'runtime_usage_observation',
    category: 'runtime_usage',
    severity: 'info',
    title: `Runtime usage: ${args.method} ${args.pathTemplate}`,
    summary:
      `Observed ${args.observedUsageCount} successful requests for this endpoint candidate in logs.`,
    detailJson: {
      method: args.method,
      pathTemplate: args.pathTemplate,
      observedUsageCount: args.observedUsageCount,
    },
    source: 'runtime_log_enrichment',
    createdByStage: 'runtimeEvidence.runDiscoveryRuntimeEvidence',
    links,
  };
}

/**
 * Source E (runtime-log extraction-diagnostic variant): a LOW-severity,
 * `runtime_log`-category finding emitted by the runtime-evidence sub-stage when
 * the streaming pre-scan found candidate request lines but the extraction
 * pipeline recovered ~no observations from them (Spec
 * 2026-06-20-runtime-log-evidence-format-agnostic-extraction, Task Group 8).
 *
 * Why it exists -- visibility without failure:
 *   The runtime stage NEVER fails the discovery run (its top-level safety net
 *   guarantees that). But "pre-scan saw request-like lines, yet extraction
 *   yielded nothing" is a quietly-degraded outcome a reviewer should see. This
 *   finding surfaces it. It introduces NO new gap type (the structured
 *   `extractionOutcome` diagnostic is also recorded in
 *   `steps_payload.v3.runtimeEvidence`); it is purely an advisory marker.
 *
 * Shape (mirrors `buildRuntimeUsageObservationFinding`):
 *   - `findingType: 'runtime_log_extraction_incomplete'`, `category: 'runtime_log'`
 *     (the AMS consumer counts categories in {runtime_usage, runtime_log, log}).
 *   - severity `'low'` (advisory -- something was likely there but unread).
 *   - `detail_json` carries the pre-scan hit count, the recovered observation
 *     count, the sampled-block count, and a short reason string.
 *   - NO candidate link -- this is a run-level signal about a log file, not a
 *     statement about any one endpoint candidate.
 */
export function buildRuntimeLogExtractionDiagnosticFinding(args: {
  /** Number of request-like lines the pre-scan detected across the file(s). */
  preScanHits: number;
  /** Number of observations the extraction pipeline actually recovered (~0). */
  observations: number;
  /** Number of sample blocks assembled by the pre-scan sampler. */
  sampledBlocks: number;
  /** Short machine-ish reason string (per-file extraction reasons, joined). */
  reason: string;
}): FindingEmitInput {
  return {
    findingType: 'runtime_log_extraction_incomplete',
    category: 'runtime_log',
    severity: 'low',
    title: `Runtime log extraction incomplete: ${args.preScanHits} candidate line(s), ${args.observations} extracted`,
    summary:
      `The pre-scan detected ${args.preScanHits} request-like line(s) but extraction ` +
      `recovered ${args.observations} observation(s). The run completed; review whether the ` +
      `log format needs a recipe or is unsupported.`,
    detailJson: {
      preScanHits: args.preScanHits,
      observations: args.observations,
      sampledBlocks: args.sampledBlocks,
      reason: args.reason,
    },
    source: 'runtime_log_enrichment',
    createdByStage: 'runtimeEvidence.runDiscoveryRuntimeEvidence',
    links: [],
  };
}

/**
 * Source F: ambiguous relationship inference.
 *
 * Triggered by the competing-relationships path in triage. Severity laddered
 * by confidence: < AMBIGUOUS_THRESHOLD -> 'low', otherwise 'medium'.
 */
export function buildAmbiguousRelationshipFinding(args: {
  relationshipDescription: string;
  confidence: number;
  competingTargetCandidateIds: string[];
  sourceEvidenceId?: string;
  ruleId?: string;
}): FindingEmitInput {
  const severity = args.confidence < AMBIGUOUS_THRESHOLD ? 'low' : 'medium';
  const links: DiscoveryFindingLinkPayload[] = [
    ...args.competingTargetCandidateIds.map((id) => ({
      linkType: 'related_to',
      targetType: 'discovery_candidate' as const,
      targetId: id,
    })),
    ...(args.sourceEvidenceId
      ? [
          {
            linkType: 'derived_from',
            targetType: 'discovery_evidence' as const,
            targetId: args.sourceEvidenceId,
          },
        ]
      : []),
  ];
  return {
    findingType: 'ambiguous_relationship',
    category: 'ambiguity',
    severity,
    title: `Ambiguous relationship: ${args.relationshipDescription}`,
    summary:
      `Multiple competing relationship targets identified (confidence ${args.confidence.toFixed(2)}). ` +
      `Review to disambiguate.`,
    confidence: args.confidence,
    source: 'pipeline_triage',
    createdByStage: args.ruleId
      ? `triageEngine.competingRelationships.${args.ruleId}`
      : 'triageEngine.competingRelationships',
    links,
  };
}

/**
 * Centralised `gapType` vocabulary for `evidence_gap` findings.
 *
 * This union is the single source of truth for `detail_json.gapType`
 * values across the discovery service AND for sibling services (e.g.
 * api-migration-validation-service / AMVS) that emit `evidence_gap`
 * findings against the same discovery run. discovery-service is the
 * type-shape source-of-truth for findings even when the emission site
 * lives in another service -- AMVS imports `EvidenceGapType` from here
 * rather than duplicating the vocabulary.
 *
 * Adding a new sentinel here AND registering the emission site is what
 * makes a new gap "first class" in the Findings tab.
 *
 * Spec lineage:
 *  - Original four: `endpoint_missing_response_schema`,
 *    `interface_missing_contract_detail`, `service_missing_owner`,
 *    `data_entity_missing_attributes` -- introduced with the evidence-gap
 *    scanner (2026-05-16 Discovery Findings, Task Group 5).
 *  - SOAP sentinels: `soap_endpoint_url_unknown`, `wsdl_parse_failed` --
 *    introduced 2026-05-17 SOAP Discovery Spring Classic Phase 1
 *    Task Group 7 (Q-9). Emitted by the SOAP scanner subtree
 *    (`packFindingScanners/springClassicSoap/`).
 *  - LLM-extract sentinel: `llm_endpoint_extract_malformed` -- introduced
 *    2026-05-17 SOAP LLM Extraction and Payload Enrichment Phase 2
 *    Task Group 4 (W-9). Emitted by AMVS's
 *    `propose_endpoints_from_code` tool when the LLM returns malformed
 *    output twice in a row (one initial attempt + one schema-violation
 *    retry). discovery-service itself never emits this sentinel; the
 *    union member exists here purely as the single-source-of-truth so
 *    AMVS can import it.
 *  - OAS spec-link sentinels: `oas_spec_ambiguous_match`, `oas_spec_orphan`
 *    -- introduced 2026-05-17 Spec File Auto-Linking Phase 3 Task Group 1
 *    (P-14). Emitted by the new `specFileLinker` scanner subtree
 *    (`packFindingScanners/specFileLinker/`) AND by Phase 1's
 *    `soapEndpointEmitter.ts` when promoting WSDL paths to SOAP
 *    `interface.spec_link` (Workstream B). Ambiguous = multiple
 *    interfaces match a single spec file (or a single interface matches
 *    multiple spec files); orphan = a qualifying spec file exists but
 *    no in-scope interface candidate matches it.
 *  - WADL sentinels: `wadl_parse_failed`, `wadl_unsupported_namespace`,
 *    `wadl_missing_grammar`, `wadl_missing_schema_element` -- introduced
 *    2026-05-21 WADL Deterministic Parser Task Group 4. Emitted by the
 *    new REST WADL scanner subtree
 *    (`packFindingScanners/restWadl/`). `wadl_parse_failed` covers
 *    `fast-xml-parser` throws; `wadl_unsupported_namespace` covers the
 *    root `<application xmlns>` gate failing;
 *    `wadl_missing_grammar` covers a `<grammars><include href>`
 *    entry that did not resolve in the caller-supplied
 *    `relatedFiles` map (or was found but failed to parse -- treated
 *    as the same bucket per spec Q2); `wadl_missing_schema_element`
 *    covers a `<representation element="X"/>` ref that did not
 *    resolve in any loaded grammar's top-level `<xs:element name>`.
 *  - SOAP message-field depth sentinels: `soap_message_depth_cap`,
 *    `soap_message_type_cycle`, `soap_message_multipart_unexpanded` --
 *    introduced 2026-05-30 SOAP/WSDL Message-Field Depth (Spec 4)
 *    Task Group 2. Emitted by the deepened `wsdlParser.ts` XSD field
 *    walker. `soap_message_depth_cap` covers the env-tunable
 *    nested-complex-type walk hitting its depth limit (the walk STOPS at
 *    that type rather than truncating silently); `soap_message_type_cycle`
 *    covers a self-referential type chain (e.g. `Employee -> manager :
 *    Employee`) the walker STOPS on rather than looping;
 *    `soap_message_multipart_unexpanded` covers a multi-part / RPC-style
 *    message whose fields v1 does not fully expand (doc-literal-wrapped
 *    single-part is the supported style). These three record ONLY the
 *    genuinely-unmodellable STOP condition; the field structure itself
 *    lands on the attribute/entity (architecture), never as a Finding.
 *  - Dimension-B specification-coverage sentinels:
 *    `endpoint_missing_data_effect`, `soap_operation_missing_message_binding`
 *    -- introduced 2026-05-30 Capture Coverage Gates (Spec 5) Task Group 2.
 *    Emitted by the dimension-B per-endpoint completeness pass in
 *    `discoveryV3Pipeline.ts` (NOT a scanner subtree). They mirror, on the
 *    discovery side, the SAME per-protocol "fully specified" bar AMS Group 1
 *    computes in `computeSpecificationCoverage`:
 *      - `endpoint_missing_data_effect` -- a REST `endpoints` candidate has
 *        NO resolved `endpoint_data_effects` edge (Spec 1). REST is "fully
 *        specified" iff such an edge exists; its absence is the gap.
 *      - `soap_operation_missing_message_binding` -- a SOAP `endpoints`
 *        candidate's parent interface has NO bound request/response message
 *        entities (Spec 4 `interface_logical_entities` + message
 *        `logical_data_entities`). SOAP is "fully specified" iff its parent
 *        interface carries such a binding; its absence is the gap.
 *    `business_logics.behavior` (Spec 2) is a BONUS signal only and is NEVER
 *    consulted here -- exactly as on the AMS side. One Finding is emitted per
 *    under-specified endpoint; the per-endpoint "fully specified?" rollup
 *    surfaces via the existing run aggregate (`getRunAggregate`).
 *  - Deferred-inbound-surface sentinel: `deferred_inbound_surface` -- introduced
 *    2026-05-30 Inbound Surface Completeness (Spec #4) Task Group 7. Emitted by
 *    the deterministic `deferredSurfaceScanner` (Spring / Spring Classic only)
 *    when an inbound entry-point surface that v1 deliberately does NOT model --
 *    GraphQL (`@QueryMapping` / `@SchemaMapping` / a `.graphqls` schema), gRPC
 *    (`BindableService` / `@GrpcService` / a `.proto`), WebSocket-STOMP
 *    (`@MessageMapping` / `@SubscribeMapping`), or Spring Batch
 *    (`@EnableBatchProcessing` / a `Job` / `Step` bean) -- is OBSERVED. The
 *    surface's PRESENCE is recorded as a Finding (never modelled as an
 *    `endpoints` candidate, never a silent drop), so a reviewer knows the
 *    deferred surface exists. Non-Java stacks + Actuator endpoints are fully
 *    OUT (no Finding). `category: 'migration_risk'`, severity advisory
 *    (`'medium'`); `detail_json` carries the `surface` kind, the matched
 *    `signal`, and the `filePath`.
 *  - Scanner-failure sentinel: `scanner_failed` -- introduced 2026-05-30
 *    (W4 quick-win audit fix, NOT a spec). Emitted at every framework-adapter
 *    / pack-scanner / contract-pass / runtime-evidence SOFT-FAIL catch site
 *    that previously only `console.error`'d. Before W4 a thrown adapter /
 *    scanner / pass was swallowed and that framework's endpoints silently
 *    vanished from a run that still reported COMPLETED, with NO Finding. The
 *    sentinel makes the failure VISIBLE (severity `'high'` -- a missing
 *    framework is serious) WITHOUT changing run status (deferred to a later
 *    spec). The failing scanner / adapter / pass is named in the title and the
 *    error message is carried in `detail_json.error`.
 */
export type EvidenceGapType =
  | 'endpoint_missing_response_schema'
  | 'interface_missing_contract_detail'
  | 'service_missing_owner'
  | 'data_entity_missing_attributes'
  | 'soap_endpoint_url_unknown'
  | 'wsdl_parse_failed'
  | 'soap_message_depth_cap'
  | 'soap_message_type_cycle'
  | 'soap_message_multipart_unexpanded'
  | 'endpoint_missing_data_effect'
  | 'soap_operation_missing_message_binding'
  | 'llm_endpoint_extract_malformed'
  | 'oas_spec_ambiguous_match'
  | 'oas_spec_orphan'
  | 'wadl_parse_failed'
  | 'wadl_unsupported_namespace'
  | 'wadl_missing_grammar'
  | 'wadl_missing_schema_element'
  | 'scanner_failed'
  | 'non_deterministic_endpoint'
  | 'possible_entity_collision'
  | 'deferred_inbound_surface'
  // 2026-06-22 Spring Classic code-evidence format extraction (Task Group 3):
  // a field whose wire format is hidden in a custom @JsonSerialize/
  // @JsonDeserialize(using=Class) -- detect-or-flag (never guessed). snake_case
  // to match its siblings (the closed union is the single source of truth amvs
  // imports; NO kebab 'request-format-unresolved' literal exists anywhere).
  | 'request_format_unresolved';

/**
 * Source I (response-contract / unresolved-auth variant): emitted by the
 * deterministic response-contract scanner
 * (`frameworkAdapters/springClassic/responseContractScanner.ts`) when an
 * endpoint's authorization cannot be statically resolved.
 *
 * Spec: 2026-05-30 Per-endpoint response-contract capture (Spec 1), Task Group 2.
 *
 * The scanner NEVER guesses a security role. When a method-level
 * `@PreAuthorize` SpEL expression goes beyond a simple `hasRole(...)`, when a
 * filter-chain rule is a dynamic matcher / bean reference, or when a security
 * config exists but cannot be parsed to a URL->role rule for this endpoint, the
 * contract's `auth.source` is set to `unresolved` (roles left empty) AND this
 * Finding is emitted so a reviewer can capture the authorization contract
 * manually.
 *
 * Severity 'medium' (the endpoint is still captured; the gap is that its
 * 401/403 behaviour cannot be proven statically). NO `discovery_candidate`
 * link is produced from here -- the scanner runs over the IR set and the
 * finding stands on its endpoint identity (the endpoint candidate carries the
 * contract with `auth.source = unresolved`).
 *
 * `category: 'security'` so the Findings tab can filter authorization gaps;
 * `createdByStage: 'findings.responseContractScanner'` so the origin is
 * distinct from the data-effect / evidence-gap scanners.
 */
export function buildUnresolvedAuthFinding(args: {
  endpointName: string;
  controllerClass: string;
  methodName: string;
  /** Why the rule could not be statically resolved (never a guessed role). */
  detail: string;
  sourceFilePath: string;
}): FindingEmitInput {
  return {
    findingType: 'endpoint_auth_unresolved',
    category: 'security',
    severity: 'medium',
    title: `Unresolved endpoint authorization: ${args.endpointName}`,
    summary:
      `Endpoint '${args.endpointName}' (${args.controllerClass}#${args.methodName}) has an ` +
      `authorization rule that could not be statically resolved, so its required roles and ` +
      `expected 401/403 behaviour are unknown (auth.source = unresolved; no role was guessed). ` +
      args.detail,
    detailJson: {
      endpoint: args.endpointName,
      controllerClass: args.controllerClass,
      methodName: args.methodName,
      authSource: 'unresolved',
      detail: args.detail,
      migrationConcern:
        'The target service must reproduce this endpoint\'s 401/403 behaviour byte-for-byte, ' +
        'but the source authorization rule (SpEL beyond a simple role check, a dynamic matcher, ' +
        'or an unparseable filter chain) could not be statically resolved. Review and capture the ' +
        'required roles manually.',
      filePath: args.sourceFilePath,
    },
    source: 'pipeline_evidence_gap',
    createdByStage: 'findings.responseContractScanner',
    links: [],
  };
}

/**
 * Source I (response-contract / config-dependent variant): emitted by the
 * deterministic response-contract scanner when an endpoint's response is not a
 * pure function of its input -- it diverges by `@ConditionalOnProperty` /
 * `@Profile` / `@Value` config.
 *
 * Spec: 2026-05-30 Per-endpoint response-contract capture (Spec 1), Task Group 2.
 *
 * The divergence is captured deterministically as `conditional_variants[]` on
 * the endpoint's `response_contract`; this Finding flags to a reviewer that the
 * endpoint's byte-for-byte response depends on deployment configuration, so a
 * single replay cannot characterise it fully.
 *
 * Severity 'medium'; `category: 'migration_risk'`;
 * `createdByStage: 'findings.responseContractScanner'`.
 */
export function buildConfigDependentEndpointFinding(args: {
  endpointName: string;
  controllerClass: string;
  methodName: string;
  /** The `@ConditionalOnProperty` / `@Profile` / `@Value` conditions found. */
  conditions: string[];
  sourceFilePath: string;
}): FindingEmitInput {
  return {
    findingType: 'endpoint_response_config_dependent',
    category: 'migration_risk',
    severity: 'medium',
    title: `Config-dependent response: ${args.endpointName}`,
    summary:
      `Endpoint '${args.endpointName}' (${args.controllerClass}#${args.methodName}) returns a ` +
      `response that is NOT a pure function of its input: it diverges by configuration ` +
      `(${args.conditions.join(', ')}). The byte-for-byte response varies by deployment config.`,
    detailJson: {
      endpoint: args.endpointName,
      controllerClass: args.controllerClass,
      methodName: args.methodName,
      conditions: args.conditions,
      migrationConcern:
        'This endpoint\'s response shape/content is config-conditional, so a single capture/replay ' +
        'does not fully characterise it. Each conditional variant is recorded in the endpoint\'s ' +
        'response_contract.conditional_variants; the target must reproduce the same branch behaviour.',
      filePath: args.sourceFilePath,
    },
    source: 'pipeline_evidence_gap',
    createdByStage: 'findings.responseContractScanner',
    links: [],
  };
}

/**
 * Source H: evidence gap.
 *
 * Detected by `evidenceGapScanner` post-merge. Severity 'medium' (the gap is
 * notable but not critical -- the candidate is still proposed; the gap just
 * limits its usefulness to downstream consumers).
 */
export function buildEvidenceGapFinding(args: {
  candidateId: string;
  candidateName: string;
  gapType: EvidenceGapType;
  gapDescription: string;
}): FindingEmitInput {
  return {
    findingType: 'evidence_gap',
    category: 'evidence_gap',
    severity: 'medium',
    title: `Evidence gap: ${args.candidateName} -- ${args.gapType}`,
    summary: args.gapDescription,
    detailJson: { gapType: args.gapType },
    source: 'pipeline_evidence_gap',
    createdByStage: 'findings.evidenceGapScanner',
    links: [
      {
        linkType: 'supports',
        targetType: 'discovery_candidate',
        targetId: args.candidateId,
      },
    ],
  };
}

/**
 * Source H (request-format-unresolved variant): evidence gap emitted by the
 * Spring-Classic Signal-#1 walk when a request-body DTO field hides its wire
 * format inside a CUSTOM (de)serializer -- `@JsonSerialize` /
 * `@JsonDeserialize(using=SomeSerializer.class)`. The concrete format lives in
 * the referenced serializer class, which the deterministic scanner does NOT
 * crack open, so it FLAGS the field rather than guessing a format.
 *
 * Spec: 2026-06-22 Spring Classic code-evidence format extraction (Task Group 3).
 *
 * Shape (reuses the established `evidence_gap` Finding idiom -- NOT a new shape):
 *   - `findingType: 'evidence_gap'`, `category: 'evidence_gap'`.
 *   - severity `'info'` -- informational; the field is captured, the gap is only
 *     that its format cannot be statically proven (no defect).
 *   - `detailJson.gapType: 'request_format_unresolved'`, plus the `field`, the
 *     `endpoint`, and the referenced `serializerClass`.
 *   - NO candidate link (run-level on its endpoint identity, mirroring the other
 *     scanner-emitted evidence-gap variants); NO format is ever guessed.
 *
 * `createdByStage='findings.requestContractScanner'` so the Findings tab can
 * filter request-format gaps by origin.
 */
export function buildRequestFormatUnresolvedFinding(args: {
  /** The DTO field whose format is hidden in a custom (de)serializer. */
  field: string;
  /** Endpoint identity (`${httpMethod} ${fullPath}`) the field belongs to. */
  endpoint: string;
  /** The referenced serializer/deserializer class (never cracked open). */
  serializerClass: string;
}): FindingEmitInput {
  return {
    findingType: 'evidence_gap',
    category: 'evidence_gap',
    severity: 'info',
    title: `Request format unresolved: ${args.endpoint} -- ${args.field}`,
    summary:
      `Field "${args.field}" on endpoint "${args.endpoint}" uses a custom (de)serializer (${args.serializerClass}); its wire format is defined in that class and was NOT statically resolved (no format guessed). Review the serializer to capture the exact request format.`,
    detailJson: {
      gapType: 'request_format_unresolved' satisfies EvidenceGapType,
      field: args.field,
      endpoint: args.endpoint,
      serializerClass: args.serializerClass,
    },
    source: 'pipeline_evidence_gap',
    createdByStage: 'findings.requestContractScanner',
    links: [],
  };
}

/**
 * Source H (scanner-failure variant): evidence gap emitted at a pipeline
 * SOFT-FAIL catch site when a framework adapter / pack-finding scanner /
 * contract pass / runtime-evidence sub-stage throws.
 *
 * W4 quick-win audit fix (2026-05-30), NOT a spec.
 *
 * Why this exists -- the silent-incompleteness hole:
 *   Before W4, every one of those catch sites only `console.error`'d the
 *   thrown error and let the run continue. The practical effect was that the
 *   failed framework's endpoints / entities silently VANISHED from a run that
 *   still reported COMPLETED, with NO Finding -- a reviewer had no signal that
 *   a whole framework had dropped out. (The `unsupported_pattern` enum exists
 *   for a related idea but is deliberately unwired in v1.)
 *
 * What W4 changes:
 *   At each soft-fail catch site we KEEP the existing log AND, in addition,
 *   emit one of these Findings via the SAME `FindingEmitInput` -> caller-emit
 *   path every other source uses (no parallel emitter, no FindingEmitter
 *   fork). The soft-fail is preserved -- other scanners still run; the run
 *   status is NOT changed (that is a later spec). The only behavioural change
 *   is that the failure is now VISIBLE as a Finding.
 *
 * Shape:
 *   - `findingType: 'evidence_gap'`, `category: 'evidence_gap'` (reuses the
 *     existing Findings-tab evidence-gap surface + dedupe semantics).
 *   - severity `'high'` -- a missing framework / scanner is serious (a whole
 *     swathe of the architecture may be absent), distinct from the 'medium'
 *     gap-on-an-otherwise-present-candidate builders.
 *   - title names exactly WHICH scanner / adapter / pass failed.
 *   - `detail_json` carries `gapType: 'scanner_failed'`, the `scanner`
 *     identifier, the `phase`, and the `error` message string.
 *   - NO candidate link -- by construction the candidate(s) the scanner would
 *     have produced do not exist; this is a RUN-LEVEL finding.
 *
 * `createdByStage='findings.scannerFailure'` -- a dedicated stage label so the
 * Findings tab can filter scanner-failure gaps by origin (distinct from
 * `findings.evidenceGapScanner` / `findings.soapScanner` / etc.).
 */
export function buildScannerFailedFinding(args: {
  /**
   * Identifier of the failing unit -- the adapter / scanner / pass / sub-stage
   * name (e.g. `'FrameworkPack:spring-classic'`, `'javaFindingScanner'`,
   * `'runContractCandidatePasses'`, `'runtimeEvidence'`). Named in the title.
   */
  scanner: string;
  /**
   * Coarse phase label for the detail blob (e.g. `'stage2_framework_adapter'`,
   * `'pack_finding_scanner'`, `'stage2_contract_passes'`,
   * `'stage2_5_runtime_evidence'`).
   */
  phase: string;
  /** The thrown error's message string (already extracted by the caller). */
  error: string;
}): FindingEmitInput {
  return {
    findingType: 'evidence_gap',
    category: 'evidence_gap',
    severity: 'high',
    title: `Scanner failed: ${args.scanner} -- framework scan incomplete`,
    summary:
      `The discovery scanner/adapter '${args.scanner}' (phase '${args.phase}') threw and was ` +
      `soft-failed, so any architecture it would have produced is MISSING from this run. ` +
      `Error: ${args.error}`,
    detailJson: {
      gapType: 'scanner_failed' satisfies EvidenceGapType,
      scanner: args.scanner,
      phase: args.phase,
      error: args.error,
    },
    source: 'pipeline_evidence_gap',
    createdByStage: 'findings.scannerFailure',
    links: [],
  };
}

/**
 * Source H (non-deterministic-endpoint variant): evidence gap emitted by the
 * deterministic `nonDeterministicEndpointScanner` (Spring / Spring Classic only)
 * when an endpoint handler reaches a source of LEGITIMATE runtime VARIANCE --
 * a `@Scheduled` / `@Cacheable` / `@Async` / `@Profile`-gated bean, session-
 * scoped state, or a clock / random source -- so the endpoint is NOT a pure
 * function of its inputs.
 *
 * Spec: 2026-05-30 Oracle Integrity & Determinism (Spec #3), Task Group 4.
 *
 * Why it exists -- the harness false-diff hole:
 *   The runtime API harness (`api-migration-validation-service`) replays a
 *   captured request and compares the source vs target response byte-for-byte.
 *   An endpoint whose response legitimately VARIES by clock / random / cache /
 *   schedule / session / profile would produce a behavioural diff that is NOT a
 *   migration defect. This Finding tells the harness the variance is EXPECTED so
 *   it does not treat it as a behavioural diff.
 *
 * Shape:
 *   - `findingType: 'evidence_gap'`, `category: 'migration_risk'` (the endpoint
 *     is captured fine; the "gap" is that it cannot be characterised by a single
 *     deterministic replay).
 *   - severity `'medium'` (advisory -- the endpoint is still captured).
 *   - `detail_json.gapType: 'non_deterministic_endpoint'`, the controller +
 *     method, and the detected `sourcesOfVariance[]` (the annotations / patterns
 *     that tripped it).
 *   - links to the endpoint's discovery candidate via `supports` when a
 *     candidate id is supplied (run-level when it is not).
 *
 * `createdByStage='findings.nonDeterministicEndpointScanner'` so the Findings
 * tab can filter non-determinism gaps by origin.
 */
export function buildNonDeterministicEndpointFinding(args: {
  /** Endpoint display name (controller#method or HTTP+path) for the title. */
  endpointName: string;
  /** Owning controller class. */
  controllerClass: string;
  /** Handler method name. */
  methodName: string;
  /**
   * The detected sources of legitimate variance (e.g. `@Scheduled`,
   * `@Cacheable`, `session_scoped_state`, `clock`, `random`). At least one.
   */
  sourcesOfVariance: string[];
  /** Source file path the handler lives in (for the detail blob). */
  sourceFilePath: string;
  /** Optional endpoint discovery-candidate id to link via `supports`. */
  candidateId?: string;
}): FindingEmitInput {
  const links: DiscoveryFindingLinkPayload[] = args.candidateId
    ? [
        {
          linkType: 'supports',
          targetType: 'discovery_candidate',
          targetId: args.candidateId,
        },
      ]
    : [];
  return {
    findingType: 'evidence_gap',
    category: 'migration_risk',
    severity: 'medium',
    title: `Non-deterministic endpoint: ${args.endpointName}`,
    summary:
      `Endpoint '${args.endpointName}' (${args.controllerClass}#${args.methodName}) is NOT a pure ` +
      `function of its inputs: its handler reaches ${args.sourcesOfVariance.join(', ')}. ` +
      `Its response may legitimately vary across replays.`,
    detailJson: {
      gapType: 'non_deterministic_endpoint' satisfies EvidenceGapType,
      endpoint: args.endpointName,
      controllerClass: args.controllerClass,
      methodName: args.methodName,
      sourcesOfVariance: args.sourcesOfVariance,
      migrationConcern:
        'This endpoint has legitimate runtime variance (clock / random / cache / schedule / ' +
        'session / profile), so the runtime harness must NOT treat a differing replay response ' +
        'as a behavioural diff. Characterise it with tolerance rather than a byte-for-byte match.',
      filePath: args.sourceFilePath,
    },
    source: 'pipeline_evidence_gap',
    createdByStage: 'findings.nonDeterministicEndpointScanner',
    links,
  };
}

/**
 * Source H (possible-entity-collision variant): evidence gap emitted by the MCP
 * save-back false-merge guard when a NORMALIZED (non-exact) name match drives a
 * binding -- so a fuzzy match (e.g. `Order` vs `Orders`) is surfaced for review
 * rather than silently first-match-bound.
 *
 * Spec: 2026-05-30 Oracle Integrity & Determinism (Spec #3), Task Group 5.
 *
 * REGISTERED HERE (in the single-source-of-truth `emissionSources.ts` registry,
 * next to `non_deterministic_endpoint` and W4's `scanner_failed`) so the
 * vocabulary edit lives in ONE place. discovery-service itself does NOT emit
 * this sentinel -- the emission site is the MCP save-back guard (Task Group 5),
 * which imports this builder. The union member + builder exist here as the
 * shape contract, exactly like `llm_endpoint_extract_malformed` (AMVS-emitted).
 *
 * Shape:
 *   - `findingType: 'evidence_gap'`, `category: 'ambiguity'` (it is an identity
 *     ambiguity -- two distinct entities may have been conflated).
 *   - severity `'medium'`.
 *   - `detail_json.gapType: 'possible_entity_collision'`, the two colliding
 *     names, the binding kind, and the match score.
 *   - links the candidate entities when ids are supplied.
 */
export function buildPossibleEntityCollisionFinding(args: {
  /** The name the binding tried to resolve (e.g. the LLM-proposed target). */
  sourceName: string;
  /** The existing entity name the normalized matcher bound it to. */
  matchedName: string;
  /** The binding kind (relationship / enrich / link / request-response). */
  bindingKind: string;
  /** The normalized-match score (e.g. 0.7) -- below an EXACT (1.0) match. */
  matchScore: number;
  /** Optional candidate id(s) to link via `related_to`. */
  relatedCandidateIds?: string[];
}): FindingEmitInput {
  const links: DiscoveryFindingLinkPayload[] = (args.relatedCandidateIds ?? []).map((id) => ({
    linkType: 'related_to',
    targetType: 'discovery_candidate' as const,
    targetId: id,
  }));
  return {
    findingType: 'evidence_gap',
    category: 'ambiguity',
    severity: 'medium',
    title: `Possible entity collision: '${args.sourceName}' ~ '${args.matchedName}'`,
    summary:
      `A normalized (non-exact, score ${args.matchScore.toFixed(2)}) name match bound '${args.sourceName}' ` +
      `to existing entity '${args.matchedName}' during ${args.bindingKind} resolution. These may be ` +
      `DISTINCT entities (e.g. 'Order' vs 'Orders') -- review before accepting the binding.`,
    detailJson: {
      gapType: 'possible_entity_collision' satisfies EvidenceGapType,
      sourceName: args.sourceName,
      matchedName: args.matchedName,
      bindingKind: args.bindingKind,
      matchScore: args.matchScore,
      migrationConcern:
        'Only EXACT name matches bind silently. This normalized match folded case / separators / ' +
        'plural and may have conflated two distinct entities; accepting it could mis-merge the model.',
    },
    source: 'pipeline_evidence_gap',
    createdByStage: 'findings.falseMergeGuard',
    links,
  };
}

/**
 * Source H (deferred-inbound-surface variant): evidence gap emitted by the
 * deterministic `deferredSurfaceScanner` (Spring / Spring Classic only) when an
 * inbound ENTRY-POINT surface that v1 deliberately does NOT model is OBSERVED:
 *  - **GraphQL** -- `@QueryMapping` / `@MutationMapping` / `@SchemaMapping` /
 *    `@SubscriptionMapping`, or a `.graphqls` / `.graphql` schema file.
 *  - **gRPC** -- a `BindableService` superclass / `@GrpcService`, or a `.proto`.
 *  - **WebSocket-STOMP** -- `@MessageMapping` / `@SubscribeMapping`.
 *  - **Spring Batch** -- `@EnableBatchProcessing`, or a `Job` / `Step` bean.
 *
 * Spec: 2026-05-30 Inbound Surface Completeness (Spec #4), Task Group 7.
 *
 * Why it exists -- the silent-drop hole (Finding-and-defer):
 *   These surfaces are rare in the Spring-Classic -> Boot migration target and
 *   are OUT of full modelling for v1 (they are NOT emitted as `endpoints` /
 *   `interfaces` candidates). But an unobserved entry point is an entry point
 *   the migration harness silently never tests. This Finding records the
 *   surface's PRESENCE so a reviewer knows it exists and was intentionally not
 *   modelled -- never a silent drop, never a fabricated endpoint.
 *
 * Shape (mirrors `buildNonDeterministicEndpointFinding`):
 *   - `findingType: 'evidence_gap'`, `category: 'migration_risk'` (the surface
 *     is present; the "gap" is that v1 does not model it as an endpoint).
 *   - severity `'medium'` (advisory).
 *   - `detail_json.gapType: 'deferred_inbound_surface'`, the `surface` kind, the
 *     matched `signal` (the annotation / file / type that tripped detection),
 *     and the `filePath`.
 *   - NO candidate link -- by construction no candidate is produced for the
 *     surface (run-level / file-level finding).
 *
 * `createdByStage='findings.deferredSurfaceScanner'` so the Findings tab can
 * filter deferred-surface gaps by origin. Non-Java stacks + Actuator endpoints
 * are fully OUT -- the scanner emits nothing for them.
 */
export function buildDeferredSurfacePresentFinding(args: {
  /** Which deferred entry-point surface was observed. */
  surface: 'graphql' | 'grpc' | 'websocket_stomp' | 'spring_batch';
  /**
   * The concrete signal that tripped detection (e.g. `@QueryMapping`,
   * `BindableService`, `@MessageMapping`, `@EnableBatchProcessing`, or a
   * `.proto` / `.graphqls` file). Named in the summary + detail blob.
   */
  signal: string;
  /** Source file path the surface was observed in (for the detail blob). */
  sourceFilePath: string;
}): FindingEmitInput {
  const surfaceLabel =
    args.surface === 'graphql'
      ? 'GraphQL'
      : args.surface === 'grpc'
        ? 'gRPC'
        : args.surface === 'websocket_stomp'
          ? 'WebSocket-STOMP'
          : 'Spring Batch';
  return {
    findingType: 'evidence_gap',
    category: 'migration_risk',
    severity: 'medium',
    title: `Deferred inbound surface present: ${surfaceLabel}`,
    summary:
      `A ${surfaceLabel} inbound entry-point surface was observed (signal: ${args.signal}) ` +
      `but is NOT modelled as an endpoint in v1. Its presence is recorded so the surface is ` +
      `never a silent drop; review whether the migration harness must exercise it.`,
    detailJson: {
      gapType: 'deferred_inbound_surface' satisfies EvidenceGapType,
      surface: args.surface,
      signal: args.signal,
      migrationConcern:
        'This inbound surface is a real entry point but v1 deliberately does not model it as an ' +
        'endpoint candidate, so the runtime equivalence harness will not exercise it automatically. ' +
        'Capture it manually if the migration must preserve its behaviour.',
      filePath: args.sourceFilePath,
    },
    source: 'pipeline_evidence_gap',
    createdByStage: 'findings.deferredSurfaceScanner',
    links: [],
  };
}

/**
 * Source H (SOAP variant): evidence gap emitted by the SOAP scanner subtree.
 *
 * Spec: 2026-05-17 SOAP Discovery Spring Classic Phase 1, Task Group 7 (Q-9).
 *
 * Two sentinel `gapType` values flow through this builder:
 *  - `soap_endpoint_url_unknown` -- emitted when the SOAP servlet mapping
 *    (e.g. `MessageDispatcherServlet`) cannot be inferred from `web.xml` /
 *    `WebApplicationInitializer`. The candidate is STILL emitted with
 *    `path_or_address=null`; the finding flags the gap. `candidateId` is
 *    required here (links to the parent SOAP interface candidate's id).
 *  - `wsdl_parse_failed` -- emitted when the WSDL parser soft-fails on
 *    malformed XML or unresolvable schema references. No candidate is
 *    produced (the parser returns `operations: []`); `candidateId` is
 *    therefore optional. The finding carries `reason` + `sourcePath` from
 *    `WsdlParseResult.parseError` in `detail_json`.
 *
 * Severity 'medium' (same as the post-merge evidence-gap scanner -- the gap
 * is notable but not critical; the scanner continues).
 *
 * `createdByStage='findings.soapScanner'` (distinct from
 * `findings.evidenceGapScanner` so the Findings tab can filter by origin).
 */
export function buildSoapEvidenceGapFinding(args: {
  gapType:
    | 'soap_endpoint_url_unknown'
    | 'wsdl_parse_failed'
    | 'soap_message_depth_cap'
    | 'soap_message_type_cycle'
    | 'soap_message_multipart_unexpanded';
  /** Parent SOAP interface candidate id; required for `soap_endpoint_url_unknown`. */
  candidateId?: string;
  /** Display name for the title; falls back to the source path / gapType. */
  candidateName?: string;
  /** Human-readable summary (one line). */
  gapDescription: string;
  /** WSDL parser's `reason` string (for `wsdl_parse_failed`). */
  reason?: string;
  /** Source path on disk -- WSDL path for `wsdl_parse_failed`, interface short-id for `soap_endpoint_url_unknown`. */
  sourcePath?: string;
}): FindingEmitInput {
  const links: DiscoveryFindingLinkPayload[] = args.candidateId
    ? [
        {
          linkType: 'supports',
          targetType: 'discovery_candidate',
          targetId: args.candidateId,
        },
      ]
    : [];
  const titleSubject =
    args.candidateName ?? args.sourcePath ?? args.gapType;
  const detailJson: Record<string, unknown> = { gapType: args.gapType };
  if (args.reason != null) detailJson.reason = args.reason;
  if (args.sourcePath != null) detailJson.sourcePath = args.sourcePath;
  return {
    findingType: 'evidence_gap',
    category: 'evidence_gap',
    severity: 'medium',
    title: `Evidence gap: ${titleSubject} -- ${args.gapType}`,
    summary: args.gapDescription,
    detailJson,
    source: 'pipeline_evidence_gap',
    createdByStage: 'findings.soapScanner',
    links,
  };
}

/**
 * Source H (WADL variant): evidence gap emitted by the REST WADL scanner
 * subtree.
 *
 * Spec: 2026-05-21 WADL Deterministic Parser, Task Group 4.
 *
 * Four sentinel `gapType` values flow through this builder:
 *  - `wadl_parse_failed` -- emitted when `parseWadl` soft-fails on a
 *    `fast-xml-parser` throw (`parseError = 'malformed_xml'`). No
 *    candidate is produced; the parser returns empty operations.
 *  - `wadl_unsupported_namespace` -- emitted when the root
 *    `<application xmlns>` gate fails (anything other than
 *    `http://wadl.dev.java.net/2009/02`).
 *  - `wadl_missing_grammar` -- one finding per entry in
 *    `WadlParseResult.missingGrammars`. Covers BOTH "href absent from
 *    `relatedFiles` map" AND "href present but parser threw on it"
 *    per spec Q2 (single bucket).
 *  - `wadl_missing_schema_element` -- one finding per entry in
 *    `WadlParseResult.missingSchemaElements`. Carries the originating
 *    `compositeId` on the finding as `sourceOperationId`.
 *
 * Severity 'medium' (same as the other evidence-gap builders -- the gap is
 * notable but not critical; the parser keeps going).
 *
 * `createdByStage='findings.restWadlScanner'` (distinct from
 * `findings.soapScanner` / `findings.evidenceGapScanner` /
 * `amvs.llmEndpointExtract` / `discovery.specFileLinker` so the
 * Findings tab can filter by origin).
 *
 * No `candidateId` link is produced (WADL findings flow as
 * `interface_definition` / `endpoint` finding types via the existing
 * `FindingEmitter` channel rather than via discovery candidates).
 * Callers may supply `ref` (e.g. an href / element name) and
 * `sourceOperationId` so the title disambiguates same-source repeats.
 */
export function buildWadlEvidenceGapFinding(args: {
  gapType:
    | 'wadl_parse_failed'
    | 'wadl_unsupported_namespace'
    | 'wadl_missing_grammar'
    | 'wadl_missing_schema_element';
  /** Source WADL file path -- always present. */
  sourcePath: string;
  /**
   * For `wadl_missing_grammar`: the unresolved `<include href>` value.
   * For `wadl_missing_schema_element`: the unresolved `element=` ref.
   * For `wadl_parse_failed` / `wadl_unsupported_namespace`: unused
   * (left null in the detail blob).
   */
  ref?: string;
  /**
   * For `wadl_missing_schema_element`: the `compositeId` of the
   * operation whose representation referenced the missing element.
   */
  sourceOperationId?: string;
  /** Optional one-line reason string (e.g. parser failure reason). */
  reason?: string;
  /** Optional human-readable summary. Built from `gapType` + `ref` when absent. */
  gapDescription?: string;
}): FindingEmitInput {
  const titleSubject =
    args.ref != null && args.ref.length > 0
      ? `${args.gapType}: ${args.ref}`
      : `${args.gapType}`;
  const summary =
    args.gapDescription ??
    (args.ref != null && args.ref.length > 0
      ? `WADL ${args.gapType} for '${args.ref}' in '${args.sourcePath}'.`
      : `WADL ${args.gapType} in '${args.sourcePath}'.`);
  const detailJson: Record<string, unknown> = {
    gapType: args.gapType satisfies EvidenceGapType,
    sourceFilePath: args.sourcePath,
  };
  if (args.ref != null) detailJson.ref = args.ref;
  if (args.sourceOperationId != null) {
    detailJson.sourceOperationId = args.sourceOperationId;
  }
  if (args.reason != null) detailJson.reason = args.reason;
  return {
    findingType: 'evidence_gap',
    category: 'evidence_gap',
    severity: 'medium',
    title: `Evidence gap: ${titleSubject}`,
    summary,
    detailJson,
    source: 'pipeline_evidence_gap',
    createdByStage: 'findings.restWadlScanner',
    links: [],
  };
}

/**
 * Source H (AMVS LLM-extract variant): evidence gap emitted by AMVS's
 * `propose_endpoints_from_code` tool when the LLM returns malformed output
 * twice in a row (the initial attempt plus one schema-violation retry).
 *
 * Spec: 2026-05-17 SOAP LLM Extraction and Payload Enrichment Phase 2,
 * Task Group 4 (W-9).
 *
 * Why a dedicated builder rather than reusing `buildSoapEvidenceGapFinding`
 * or `buildEvidenceGapFinding`:
 *  - `buildEvidenceGapFinding` requires a `candidateId`; by construction the
 *    LLM-extract-malformed path emits ZERO candidates, so no candidate id
 *    exists to link.
 *  - `buildSoapEvidenceGapFinding` is hard-pinned to the two SOAP scanner
 *    sentinels and sets `createdByStage='findings.soapScanner'`. The
 *    malformed-LLM case did not run through the SOAP scanner; it ran
 *    through AMVS's LLM tool, so the `createdByStage` is distinct
 *    (`amvs.llmEndpointExtract`).
 *
 * The builder lives here (rather than in AMVS) for two reasons:
 *  1. discovery-service is the single source of truth for the
 *     `EvidenceGapType` vocabulary -- callers in either service should
 *     import the same union and use the same shape constructors.
 *  2. The shape is small enough that a dedicated builder per emission site
 *     is preferable to generalising `buildSoapEvidenceGapFinding` over an
 *     ever-growing set of unrelated `createdByStage` values.
 *
 * The finding links to the parent SOAP interface candidate's short-id
 * (the one whose Step 4 review the user triggered LLM extraction from),
 * so the Findings tab can group the malformed-output report alongside
 * the interface it was scoped to.
 *
 * Severity 'medium' (same as the other evidence-gap builders -- the gap is
 * notable but not critical; the user can still fall back to manual review).
 *
 * NOTE: discovery-service itself does NOT call this builder. It exists
 * here as a shape contract for AMVS to import.
 */
export function buildLlmEndpointExtractMalformedFinding(args: {
  /** Parent SOAP interface candidate short-id the user triggered extraction against. */
  interfaceShortId: string;
  /**
   * Human-readable reason describing the malformed-output failure
   * (e.g. "LLM returned invalid JSON twice; schema_violation").
   */
  reason: string;
}): FindingEmitInput {
  return {
    findingType: 'evidence_gap',
    category: 'evidence_gap',
    severity: 'medium',
    title: `Evidence gap: ${args.interfaceShortId} -- llm_endpoint_extract_malformed`,
    summary: args.reason,
    detailJson: {
      gapType: 'llm_endpoint_extract_malformed' satisfies EvidenceGapType,
      reason: args.reason,
      interfaceShortId: args.interfaceShortId,
    },
    source: 'pipeline_evidence_gap',
    createdByStage: 'amvs.llmEndpointExtract',
    links: [
      {
        linkType: 'supports',
        targetType: 'discovery_candidate',
        targetId: args.interfaceShortId,
      },
    ],
  };
}

/**
 * Source H (OAS spec-file ambiguous-match variant): evidence gap emitted
 * by the `specFileLinker` scanner subtree -- AND by Phase 1's
 * `soapEndpointEmitter.ts` (WSDL `spec_link` promotion / Workstream B) --
 * when a spec file matches more than one interface candidate, or when a
 * single interface candidate matches more than one spec file.
 *
 * Spec: 2026-05-17 Spec File Auto-Linking Phase 3, Task Group 1 (P-4 / P-14).
 *
 * Semantics:
 *  - Leave `spec_link` null on ALL involved candidates -- never guess.
 *  - Log all candidate IDs at `[diag-pack] scanner=spec_file_linker
 *    match=ambiguous candidates=[<id>,<id>,...] path=<rel-path>` level.
 *  - The single finding links to ALL involved candidate ids via
 *    `supports`, so the Findings tab can group the conflict report
 *    alongside every candidate it affected.
 *
 * `createdByStage='discovery.specFileLinker'` -- a dedicated stage label
 * so the Findings tab can filter by origin (distinct from
 * `findings.soapScanner` / `findings.evidenceGapScanner` /
 * `amvs.llmEndpointExtract`).
 *
 * Severity 'medium' (same as the other evidence-gap builders -- the gap
 * is notable but not critical; the user can still pick a `spec_link`
 * manually in Step 1 of the capture wizard).
 */
export function buildOasSpecAmbiguousGap(args: {
  /** Repo-relative path of the spec file the ambiguity is centred on. */
  specFilePath: string;
  /**
   * Short-ids of the interface candidates that all matched this spec
   * file -- length is always >= 2 (otherwise the scanner would have set
   * `spec_link` on the unique match instead).
   */
  candidateInterfaceIds: string[];
  /**
   * Optional one-line reason -- e.g. "two interfaces matched on
   * `paths` base-prefix `/petstore`".
   */
  reason?: string;
}): FindingEmitInput {
  const links: DiscoveryFindingLinkPayload[] = args.candidateInterfaceIds.map(
    (id) => ({
      linkType: 'supports',
      targetType: 'discovery_candidate' as const,
      targetId: id,
    }),
  );
  const detailJson: Record<string, unknown> = {
    gapType: 'oas_spec_ambiguous_match' satisfies EvidenceGapType,
    specFilePath: args.specFilePath,
    candidateInterfaceIds: args.candidateInterfaceIds,
  };
  if (args.reason != null) detailJson.reason = args.reason;
  return {
    findingType: 'evidence_gap',
    category: 'evidence_gap',
    severity: 'medium',
    title: `Evidence gap: ${args.specFilePath} -- oas_spec_ambiguous_match`,
    summary:
      args.reason ??
      `Spec file '${args.specFilePath}' matched ${args.candidateInterfaceIds.length} interface candidates; spec_link left null on all involved candidates.`,
    detailJson,
    source: 'pipeline_evidence_gap',
    createdByStage: 'discovery.specFileLinker',
    links,
  };
}

/**
 * Source H (OAS spec-file orphan variant): evidence gap emitted by the
 * `specFileLinker` scanner subtree -- AND by Phase 1's
 * `soapEndpointEmitter.ts` (WSDL `spec_link` promotion / Workstream B) --
 * when a qualifying spec file is discovered on disk but NO in-scope
 * interface candidate matches it under any of the priority-ordered
 * heuristics (`info.title` / `paths` base prefix / `tags[].name`).
 *
 * Spec: 2026-05-17 Spec File Auto-Linking Phase 3, Task Group 1 (P-5 / P-14).
 *
 * Semantics:
 *  - Do NOT create a new interface candidate from a spec file alone --
 *    that would conflict with adapter-driven candidate identity.
 *  - Record the file path on the gap (for the reviewer to triage).
 *  - The finding carries NO `supports` link -- by definition there is
 *    no candidate to link to.
 *
 * `createdByStage='discovery.specFileLinker'` -- same stage label as the
 * ambiguous-match variant so the Findings tab can filter both
 * spec-file-linker gaps together by origin.
 *
 * Severity 'medium' (same as the other evidence-gap builders).
 */
export function buildOasSpecOrphanGap(args: {
  /** Repo-relative path of the orphan spec file. */
  specFilePath: string;
  /**
   * Optional one-line reason -- e.g. "no interface candidate's name /
   * basePath / openApiTag matched the spec's info.title / paths /
   * tags[].name".
   */
  reason?: string;
}): FindingEmitInput {
  const detailJson: Record<string, unknown> = {
    gapType: 'oas_spec_orphan' satisfies EvidenceGapType,
    specFilePath: args.specFilePath,
  };
  if (args.reason != null) detailJson.reason = args.reason;
  return {
    findingType: 'evidence_gap',
    category: 'evidence_gap',
    severity: 'medium',
    title: `Evidence gap: ${args.specFilePath} -- oas_spec_orphan`,
    summary:
      args.reason ??
      `Spec file '${args.specFilePath}' was discovered on disk but no in-scope interface candidate matched it; no candidate created.`,
    detailJson,
    source: 'pipeline_evidence_gap',
    createdByStage: 'discovery.specFileLinker',
    links: [],
  };
}

/**
 * Source H (dimension-B specification-coverage variant): evidence gap emitted
 * by the per-endpoint completeness pass in `discoveryV3Pipeline.ts`.
 *
 * Spec: 2026-05-30 Capture Coverage Gates (Spec 5), Task Group 2.
 *
 * This is the discovery-side mirror of AMS Group 1's dimension-B
 * `computeSpecificationCoverage`. One Finding is emitted per UNDER-SPECIFIED
 * discovered endpoint, using the SAME per-protocol "fully specified" bar:
 *  - REST endpoint -> `endpoint_missing_data_effect`: the endpoint has NO
 *    resolved `endpoint_data_effects` edge (Spec 1). On the AMS side this is
 *    `EndpointDataEffectRepository.findByEndpointId(...)` being empty; on the
 *    discovery side it is "no `endpoint_data_effects` candidate references
 *    this endpoint by name".
 *  - SOAP operation -> `soap_operation_missing_message_binding`: the
 *    operation's parent interface has NO bound request/response message
 *    entities (Spec 4 `interface_logical_entities` + message
 *    `logical_data_entities`). On the AMS side this is
 *    `InterfaceLogicalEntityRepository.findByInterfaceId(...)` being empty; on
 *    the discovery side it is "no `interface_logical_entities` candidate binds
 *    a message entity to this endpoint's parent interface".
 *
 * `business_logics.behavior` (Spec 2) is a BONUS signal only and is NEVER
 * required here -- exactly as on the AMS side.
 *
 * Severity 'medium' (the canonical evidence-gap severity -- the endpoint is
 * still proposed; the gap flags that it is not yet migration-ready). The
 * finding links to the endpoint's discovery candidate via `supports`.
 *
 * `createdByStage='findings.specificationCoverage'` (distinct from the other
 * evidence-gap origins so the Findings tab can filter dimension-B gaps).
 */
export function buildUnderSpecifiedEndpointFinding(args: {
  /** The under-specified `endpoints` discovery candidate id. */
  candidateId: string;
  /** Display name of the endpoint candidate (for the title). */
  candidateName: string;
  /**
   * Which per-protocol bar the endpoint fell short of:
   *  - `endpoint_missing_data_effect` for a REST endpoint with no data effect.
   *  - `soap_operation_missing_message_binding` for a SOAP operation whose
   *    parent interface has no bound message entities.
   */
  gapType:
    | 'endpoint_missing_data_effect'
    | 'soap_operation_missing_message_binding';
  /** Optional human-readable summary. A protocol-appropriate default is built when absent. */
  gapDescription?: string;
}): FindingEmitInput {
  const summary =
    args.gapDescription ??
    (args.gapType === 'soap_operation_missing_message_binding'
      ? `SOAP operation '${args.candidateName}' is under-specified: its parent interface ` +
        `has no bound request/response message entities, so the message contract is ` +
        `not migration-ready.`
      : `REST endpoint '${args.candidateName}' is under-specified: it has no resolved ` +
        `data-effect edge, so the data it reads/writes is unknown and it is not ` +
        `migration-ready.`);
  return {
    findingType: 'evidence_gap',
    category: 'evidence_gap',
    severity: 'medium',
    title: `Evidence gap: ${args.candidateName} -- ${args.gapType}`,
    summary,
    detailJson: { gapType: args.gapType satisfies EvidenceGapType },
    source: 'pipeline_evidence_gap',
    createdByStage: 'findings.specificationCoverage',
    links: [
      {
        linkType: 'supports',
        targetType: 'discovery_candidate',
        targetId: args.candidateId,
      },
    ],
  };
}

/**
 * Source J (external-integration-dependency variant): a first-class Finding
 * emitted by the deterministic outbound-integration finding pass (Outbound
 * Integration Graph, Spec #5, Task Group 3) when an outbound call resolves to a
 * PURELY EXTERNAL target -- a bare URL / topic / queue / store / file / SDK
 * endpoint with NO in-model counterpart.
 *
 * Spec: 2026-05-30 Outbound Integration Graph for Discovery (Java / Spring
 * Classic + Spring Boot), Task Group 3.
 *
 * Why a DEDICATED first-class `findingType` rather than an `evidence_gap`:
 *  - This is NOT a gap in something we captured -- the outbound dependency IS
 *    captured (as a `data_movements` candidate with the source `application_point`
 *    resolved). The Finding records the VERBATIM external detail (the exact URL /
 *    topic + payload hint) so a like-for-like migration target can reproduce the
 *    downstream call, WITHOUT minting a speculative external service/interface
 *    entity. It sits alongside the other first-class non-`evidence_gap` finding
 *    types (`endpoint_auth_unresolved`, `endpoint_response_config_dependent`) --
 *    its own `findingType` keeps the dedupe semantics
 *    `(runId | findingType | category | title | primaryLinkedTarget)` clean.
 *  - It is the SAME architecture-vs-reality discipline Spec #1 / Spec #4 use:
 *    "resolved-but-not-fully-modellable -> Finding, never a silent drop, never an
 *    invented entity".
 *
 * Shape:
 *  - `findingType: 'external_integration_dependency'`,
 *    `category: 'migration_risk'` (the dependency is real; the risk is that the
 *    target is external and must be reproduced by the migration target).
 *  - severity `'medium'` (advisory -- the dependency is captured; the Finding
 *    surfaces the external detail for the reviewer).
 *  - `detail_json` carries: the `integrationKind`, the verbatim `target`, the
 *    optional `payloadHint`, the calling endpoint/service `sourceName` +
 *    `sourceKind`, and the call-site `callSiteFqn` + `callSiteLine` as evidence.
 *  - NO `discovery_candidate` link by default -- the dependency stands on its
 *    source/target NAMES (the `data_movements` candidate is its model surface);
 *    callers MAY pass a `candidateId` to link the emitted `data_movements`
 *    candidate via `supports`.
 *
 * `createdByStage='findings.outboundIntegrationScanner'` so the Findings tab can
 * filter outbound-dependency findings by origin. NEVER mints an external entity;
 * NEVER references a `*_points` wrapper.
 */
export function buildExternalIntegrationDependencyFinding(args: {
  /** The integration family (outbound-rest / messaging-producer / cache-store / ...). */
  integrationKind: string;
  /** The verbatim external target (URL / topic / queue / store / file / endpoint). */
  target: string;
  /** Optional best-effort payload-type hint (e.g. the message payload type). */
  payloadHint?: string;
  /** Whether the source is the calling endpoint or the owning service. */
  sourceKind: 'endpoint' | 'service';
  /** The source NAME (endpoint identity `${verb} ${path}` or owning service class name). */
  sourceName: string;
  /** Call-site FQN (`package.Class#method`) of the outbound call (evidence). */
  callSiteFqn: string;
  /** Call-site 0-based source line (evidence). */
  callSiteLine: number;
  /** Source file path the outbound call lives in (for the detail blob). */
  sourceFilePath: string;
  /** Optional `data_movements` candidate id to link via `supports`. */
  candidateId?: string;
}): FindingEmitInput {
  const links: DiscoveryFindingLinkPayload[] = args.candidateId
    ? [
        {
          linkType: 'supports',
          targetType: 'discovery_candidate',
          targetId: args.candidateId,
        },
      ]
    : [];
  const payloadClause =
    args.payloadHint && args.payloadHint.length > 0
      ? ` Payload type hint: ${args.payloadHint}.`
      : '';
  return {
    findingType: 'external_integration_dependency',
    category: 'migration_risk',
    severity: 'medium',
    title: `External integration dependency: ${args.integrationKind} -> ${args.target}`,
    summary:
      `${args.sourceKind === 'endpoint' ? 'Endpoint' : 'Service'} '${args.sourceName}' calls out to ` +
      `a purely external ${args.integrationKind} target '${args.target}' with no in-model counterpart. ` +
      `The dependency is recorded so the migration target can reproduce the downstream behaviour; ` +
      `no speculative external entity is minted.${payloadClause}`,
    detailJson: {
      integrationKind: args.integrationKind,
      target: args.target,
      payloadHint: args.payloadHint ?? null,
      sourceKind: args.sourceKind,
      sourceName: args.sourceName,
      callSiteFqn: args.callSiteFqn,
      callSiteLine: args.callSiteLine,
      migrationConcern:
        'This service makes an outbound call to an external target (URL / topic / queue / store / ' +
        'file / SDK endpoint) with no discovered in-model counterpart. The like-for-like migration ' +
        'target must reproduce the same downstream call; the verbatim target + payload hint are ' +
        'recorded here rather than as an invented external architecture entity.',
      filePath: args.sourceFilePath,
    },
    source: 'pipeline_outbound_integration',
    createdByStage: 'findings.outboundIntegrationScanner',
    links,
  };
}


// ============================================================================
// Operational-Artifact Findings (D1)
// Spec: 2026-06-14 Generic Operational-Artifact Discovery, Task Group 3.
// ============================================================================

/**
 * Stable, controlled `artifactKind` vocabulary (Decision 5). Any LLM value
 * outside this set is normalised to `other` by the caller (the scan step) --
 * do NOT invent new kinds.
 */
export const OPERATIONAL_ARTIFACT_KINDS = [
  'batch_job',
  'shell_script',
  'scheduler_config',
  'monitoring_config',
  'ci_config',
  'integration_config',
  'deployment_script',
  'maintenance_script',
  'other',
] as const;

export type OperationalArtifactKind = (typeof OPERATIONAL_ARTIFACT_KINDS)[number];

/**
 * The rich, validated per-file summary the scan step assembles from the LLM
 * relay response. All `*[]` reference lists are PLAIN STRINGS (Decision 6 -- no
 * candidate / entity resolution in D1; that is D2).
 */
export interface OperationalArtifactDetail {
  /** Repo-relative path of the summarised file. */
  filePath: string;
  /** What the file does (one or two sentences). */
  purpose: string;
  /** Controlled vocabulary; normalised to `other` when out of set. */
  artifactKind: OperationalArtifactKind;
  /**
   * Best-effort: does this file DO operational work that must carry over
   * like-for-like (vs pure config / noise)? Consumed by the D4 completeness gate.
   */
  behaviourBearing: boolean;
  /** Files / Java FQCNs / external commands it invokes (plain strings). */
  invokes: string[];
  /** Inputs: files / DB / env / network (plain strings). */
  inputs: string[];
  /** Outputs: files / DB / env / network (plain strings). */
  outputs: string[];
  /** Side effects (plain strings). */
  sideEffects: string[];
  /** External systems it touches (plain strings). */
  externalSystems: string[];
  /** Evidence snippets supporting the summary. */
  evidence: string[];
  /** Best-effort language / format label (e.g. `bash`, `jil`, `xml`). */
  language: string;
  /** The relevance signal that selected the file (rides for traceability). */
  relevanceSignal: string;
}

/**
 * Source D1: one `operational_artifact` Finding per unclaimed-but-relevant file.
 *
 * Spec: 2026-06-14 Generic Operational-Artifact Discovery, Decisions 4/5/6.
 *
 * Follows `buildDeferredSurfacePresentFinding` (info/advisory, run-level
 * `links: []`, `detailJson`-rich). EXACTLY ONE per file -- even when an artifact
 * spans files or a single script does many things (grouping is D2).
 *
 * Fixed fields: `findingType: 'operational_artifact'`, `category` mirrors
 * `artifactKind`, `severity: 'info'` (presence is a signal, not a defect),
 * `confidence` from the LLM (clamped by the caller), `source:
 * 'operational_artifact_scan'`, `createdByStage:
 * 'findings.operationalArtifactScan'`. No `reviewStatus` (AMS defaults
 * `pending_review`); `links: []` (standalone -- D6). No AMS schema change:
 * `findingType` / `category` are free-text and `detailJson` is open JSONB.
 */
export function buildOperationalArtifactFinding(args: {
  detail: OperationalArtifactDetail;
  /** LLM confidence already clamped to a sensible band by the caller. */
  confidence: number;
}): FindingEmitInput {
  const d = args.detail;
  const fileName = d.filePath.split('/').pop() || d.filePath;
  return {
    findingType: 'operational_artifact',
    // `category` mirrors `artifactKind` so the Findings tab can group by kind.
    category: d.artifactKind,
    severity: 'info',
    confidence: args.confidence,
    title: `Operational artifact: ${fileName} (${d.artifactKind})`,
    summary: d.purpose,
    detailJson: {
      purpose: d.purpose,
      artifactKind: d.artifactKind,
      behaviourBearing: d.behaviourBearing,
      invokes: d.invokes,
      inputs: d.inputs,
      outputs: d.outputs,
      sideEffects: d.sideEffects,
      externalSystems: d.externalSystems,
      evidence: d.evidence,
      filePath: d.filePath,
      language: d.language,
      relevanceSignal: d.relevanceSignal,
    },
    source: 'operational_artifact_scan',
    createdByStage: 'findings.operationalArtifactScan',
    links: [],
  };
}

/**
 * Source D1 (run-level): ONE skip Finding when the file-count cap overflows
 * (Decision 3). Records the overflow count + a sample of skipped paths so the
 * over-cap files are NEVER silently dropped. Run-level (no candidate link).
 */
export function buildOperationalArtifactCapSkipFinding(args: {
  cap: number;
  overflowCount: number;
  overflowSample: string[];
}): FindingEmitInput {
  return {
    findingType: 'operational_artifact_scan_skipped',
    category: 'scan_coverage',
    severity: 'info',
    title: `Operational-artifact scan cap reached: ${args.overflowCount} file(s) skipped`,
    summary:
      `The operational-artifact scan file-count cap (${args.cap}) was reached; ` +
      `${args.overflowCount} additional relevant file(s) were NOT summarised. ` +
      `Raise OPERATIONAL_ARTIFACT_FILE_CAP to cover them.`,
    detailJson: {
      cap: args.cap,
      overflowCount: args.overflowCount,
      overflowSample: args.overflowSample,
      remediation:
        'These files matched the operational-artifact relevance predicate but fell beyond the ' +
        'file-count cap. They are recorded here (never silently dropped); raise the cap env knob ' +
        'OPERATIONAL_ARTIFACT_FILE_CAP to summarise them on the next run.',
    },
    source: 'operational_artifact_scan',
    createdByStage: 'findings.operationalArtifactScan',
    links: [],
  };
}
