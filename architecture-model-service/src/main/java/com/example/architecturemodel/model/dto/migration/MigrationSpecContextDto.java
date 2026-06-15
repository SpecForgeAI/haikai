package com.example.architecturemodel.model.dto.migration;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Response DTO for
 * {@code POST /api/projects/{projectId}/migration-spec-context}.
 *
 * <p>Carries one optional block per supported context-type (A-5):
 * {@code service}, {@code api}, {@code soap}, {@code data},
 * {@code infrastructure}, {@code test_pack}, and (D3, 2026-06-14)
 * {@code operational_capability}. Each block is bounded by the request's
 * {@code maxFindings} / {@code maxEvidenceItems} / {@code maxBaselineItems}
 * caps -- never an unbounded raw dump.</p>
 *
 * <p>Each block carries its own {@code missingInputs[]} for per-block readiness
 * blockers (e.g. "no current->target mapping for table PRICING_RULES"). The
 * top-level {@link #missingInputs} aggregates cross-block blockers. The resolver
 * returns a partial DTO with HTTP 200 + {@code missingInputs[]} populated rather
 * than 4xx-ing -- the gateway decides between {@code insufficient_context} and
 * an LLM attempt.</p>
 *
 * <p>Spec: PM Migration Shape-Spec Batch Generation (2026-05-19) -- Task Group 7.</p>
 * <p>Extended: Cross-Story Context Injection (2026-05-20) -- Task Group 3 adds
 * four new top-level fields ({@link #siblingSummaries},
 * {@link #parentRollup}, {@link #workstreamContext}, {@link #budgetMeta}) used
 * by the two-pass loop. All four are nullable for backwards compatibility
 * with today's pass-1-only callers.</p>
 * <p>Extended: D3 — Internal-behaviour implementation-ready spec generation
 * (2026-06-14) adds the 7th block {@link #operationalCapability}
 * ({@link OperationalCapabilityContextBlock}). Nullable; the legacy 15-arg
 * factory below defaults it (and the four cross-story blocks) to null so every
 * existing caller is unchanged.</p>
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record MigrationSpecContextDto(
    @JsonProperty("projectId") UUID projectId,
    @JsonProperty("workItemId") UUID workItemId,
    @JsonProperty("bookOfWorkId") UUID bookOfWorkId,
    @JsonProperty("bookItemId") String bookItemId,
    @JsonProperty("currentArchitectureId") UUID currentArchitectureId,
    @JsonProperty("targetArchitectureId") UUID targetArchitectureId,
    @JsonProperty("requestedContextTypes") List<String> requestedContextTypes,
    @JsonProperty("returnedContextTypes") List<String> returnedContextTypes,

    @JsonProperty("service") ServiceContextBlock service,
    @JsonProperty("api") ApiContextBlock api,
    @JsonProperty("soap") SoapContextBlock soap,
    @JsonProperty("data") DataContextBlock data,
    @JsonProperty("infrastructure") InfrastructureContextBlock infrastructure,
    @JsonProperty("test_pack") TestPackContextBlock testPack,
    @JsonProperty("operational_capability") OperationalCapabilityContextBlock operationalCapability,

    @JsonProperty("missingInputs") List<MissingInput> missingInputs,

    // --- Cross-Story Context Injection (Task Group 3, 2026-05-20) ---

    @JsonProperty("sibling_summaries") List<SiblingSummary> siblingSummaries,
    @JsonProperty("parent_rollup") ParentRollup parentRollup,
    @JsonProperty("workstream_context") WorkstreamContext workstreamContext,
    @JsonProperty("budget_meta") BudgetMeta budgetMeta
) {

    /**
     * Backwards-compatible factory variant used by legacy callers / tests that
     * predate the cross-story-context-injection additions (Task Group 3) AND the
     * D3 {@code operational_capability} block (2026-06-14). Wraps a {@code null}
     * value into the {@code operational_capability} block and each of the four
     * cross-story top-level blocks.
     */
    public MigrationSpecContextDto(
        UUID projectId,
        UUID workItemId,
        UUID bookOfWorkId,
        String bookItemId,
        UUID currentArchitectureId,
        UUID targetArchitectureId,
        List<String> requestedContextTypes,
        List<String> returnedContextTypes,
        ServiceContextBlock service,
        ApiContextBlock api,
        SoapContextBlock soap,
        DataContextBlock data,
        InfrastructureContextBlock infrastructure,
        TestPackContextBlock testPack,
        List<MissingInput> missingInputs
    ) {
        this(
            projectId,
            workItemId,
            bookOfWorkId,
            bookItemId,
            currentArchitectureId,
            targetArchitectureId,
            requestedContextTypes,
            returnedContextTypes,
            service,
            api,
            soap,
            data,
            infrastructure,
            testPack,
            null,
            missingInputs,
            null,
            null,
            null,
            null
        );
    }

    /**
     * Structured per-block missing-input descriptor used both inside individual
     * blocks (see {@code ServiceContextBlock.missingInputs} etc.) and in the
     * top-level cross-block aggregation. Shape mirrors the
     * {@code llm-output-insufficient-context.json} fixture: {@code kind},
     * {@code id}, {@code reason}.
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record MissingInput(
        @JsonProperty("kind") String kind,
        @JsonProperty("id") String id,
        @JsonProperty("reason") String reason
    ) {}

    /**
     * Application / service context block. Populated for story types where the
     * primary scope is a service / application component.
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ServiceContextBlock(
        @JsonProperty("currentServiceRef") String currentServiceRef,
        @JsonProperty("targetServiceRef") String targetServiceRef,
        @JsonProperty("sourceCodeCandidateRefs") List<String> sourceCodeCandidateRefs,
        @JsonProperty("packFindings") List<Map<String, Object>> packFindings,
        @JsonProperty("dependencies") List<Map<String, Object>> dependencies,
        @JsonProperty("rawSqlFindings") List<Map<String, Object>> rawSqlFindings,
        @JsonProperty("storedProcOrJdbcFindings") List<Map<String, Object>> storedProcOrJdbcFindings,
        @JsonProperty("mappings") List<Map<String, Object>> mappings,
        @JsonProperty("relatedArchitectureRefs") List<String> relatedArchitectureRefs,
        @JsonProperty("missingInputs") List<MissingInput> missingInputs
    ) {}

    /**
     * REST/OAS API operation context block. Populated for story types whose
     * scope is a REST endpoint / API operation.
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ApiContextBlock(
        @JsonProperty("operationId") String operationId,
        @JsonProperty("oasContractId") String oasContractId,
        @JsonProperty("endpointRef") String endpointRef,
        @JsonProperty("interfaceArchitectureRefs") List<String> interfaceArchitectureRefs,
        @JsonProperty("baselineRefs") List<String> baselineRefs,
        @JsonProperty("requestResponseExamples") List<Map<String, Object>> requestResponseExamples,
        @JsonProperty("runtimeUsageFindings") List<Map<String, Object>> runtimeUsageFindings,
        @JsonProperty("missingContractFindings") List<Map<String, Object>> missingContractFindings,
        @JsonProperty("mappings") List<Map<String, Object>> mappings,
        @JsonProperty("relatedServiceFindings") List<Map<String, Object>> relatedServiceFindings,
        @JsonProperty("relatedDataFindings") List<Map<String, Object>> relatedDataFindings,
        @JsonProperty("missingInputs") List<MissingInput> missingInputs
    ) {}

    /**
     * SOAP/WSDL operation context block. Populated for story types whose scope
     * is a SOAP service operation.
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record SoapContextBlock(
        @JsonProperty("operationName") String operationName,
        @JsonProperty("wsdlRef") String wsdlRef,
        @JsonProperty("xsdRefs") List<String> xsdRefs,
        @JsonProperty("soapAction") String soapAction,
        @JsonProperty("namespaces") List<String> namespaces,
        @JsonProperty("requestMessageDetails") Map<String, Object> requestMessageDetails,
        @JsonProperty("responseMessageDetails") Map<String, Object> responseMessageDetails,
        @JsonProperty("faultMessageDetails") List<Map<String, Object>> faultMessageDetails,
        @JsonProperty("baselineRefs") List<String> baselineRefs,
        @JsonProperty("payloadHints") List<Map<String, Object>> payloadHints,
        @JsonProperty("soapDiscoveryFindings") List<Map<String, Object>> soapDiscoveryFindings,
        @JsonProperty("mappings") List<Map<String, Object>> mappings,
        @JsonProperty("missingInputs") List<MissingInput> missingInputs
    ) {}

    /**
     * Data entity / table context block. Populated for data-migration story
     * types whose scope is a logical entity or physical table.
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record DataContextBlock(
        @JsonProperty("currentLogicalEntityRef") String currentLogicalEntityRef,
        @JsonProperty("targetLogicalEntityRef") String targetLogicalEntityRef,
        @JsonProperty("currentPhysicalEntityRef") String currentPhysicalEntityRef,
        @JsonProperty("targetPhysicalEntityRef") String targetPhysicalEntityRef,
        @JsonProperty("schemaRefs") List<String> schemaRefs,
        @JsonProperty("mappings") List<Map<String, Object>> mappings,
        @JsonProperty("dbDiscoveryProfileFindings") List<Map<String, Object>> dbDiscoveryProfileFindings,
        @JsonProperty("dataQualityFindings") List<Map<String, Object>> dataQualityFindings,
        @JsonProperty("storedProcViewTriggerFindings") List<Map<String, Object>> storedProcViewTriggerFindings,
        @JsonProperty("sampleDataHints") List<Map<String, Object>> sampleDataHints,
        @JsonProperty("reconciliationHints") List<Map<String, Object>> reconciliationHints,
        @JsonProperty("missingInputs") List<MissingInput> missingInputs
    ) {}

    /**
     * Infrastructure context block. Populated for infra-only stories
     * (environments, networking, IaC).
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record InfrastructureContextBlock(
        @JsonProperty("targetEnvironments") List<String> targetEnvironments,
        @JsonProperty("cloudAccountsOrProjects") List<String> cloudAccountsOrProjects,
        @JsonProperty("networkOrSubnetOrSecurityResources") List<Map<String, Object>> networkOrSubnetOrSecurityResources,
        @JsonProperty("computeOrRuntimeOrDeploymentUnits") List<Map<String, Object>> computeOrRuntimeOrDeploymentUnits,
        @JsonProperty("loadBalancersOrRouting") List<Map<String, Object>> loadBalancersOrRouting,
        @JsonProperty("observabilityRefs") List<String> observabilityRefs,
        @JsonProperty("secretsOrConfigRefs") List<String> secretsOrConfigRefs,
        @JsonProperty("iacSourceRefs") List<String> iacSourceRefs,
        @JsonProperty("missingInputs") List<MissingInput> missingInputs
    ) {}

    /**
     * Migration test-pack / reconciliation context block. Populated for
     * story types whose scope is reconciliation / migration testing.
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record TestPackContextBlock(
        @JsonProperty("baselineRefs") List<String> baselineRefs,
        @JsonProperty("apiContractRefs") List<String> apiContractRefs,
        @JsonProperty("soapContractRefs") List<String> soapContractRefs,
        @JsonProperty("dbDiscoveryFindings") List<Map<String, Object>> dbDiscoveryFindings,
        @JsonProperty("sampleDataHints") List<Map<String, Object>> sampleDataHints,
        @JsonProperty("reconciliationHints") List<Map<String, Object>> reconciliationHints,
        @JsonProperty("cutoverAssumptions") List<String> cutoverAssumptions,
        @JsonProperty("rollbackAssumptions") List<String> rollbackAssumptions,
        @JsonProperty("testStrategyNotes") List<String> testStrategyNotes,
        @JsonProperty("missingInputs") List<MissingInput> missingInputs
    ) {}

    /**
     * Operational-capability context block (D3, 2026-06-14): the 7th
     * context-type, populated for a story about non-API / internal work — a D2
     * {@code discovery_capability} grouping (batch pipeline / monitoring / FTP
     * ingestion / deployment / housekeeping) OR a behaviour-bearing
     * {@code operational_artifact} finding fallback.
     *
     * <p>{@link #source} records which path produced the block
     * ({@code "capability"} when resolved by {@code source_capability_id};
     * {@code "finding"} for the per-file fallback). {@link #detailJson} carries
     * the structured payload verbatim — the JIL-DAG topology snapshot, the typed
     * {@code invocations[]} edges (JIL→shell→Java→DB), schedule / trigger
     * metadata, inputs / outputs, side-effects, and external systems — exactly as
     * D2 persists it on the capability (or as the finding summariser persists it
     * on the artifact finding). {@link #members} + {@link #memberKinds} surface
     * the capability's membership edges. {@link #confidence} is a BOXED
     * {@link Double} so a downstream PATCH-style consumer never wipes it to
     * {@code 0.0}.</p>
     *
     * <p>{@link #missingInputs} carries {@code capability_members} /
     * {@code capability_behaviour} blockers when the capability is thin (zero
     * members / no behaviour signal); these aggregate into the DTO top-level list
     * so the gateway's pre-LLM {@code insufficient_context} short-circuit (D6)
     * fires with no LLM call.</p>
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record OperationalCapabilityContextBlock(
        @JsonProperty("capabilityId") String capabilityId,
        @JsonProperty("findingId") String findingId,
        @JsonProperty("source") String source,
        @JsonProperty("name") String name,
        @JsonProperty("kind") String kind,
        @JsonProperty("summary") String summary,
        @JsonProperty("confidence") Double confidence,
        @JsonProperty("reviewStatus") String reviewStatus,
        @JsonProperty("behaviourBearing") boolean behaviourBearing,
        @JsonProperty("members") List<Map<String, Object>> members,
        @JsonProperty("memberKinds") List<String> memberKinds,
        @JsonProperty("detailJson") Map<String, Object> detailJson,
        @JsonProperty("missingInputs") List<MissingInput> missingInputs
    ) {}

    // -----------------------------------------------------------------------
    // Cross-Story Context Injection top-level shapes (Task Group 3)
    // -----------------------------------------------------------------------

    /**
     * One sibling story's parser-extracted summary, attached at the top level
     * of the response when pass-2 is being assembled. NEVER carries
     * implementation steps -- only the structured signals the resolver writes
     * at AMS write-time via {@code ShapeSpecHeadingParser}.
     *
     * <p>Filter contract (loop guardrail surfaced at the resolver boundary):
     * only rows with {@code generation_pass = 1} AND status NOT IN
     * (failed, insufficient_context) appear here. Pass-2 outputs are never
     * exposed as sibling context -- the resolver enforces this regardless of
     * what the caller put in {@code passOneSpecIdsInScope}.</p>
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record SiblingSummary(
        @JsonProperty("workItemId") UUID workItemId,
        @JsonProperty("title") String title,
        @JsonProperty("decisions") List<String> decisions,
        @JsonProperty("interfaces") List<String> interfaces,
        @JsonProperty("assumptions") List<String> assumptions,
        @JsonProperty("generationPass") Integer generationPass
    ) {}

    /**
     * Walked parent chain: story -> feature -> epic -> initiative. Each block
     * may be null if the chain is short (e.g. an orphan epic). Epic block
     * carries the curated captured-decisions list (drafts + confirmed); feature
     * and initiative blocks are intentionally short (title + 1-sentence
     * summary) per spec.md.
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ParentRollup(
        @JsonProperty("epic") EpicBlock epic,
        @JsonProperty("feature") FeatureBlock feature,
        @JsonProperty("initiative") InitiativeBlock initiative
    ) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record EpicBlock(
        @JsonProperty("workItemId") UUID workItemId,
        @JsonProperty("title") String title,
        @JsonProperty("description") String description,
        @JsonProperty("capturedDecisions") List<CapturedDecision> capturedDecisions
    ) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record CapturedDecision(
        @JsonProperty("id") UUID id,
        @JsonProperty("decisionKey") String decisionKey,
        @JsonProperty("decisionText") String decisionText,
        @JsonProperty("status") String status,
        @JsonProperty("source") String source
    ) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record FeatureBlock(
        @JsonProperty("workItemId") UUID workItemId,
        @JsonProperty("title") String title,
        @JsonProperty("summary") String summary
    ) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record InitiativeBlock(
        @JsonProperty("workItemId") UUID workItemId,
        @JsonProperty("title") String title,
        @JsonProperty("summary") String summary
    ) {}

    /**
     * Workstream-level deduplicated references. Aggregated across all stories
     * in the current batch / pass-2 scope so per-story blocks never repeat
     * the same baseline / architecture ref. Each item carries
     * {@code referencedByStoryIds[]} so the UI can show which stories would
     * otherwise have repeated each ref.
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record WorkstreamContext(
        @JsonProperty("apiBaselines") List<DedupedRef> apiBaselines,
        @JsonProperty("architectureRefs") List<DedupedRef> architectureRefs
    ) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record DedupedRef(
        @JsonProperty("id") String id,
        @JsonProperty("kind") String kind,
        @JsonProperty("label") String label,
        @JsonProperty("referencedByStoryIds") List<UUID> referencedByStoryIds
    ) {}

    /**
     * Token-budget envelope record produced by {@code BudgetMetaTracker}
     * during resolution. Mirrored verbatim onto
     * {@code migration_story_spec_generations.budget_meta_json} so the
     * post-batch summary view can recover per-pass cost actuals.
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record BudgetMeta(
        @JsonProperty("used_tokens") Integer usedTokens,
        @JsonProperty("max_tokens") Integer maxTokens,
        @JsonProperty("per_story_max_tokens") Integer perStoryMaxTokens,
        @JsonProperty("cross_story_max_tokens") Integer crossStoryMaxTokens,
        @JsonProperty("trimmed") Trimmed trimmed,
        @JsonProperty("warnings") List<String> warnings
    ) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Trimmed(
        @JsonProperty("sibling_specs_dropped") Integer siblingSpecsDropped,
        @JsonProperty("evidence_refs_dropped") Integer evidenceRefsDropped,
        @JsonProperty("findings_dropped") Integer findingsDropped
    ) {}
}
