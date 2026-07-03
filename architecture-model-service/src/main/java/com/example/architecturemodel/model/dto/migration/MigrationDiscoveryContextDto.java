package com.example.architecturemodel.model.dto.migration;

import com.example.architecturemodel.model.dto.targetstate.TargetStateDecisionsSummaryDto;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Aggregated migration discovery context returned by
 * {@code POST /api/projects/{projectId}/migration-discovery-context}.
 *
 * <p>Bounded, LLM-ready summary spanning the current and (optional) target
 * architectures, recent discovery runs, prioritised discovery findings,
 * linked evidence highlights, unresolved decision tasks, runtime/log
 * observation hints, database discovery summaries, API behaviour baselines,
 * and current-to-target element mappings. Every block carries durable IDs so
 * downstream consumers can cite or re-fetch.</p>
 *
 * <p><b>Numeric counts are boxed</b> ({@link Long} / {@link Integer}) so that
 * absent / zero values are preserved through (de)serialisation without the
 * primitive-default-to-zero hazard documented in
 * {@code project_primitive_double_dto_overwrite.md}.</p>
 *
 * <p>Spec: Migration Discovery Context Integration (2026-05-16) -- Task Group 1.</p>
 *
 * <p>Spec: Target State Captured Decisions -- Data Plane (2026-05-24) --
 * Task Group 4 ADDITIVELY adds the {@code targetStateDecisionsSummary} field
 * carrying the project's active target architecture captured decisions. The
 * field is always populated -- on projects with no decisions (or no active
 * target architecture) the aggregation service sets it to
 * {@link TargetStateDecisionsSummaryDto#empty()} so existing consumers see a
 * consistent shape rather than a {@code null}. Existing fields above are
 * byte-identical to their pre-spec layout.</p>
 *
 * <p>Spec: Vulnerability Reduction + Steering (2026-06-24, Spec 4 of 6) --
 * Task Group 4 ADDITIVELY adds the OPTIONAL {@code estimatedReduction} block
 * (per-bucket totals: eliminated / remaining / newly-introduced, plus the
 * {@code estimate} flag). Unlike {@code targetStateDecisionsSummary} (always an
 * empty envelope), this block follows the strict ABSENT-when-no-target contract:
 * it is {@code null} (and omitted from the wire via {@link JsonInclude}) whenever
 * there is no target snapshot to grade against, so the roll-up NEVER asserts a
 * reduction that has not been computed. The reduction itself is computed by the
 * gateway delta service (the single source of truth) and is estimate-labelled at
 * the data layer; AMS carries the optional, fail-soft shape so the frontend
 * roll-up surface reads it through this aggregation. Existing fields are
 * byte-identical to their pre-spec layout.</p>
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record MigrationDiscoveryContextDto(
    @JsonProperty("projectId")
    UUID projectId,

    @JsonProperty("currentArchitectureId")
    UUID currentArchitectureId,

    @JsonProperty("targetArchitectureId")
    UUID targetArchitectureId,

    @JsonProperty("discoveryRunIds")
    List<UUID> discoveryRunIds,

    @JsonProperty("apiBehaviourBaselineIds")
    List<UUID> apiBehaviourBaselineIds,

    @JsonProperty("generatedAt")
    Instant generatedAt,

    @JsonProperty("summary")
    String summary,

    @JsonProperty("currentArchitectureSummary")
    ArchitectureSummary currentArchitectureSummary,

    @JsonProperty("targetArchitectureSummary")
    ArchitectureSummary targetArchitectureSummary,

    @JsonProperty("discoveryRunsSummary")
    DiscoveryRunsSummary discoveryRunsSummary,

    @JsonProperty("findingsSummary")
    FindingsSummary findingsSummary,

    @JsonProperty("highPriorityFindings")
    List<FindingHighlight> highPriorityFindings,

    @JsonProperty("findingsByCategory")
    Map<String, Integer> findingsByCategory,

    @JsonProperty("evidenceHighlights")
    List<EvidenceHighlight> evidenceHighlights,

    @JsonProperty("candidateSummary")
    CandidateSummary candidateSummary,

    @JsonProperty("unresolvedDecisionTasks")
    List<DecisionTaskHighlight> unresolvedDecisionTasks,

    @JsonProperty("runtimeUsageSummary")
    RuntimeUsageSummary runtimeUsageSummary,

    @JsonProperty("databaseDiscoverySummary")
    DatabaseDiscoverySummary databaseDiscoverySummary,

    @JsonProperty("apiBehaviourBaselineSummary")
    ApiBehaviourBaselineSummary apiBehaviourBaselineSummary,

    @JsonProperty("architectureMappingsSummary")
    ArchitectureMappingsSummary architectureMappingsSummary,

    @JsonProperty("readinessAssessment")
    ReadinessAssessmentDto readinessAssessment,

    @JsonProperty("contextWarnings")
    List<String> contextWarnings,

    /**
     * Captured target-state decisions summary block (Spec 2026-05-24, Task
     * Group 4). Always populated (never {@code null}) -- empty default when
     * the project has no active target architecture or zero captured
     * decisions. See {@link TargetStateDecisionsSummaryDto} for the empty
     * default contract.
     */
    @JsonProperty("targetStateDecisionsSummary")
    TargetStateDecisionsSummaryDto targetStateDecisionsSummary,

    @JsonProperty("scenarioSeeds")
    List<ScenarioSeedSetDto> scenarioSeeds,

    /**
     * OPTIONAL estimated current->target CVE reduction roll-up (Spec 4, Task
     * Group 4). {@code null} -- and omitted from the wire via the class-level
     * {@link JsonInclude} NON_NULL -- whenever there is no target snapshot to
     * grade against (the strict ABSENT-when-no-target contract; never a zeroed
     * block). When present, carries per-bucket totals and the {@code estimate}
     * flag so every reporting surface inherits the ESTIMATE label. Computed by
     * the gateway delta service (the single source of truth); AMS carries the
     * fail-soft shape only.
     */
    @JsonProperty("estimatedReduction")
    EstimatedReductionSummary estimatedReduction
) {

    // -----------------------------------------------------------------------
    // Nested summary records
    //
    // Each summary block carries durable IDs / counts; full payloads are
    // intentionally left out to keep the response bounded for LLM consumption.
    // -----------------------------------------------------------------------

    /** Counts of meta-model entities by category for an architecture. */
    public record ArchitectureSummary(
        @JsonProperty("architectureId") UUID architectureId,
        @JsonProperty("name") String name,
        @JsonProperty("applicationCount") Integer applicationCount,
        @JsonProperty("serviceCount") Integer serviceCount,
        @JsonProperty("interfaceCount") Integer interfaceCount,
        @JsonProperty("dataEntityCount") Integer dataEntityCount,
        @JsonProperty("dataStoreCount") Integer dataStoreCount,
        @JsonProperty("businessUserCount") Integer businessUserCount,
        @JsonProperty("processActivityCount") Integer processActivityCount,
        @JsonProperty("uiScreenCount") Integer uiScreenCount,
        @JsonProperty("userJourneyCount") Integer userJourneyCount,
        @JsonProperty("hasModel") Boolean hasModel
    ) {}

    /** Bounded summary of the discovery runs selected for this context. */
    public record DiscoveryRunsSummary(
        @JsonProperty("totalRuns") Integer totalRuns,
        @JsonProperty("completedRuns") Integer completedRuns,
        @JsonProperty("runs") List<DiscoveryRunHighlight> runs
    ) {}

    /** One selected discovery run, durable IDs preserved. */
    public record DiscoveryRunHighlight(
        @JsonProperty("runId") UUID runId,
        @JsonProperty("architectureId") UUID architectureId,
        @JsonProperty("status") String status,
        @JsonProperty("discoveryKind") String discoveryKind,
        @JsonProperty("createdAt") Instant createdAt,
        @JsonProperty("updatedAt") Instant updatedAt
    ) {}

    /** Roll-up of discovery findings across the selected runs. */
    public record FindingsSummary(
        @JsonProperty("totalFindings") Integer totalFindings,
        @JsonProperty("countsByStatus") Map<String, Integer> countsByStatus,
        @JsonProperty("countsBySeverity") Map<String, Integer> countsBySeverity,
        @JsonProperty("countsByCategory") Map<String, Integer> countsByCategory,
        @JsonProperty("highSeverityUnreviewedCount") Integer highSeverityUnreviewedCount,
        @JsonProperty("sampleDataHintCount") Integer sampleDataHintCount
    ) {}

    /** One prioritised finding surfaced into the context (durable IDs preserved). */
    public record FindingHighlight(
        @JsonProperty("findingId") UUID findingId,
        @JsonProperty("runId") UUID runId,
        @JsonProperty("findingType") String findingType,
        @JsonProperty("category") String category,
        @JsonProperty("severity") String severity,
        @JsonProperty("status") String status,
        @JsonProperty("title") String title,
        @JsonProperty("summary") String summary,
        @JsonProperty("source") String source,
        @JsonProperty("confidence") Double confidence
    ) {}

    /** One evidence atom referenced from a high-priority finding. */
    public record EvidenceHighlight(
        @JsonProperty("evidenceId") UUID evidenceId,
        @JsonProperty("runId") UUID runId,
        @JsonProperty("type") String type,
        @JsonProperty("source") String source,
        @JsonProperty("filePath") String filePath,
        @JsonProperty("linkedFindingIds") List<UUID> linkedFindingIds
    ) {}

    /** Counts of discovery candidates by type / status for the selected runs. */
    public record CandidateSummary(
        @JsonProperty("totalCandidates") Integer totalCandidates,
        @JsonProperty("countsByType") Map<String, Integer> countsByType,
        @JsonProperty("countsByStatus") Map<String, Integer> countsByStatus
    ) {}

    /** One unresolved decision task affecting the migration. */
    public record DecisionTaskHighlight(
        @JsonProperty("taskId") UUID taskId,
        @JsonProperty("runId") UUID runId,
        @JsonProperty("taskType") String taskType,
        @JsonProperty("status") String status,
        @JsonProperty("createdAt") Instant createdAt
    ) {}

    /** Runtime / log evidence summary. */
    public record RuntimeUsageSummary(
        @JsonProperty("runtimeEvidenceCount") Integer runtimeEvidenceCount,
        @JsonProperty("runtimeFindingCount") Integer runtimeFindingCount,
        @JsonProperty("hasRuntimeEvidence") Boolean hasRuntimeEvidence
    ) {}

    /** Database discovery roll-up (counts derived from {@code source} like {@code db-*-pack}). */
    public record DatabaseDiscoverySummary(
        @JsonProperty("databaseFindingCount") Integer databaseFindingCount,
        @JsonProperty("databaseRunCount") Integer databaseRunCount,
        @JsonProperty("sampleDataHintCount") Integer sampleDataHintCount,
        @JsonProperty("hasDatabaseDiscovery") Boolean hasDatabaseDiscovery,
        /**
         * Source engines detected on db-pack findings ({@code engineKey} in
         * {@code detail_json}), e.g. ["sybase"]. Empty when none declared.
         * Spec 2026-07-02-a (Persistence-Tier Oracle Program).
         */
        @JsonProperty("sourceEngines") List<String> sourceEngines,
        /**
         * DB migration pack roll-up for the (project, current architecture)
         * pair; {@code null} when no pack exists (key omitted on the wire per
         * the NON_NULL contract). Spec 2026-07-02-a.
         */
        @JsonProperty("dbMigrationPack") DbMigrationPackSummary dbMigrationPack
    ) {}

    /** Bounded DB-migration-pack roll-up (Spec 2026-07-02-a). All counts boxed. */
    public record DbMigrationPackSummary(
        @JsonProperty("packId") UUID packId,
        @JsonProperty("status") String status,
        @JsonProperty("openDecisionCount") Integer openDecisionCount,
        @JsonProperty("unapprovedTranslationCount") Integer unapprovedTranslationCount
    ) {}

    /** Bounded summary of API Behaviour Baselines for the project. */
    public record ApiBehaviourBaselineSummary(
        @JsonProperty("totalBaselines") Integer totalBaselines,
        @JsonProperty("activeBaselineCount") Integer activeBaselineCount,
        @JsonProperty("draftBaselineCount") Integer draftBaselineCount,
        @JsonProperty("baselines") List<BaselineHighlight> baselines
    ) {}

    /** One baseline header summary. */
    public record BaselineHighlight(
        @JsonProperty("baselineId") UUID baselineId,
        @JsonProperty("architectureId") UUID architectureId,
        @JsonProperty("sessionId") UUID sessionId,
        @JsonProperty("name") String name,
        @JsonProperty("status") String status,
        @JsonProperty("operationCount") Integer operationCount,
        @JsonProperty("acceptedCaptureCount") Integer acceptedCaptureCount,
        @JsonProperty("createdAt") Instant createdAt
    ) {}

    /** Current -> target architecture element mappings (counts only). */
    public record ArchitectureMappingsSummary(
        @JsonProperty("totalMappings") Integer totalMappings,
        @JsonProperty("countsBySourceType") Map<String, Integer> countsBySourceType,
        @JsonProperty("countsByTargetType") Map<String, Integer> countsByTargetType,
        @JsonProperty("countsByMappingType") Map<String, Integer> countsByMappingType
    ) {}

    /**
     * One generated test-scenario seed for a single API operation (Spec:
     * capture-scenario-seeding, 2026-05-30). Computed-on-read from the persisted
     * model -- no persistence. {@code expectedStatus} is boxed so an absent value
     * survives (de)serialisation without the primitive-zero hazard.
     */
    public record ScenarioSeedDto(
        @JsonProperty("scenarioType") String scenarioType,
        @JsonProperty("scenarioName") String scenarioName,
        @JsonProperty("exampleRequest") Map<String, Object> exampleRequest,
        @JsonProperty("preconditions") List<String> preconditions,
        @JsonProperty("expectedStatus") Integer expectedStatus,
        @JsonProperty("safeToExecute") Boolean safeToExecute,
        @JsonProperty("provenance") String provenance
    ) {}

    /**
     * The set of scenario seeds derived for one included harness operation
     * (Spec: capture-scenario-seeding, 2026-05-30). Always carries at least the
     * {@code happy_path} seed.
     */
    public record ScenarioSeedSetDto(
        @JsonProperty("operationKey") String operationKey,
        @JsonProperty("method") String method,
        @JsonProperty("path") String path,
        @JsonProperty("safeToExecute") Boolean safeToExecute,
        @JsonProperty("seeds") List<ScenarioSeedDto> seeds
    ) {}

    /**
     * OPTIONAL estimated current->target CVE reduction roll-up (Spec:
     * Vulnerability Reduction + Steering, 2026-06-24, Spec 4 -- Task Group 4).
     *
     * <p>Per-bucket totals modelled on the gateway delta service's
     * {@code ReductionTotals} (the {@code findingsCoverage.ts} before/after
     * analogue): {@code total} current CVEs graded, plus the {@code eliminated} /
     * {@code remaining} / {@code newlyIntroduced} counts. {@code newlyIntroduced}
     * is the OSV target-scan badged set -- {@code null} (omitted) on the
     * graceful-degrade path where the scan did not run, distinct from a present
     * {@code 0} meaning "scanned, none found".</p>
     *
     * <p>{@code estimate} is always {@code true} when this block is present so
     * every reporting surface inherits the ESTIMATE label rather than re-deciding
     * it. All counts are boxed so an absent value is preserved as {@code null}
     * (never the primitive-default {@code 0}) per
     * {@code project_primitive_double_dto_overwrite.md}. The WHOLE block is
     * {@code null} (and wire-omitted) when there is no target snapshot -- the
     * strict ABSENT-when-no-target contract, never a zeroed reduction.</p>
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record EstimatedReductionSummary(
        @JsonProperty("estimate") Boolean estimate,
        @JsonProperty("total") Integer total,
        @JsonProperty("eliminated") Integer eliminated,
        @JsonProperty("remaining") Integer remaining,
        @JsonProperty("newlyIntroduced") Integer newlyIntroduced
    ) {}
}
