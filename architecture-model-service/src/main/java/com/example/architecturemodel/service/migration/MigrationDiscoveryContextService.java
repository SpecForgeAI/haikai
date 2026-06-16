package com.example.architecturemodel.service.migration;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.MetaModelSummaryDto;
import com.example.architecturemodel.model.dto.migration.MigrationDiscoveryContextDto;
import com.example.architecturemodel.model.dto.migration.MigrationDiscoveryContextRequestDto;
import com.example.architecturemodel.model.dto.migration.MigrationGapCodes;
import com.example.architecturemodel.model.dto.migration.ReadinessAssessmentDto;
import com.example.architecturemodel.model.entity.ArchitectureElementMappingEntity;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.model.entity.DiscoveryCandidateEntity;
import com.example.architecturemodel.model.entity.DiscoveryDecisionTaskEntity;
import com.example.architecturemodel.model.entity.DiscoveryEvidenceEntity;
import com.example.architecturemodel.model.entity.DiscoveryRunEntity;
import com.example.architecturemodel.model.entity.EndpointEntity;
import com.example.architecturemodel.model.entity.InterfaceLogicalEntityEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourBaselineEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourCaptureEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourDiffEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourOperationEntity;
import com.example.architecturemodel.model.entity.discovery.DiscoveryFindingEntity;
import com.example.architecturemodel.model.entity.discovery.DiscoveryFindingLinkEntity;
import com.example.architecturemodel.model.entity.discovery.EndpointDataEffectEntity;
import com.example.architecturemodel.repository.ArchitectureRepository;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.ProjectRepository;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourBaselineRepository;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourCaptureRepository;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourDiffItemRepository;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourDiffRepository;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourOperationRepository;
import com.example.architecturemodel.repository.discovery.DiscoveryFindingLinkRepository;
import com.example.architecturemodel.repository.discovery.DiscoveryFindingRepository;
import com.example.architecturemodel.repository.discovery.EndpointDataEffectRepository;
import com.example.architecturemodel.repository.entity.ArchitectureElementMappingRepository;
import com.example.architecturemodel.repository.entity.DiscoveryCandidateRepository;
import com.example.architecturemodel.repository.entity.DiscoveryDecisionTaskRepository;
import com.example.architecturemodel.repository.entity.DiscoveryEvidenceRepository;
import com.example.architecturemodel.repository.entity.DiscoveryRunRepository;
import com.example.architecturemodel.repository.entity.EndpointRepository;
import com.example.architecturemodel.repository.relationship.InterfaceLogicalEntityRepository;
import com.example.architecturemodel.model.dto.targetstate.CapturedDecisionRefDto;
import com.example.architecturemodel.model.dto.targetstate.TargetStateDecisionsSummaryDto;
import com.example.architecturemodel.model.entity.TargetStateCapturedDecisionEntity;
import com.example.architecturemodel.service.MetaModelSummaryService;
import com.example.architecturemodel.service.TargetStateCapturedDecisionService;
import com.example.architecturemodel.trace.HaikaiTrace;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Read-only aggregation service for the
 * {@code POST /api/projects/{projectId}/migration-discovery-context} endpoint.
 *
 * <p>Composes existing discovery, API-baseline, and architecture-mapping
 * repositories into a single bounded, LLM-ready DTO. No new tables, no
 * Liquibase changesets, no writes.</p>
 *
 * <h2>Latest-run resolution</h2>
 * Mirrors {@code DiscoverySummaryService}: when the request omits
 * {@code discoveryRunIds}, the service falls back to the most recent
 * {@code COMPLETED} runs for the current architecture (capped at
 * {@link #DEFAULT_LATEST_RUN_LIMIT}). When the caller supplies run IDs, those
 * runs are validated to belong to the project + current-architecture pair.
 *
 * <h2>Findings prioritisation</h2>
 * Order (high to low): critical/high severity, then pending_review, then
 * accepted, then by category bucket (migration_risk, data_quality,
 * business_logic, runtime_usage, reconciliation, testability, sample_data),
 * with the remainder ordered by createdAt descending. Truncation to
 * {@code maxFindings} is applied AFTER sort.
 *
 * <h2>Readiness rules (raw-idea Part 6)</h2>
 * Deterministic per-stream sufficient / partial / insufficient with a fixed
 * gap-code set ({@link MigrationGapCodes}). Overall status is
 * {@code sufficient} only when core selected streams are sufficient.
 *
 * <h2>Coverage gates (Spec: Capture Coverage Gates, 2026-05-30)</h2>
 * Three additional ADVISORY coverage dimensions are computed-on-read (NO new
 * persistence) and folded into the existing readiness streams:
 * <ul>
 *   <li>(A) CAPTURE coverage -- of a baseline session's {@code included}
 *       operations, how many were captured (joined {@code api_behaviour_*});
 *       a current-only baseline never replayed against a target has NO diffed
 *       coverage BY NATURE (that absence is the unexecuted signal, not an
 *       error). Emits {@link MigrationGapCodes#INCOMPLETE_CAPTURE_COVERAGE}.</li>
 *   <li>(B) SPECIFICATION coverage -- per-protocol "fully specified" bar (REST
 *       = resolved {@code endpoint_data_effects}; SOAP = parent interface has
 *       bound message entities; behaviour is BONUS only). Emits
 *       {@link MigrationGapCodes#UNDER_SPECIFIED_ENDPOINTS}.</li>
 *   <li>(C) INVENTORY reconciliation -- model endpoint inventory vs the harness
 *       {@code api_behaviour_operations} set, BOTH directions, SOAP-aware key.
 *       Emits {@link MigrationGapCodes#DISCOVERY_HARNESS_INVENTORY_MISMATCH}.</li>
 * </ul>
 * Each dimension downgrades the relevant stream to {@code partial}/{@code
 * insufficient} only -- NEVER blocking; the existing end-of-method {@code gaps}
 * dedupe absorbs duplicates.
 *
 * <p>Spec: Migration Discovery Context Integration (2026-05-16) -- Task Group 1
 * (D1 / D2 / D7).</p>
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@Slf4j
public class MigrationDiscoveryContextService {

    /** Cap on the number of latest runs returned when the request omits explicit IDs. */
    public static final int DEFAULT_LATEST_RUN_LIMIT = 3;

    /**
     * Haikai workflow tracer (service name {@code ams}). OFF by default --
     * every call is a no-op unless {@code HAIKAI_TRACE} is set. See
     * {@code docs/trace-logging.md}.
     */
    private static final HaikaiTrace.Tracer TRACE = HaikaiTrace.forService("ams");

    /** Severity values treated as "high priority" for sort + gap detection. */
    public static final Set<String> HIGH_SEVERITY = Set.of("critical", "high");

    /** Status values that signal a finding still needs reviewer attention. */
    public static final Set<String> UNREVIEWED_STATUSES = Set.of("pending_review");

    /** Category bucket order used during prioritisation (after severity + status). */
    public static final List<String> CATEGORY_PRIORITY = List.of(
        "migration_risk",
        "data_quality",
        "business_logic",
        "runtime_usage",
        "reconciliation",
        "testability",
        "sample_data"
    );

    /** Source prefix used to identify a database-pack-emitted finding. */
    public static final String DB_SOURCE_PREFIX = "db-";

    /**
     * The bright-line {@code review_status} disposition suppressed from this
     * migration-planning context (Spec 2, Task Group 2). A {@code rejected}
     * finding / candidate is GENUINELY ABSENT from BOTH the LLM payloads AND the
     * summary counts. {@code deferred} is intentionally NOT suppressed (a
     * legitimate known-unknown for planning).
     */
    public static final String REJECTED_REVIEW_STATUS = "rejected";

    /** Decision task statuses considered "unresolved". */
    public static final Set<String> UNRESOLVED_DECISION_TASK_STATUSES = Set.of(
        "pending", "needs_review"
    );

    /** Source values treated as runtime / log evidence. */
    public static final Set<String> RUNTIME_FINDING_CATEGORIES = Set.of(
        "runtime_usage", "runtime_log", "log"
    );

    private final ProjectRepository projectRepository;
    private final ArchitectureRepository architectureRepository;
    private final DiscoveryRunRepository discoveryRunRepository;
    private final DiscoveryFindingRepository discoveryFindingRepository;
    private final DiscoveryFindingLinkRepository discoveryFindingLinkRepository;
    private final DiscoveryCandidateRepository discoveryCandidateRepository;
    private final DiscoveryEvidenceRepository discoveryEvidenceRepository;
    private final DiscoveryDecisionTaskRepository discoveryDecisionTaskRepository;
    private final ApiBehaviourBaselineRepository apiBehaviourBaselineRepository;
    private final ArchitectureElementMappingRepository architectureElementMappingRepository;

    /**
     * Read-only collaborators for the computed-on-read coverage gates (Spec:
     * Capture Coverage Gates, 2026-05-30). All are NULLABLE so the standalone
     * unit-test path (which exercises {@code build(...)} without the harness /
     * model repositories) can wire {@code null} -- in that case the matching
     * coverage dimension is simply skipped (empty aggregate, no gap code). No
     * new persistence: every finder used here already existed.
     */
    private final ApiBehaviourOperationRepository apiBehaviourOperationRepository;
    private final ApiBehaviourCaptureRepository apiBehaviourCaptureRepository;
    private final ApiBehaviourDiffRepository apiBehaviourDiffRepository;
    private final ApiBehaviourDiffItemRepository apiBehaviourDiffItemRepository;
    private final ModelFileRepository modelFileRepository;
    private final EndpointRepository endpointRepository;
    private final EndpointDataEffectRepository endpointDataEffectRepository;
    private final InterfaceLogicalEntityRepository interfaceLogicalEntityRepository;

    /**
     * Optional meta-model summary service. The constructor accepts a null
     * collaborator so unit tests can wire repositories directly without a
     * Spring context; in that case architecture summaries surface zero
     * counts and {@code hasModel == false}.
     */
    private final MetaModelSummaryService metaModelSummaryService;

    /**
     * Captured target-state decisions service (Spec 2026-05-24 -- Task Group 4.6).
     * Nullable so tests can wire the service without the captured-decisions
     * collaborator -- in that case the aggregation block reverts to the empty
     * default returned by {@link TargetStateDecisionsSummaryDto#empty()}.
     */
    private final TargetStateCapturedDecisionService targetStateCapturedDecisionService;

    /** Production constructor (all collaborators are required at runtime). */
    @Autowired
    public MigrationDiscoveryContextService(
            ProjectRepository projectRepository,
            ArchitectureRepository architectureRepository,
            DiscoveryRunRepository discoveryRunRepository,
            DiscoveryFindingRepository discoveryFindingRepository,
            DiscoveryFindingLinkRepository discoveryFindingLinkRepository,
            DiscoveryCandidateRepository discoveryCandidateRepository,
            DiscoveryEvidenceRepository discoveryEvidenceRepository,
            DiscoveryDecisionTaskRepository discoveryDecisionTaskRepository,
            ApiBehaviourBaselineRepository apiBehaviourBaselineRepository,
            ArchitectureElementMappingRepository architectureElementMappingRepository,
            ApiBehaviourOperationRepository apiBehaviourOperationRepository,
            ApiBehaviourCaptureRepository apiBehaviourCaptureRepository,
            ApiBehaviourDiffRepository apiBehaviourDiffRepository,
            ApiBehaviourDiffItemRepository apiBehaviourDiffItemRepository,
            ModelFileRepository modelFileRepository,
            EndpointRepository endpointRepository,
            EndpointDataEffectRepository endpointDataEffectRepository,
            InterfaceLogicalEntityRepository interfaceLogicalEntityRepository,
            MetaModelSummaryService metaModelSummaryService,
            TargetStateCapturedDecisionService targetStateCapturedDecisionService) {
        this.projectRepository = projectRepository;
        this.architectureRepository = architectureRepository;
        this.discoveryRunRepository = discoveryRunRepository;
        this.discoveryFindingRepository = discoveryFindingRepository;
        this.discoveryFindingLinkRepository = discoveryFindingLinkRepository;
        this.discoveryCandidateRepository = discoveryCandidateRepository;
        this.discoveryEvidenceRepository = discoveryEvidenceRepository;
        this.discoveryDecisionTaskRepository = discoveryDecisionTaskRepository;
        this.apiBehaviourBaselineRepository = apiBehaviourBaselineRepository;
        this.architectureElementMappingRepository = architectureElementMappingRepository;
        this.apiBehaviourOperationRepository = apiBehaviourOperationRepository;
        this.apiBehaviourCaptureRepository = apiBehaviourCaptureRepository;
        this.apiBehaviourDiffRepository = apiBehaviourDiffRepository;
        this.apiBehaviourDiffItemRepository = apiBehaviourDiffItemRepository;
        this.modelFileRepository = modelFileRepository;
        this.endpointRepository = endpointRepository;
        this.endpointDataEffectRepository = endpointDataEffectRepository;
        this.interfaceLogicalEntityRepository = interfaceLogicalEntityRepository;
        this.metaModelSummaryService = metaModelSummaryService;
        this.targetStateCapturedDecisionService = targetStateCapturedDecisionService;
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    /**
     * Build the migration discovery context for the supplied request.
     *
     * @param projectId the project UUID (from the URL path)
     * @param request   the (validated) request body; may use service-side defaults
     *                  for nullable fields
     * @return the aggregated context DTO
     * @throws ResourceNotFoundException when project / architecture / supplied IDs
     *         do not match the path scope
     * @throws IllegalArgumentException  when the request body is null or missing
     *         a required field
     */
    @Transactional(readOnly = true)
    public MigrationDiscoveryContextDto build(UUID projectId, MigrationDiscoveryContextRequestDto request) {
        if (request == null) {
            throw new IllegalArgumentException("Request body is required");
        }
        if (request.currentArchitectureId() == null) {
            throw new IllegalArgumentException("currentArchitectureId is required");
        }
        if (projectId == null) {
            throw new IllegalArgumentException("projectId is required");
        }

        // 1. Validate scope (project / architectures).
        validateProjectExists(projectId);
        ArchitectureEntity currentArchitecture =
            requireArchitectureInProject(projectId, request.currentArchitectureId(), "currentArchitectureId");
        ArchitectureEntity targetArchitecture = null;
        if (request.targetArchitectureId() != null) {
            targetArchitecture = requireArchitectureInProject(
                projectId, request.targetArchitectureId(), "targetArchitectureId");
        }

        // 2. Resolve discovery runs (explicit list -> validate; otherwise latest completed).
        List<DiscoveryRunEntity> runs = resolveDiscoveryRuns(
            projectId, currentArchitecture.getId(), request.discoveryRunIds());
        List<UUID> runIds = runs.stream().map(DiscoveryRunEntity::getId).toList();
        List<String> contextWarnings = new ArrayList<>();
        if (runs.isEmpty()) {
            contextWarnings.add("no_discovery_runs_selected");
        }

        // 3. Load findings (priority + cap), evidence, decision tasks, candidates.
        boolean includeFindings = request.includeFindingsOrDefault();
        boolean includeEvidence = request.includeEvidenceOrDefault();
        boolean includeRuntimeEvidence = request.includeRuntimeEvidenceOrDefault();
        boolean includeDbFindings = request.includeDbFindingsOrDefault();
        boolean includeMappings = request.includeMappingsOrDefault();
        int maxFindings = request.maxFindingsOrDefault();
        int maxEvidenceItems = request.maxEvidenceItemsOrDefault();

        List<DiscoveryFindingEntity> allFindings = includeFindings
            ? loadFindingsForRuns(runIds, projectId, currentArchitecture.getId())
            : Collections.emptyList();
        List<DiscoveryFindingEntity> prioritisedFindings = prioritiseAndCap(allFindings, maxFindings);

        if (includeFindings && !runs.isEmpty() && allFindings.isEmpty()) {
            contextWarnings.add("no_findings_in_run");
        }

        // Evidence highlights: only the evidence linked to the prioritised findings.
        List<DiscoveryFindingLinkEntity> evidenceLinks = includeEvidence
            ? loadEvidenceLinksForFindings(prioritisedFindings)
            : Collections.emptyList();
        List<MigrationDiscoveryContextDto.EvidenceHighlight> evidenceHighlights =
            buildEvidenceHighlights(evidenceLinks, maxEvidenceItems);

        // Decision tasks for selected runs.
        List<DiscoveryDecisionTaskEntity> unresolvedDecisionTasks =
            loadUnresolvedDecisionTasks(runIds);

        // 4. Build sub-DTOs.
        MigrationDiscoveryContextDto.ArchitectureSummary currentArchSummary =
            buildArchitectureSummary(projectId, currentArchitecture);
        MigrationDiscoveryContextDto.ArchitectureSummary targetArchSummary =
            targetArchitecture == null
                ? null
                : buildArchitectureSummary(projectId, targetArchitecture);

        MigrationDiscoveryContextDto.DiscoveryRunsSummary runsSummary =
            buildRunsSummary(runs);

        MigrationDiscoveryContextDto.FindingsSummary findingsSummary =
            buildFindingsSummary(allFindings);
        Map<String, Integer> findingsByCategory = findingsSummary.countsByCategory();

        List<MigrationDiscoveryContextDto.FindingHighlight> highPriorityFindings =
            prioritisedFindings.stream().map(this::toFindingHighlight).toList();

        MigrationDiscoveryContextDto.CandidateSummary candidateSummary =
            buildCandidateSummary(runIds);

        MigrationDiscoveryContextDto.RuntimeUsageSummary runtimeUsageSummary =
            includeRuntimeEvidence
                ? buildRuntimeUsageSummary(runIds, allFindings)
                : null;

        MigrationDiscoveryContextDto.DatabaseDiscoverySummary databaseDiscoverySummary =
            includeDbFindings
                ? buildDatabaseDiscoverySummary(runs, allFindings)
                : null;

        MigrationDiscoveryContextDto.ApiBehaviourBaselineSummary baselineSummary =
            buildBaselineSummary(
                projectId, currentArchitecture.getId(), request.apiBehaviourBaselineIds());

        MigrationDiscoveryContextDto.ArchitectureMappingsSummary mappingsSummary =
            includeMappings && targetArchitecture != null
                ? buildMappingsSummary(
                    projectId, currentArchitecture.getId(), targetArchitecture.getId())
                : emptyMappingsSummary();

        // 5. Coverage aggregates (computed-on-read, advisory) + readiness assessment.
        //
        // Resolve the model file ONCE here (the pattern MetaModelSummaryService
        // uses) for dimension B + C; dimensions A + C also read the harness
        // api_behaviour_* tables joined by the baseline session ids. All three
        // are pure reads -- no schema change, no new persistence.
        CoverageAggregates coverage = computeCoverageAggregates(
            projectId, currentArchitecture.getId(), baselineSummary);

        ReadinessContext readinessCtx = new ReadinessContext(
            currentArchSummary,
            targetArchSummary,
            runs,
            allFindings,
            unresolvedDecisionTasks,
            baselineSummary,
            mappingsSummary,
            databaseDiscoverySummary,
            runtimeUsageSummary,
            targetArchitecture != null,
            coverage);
        ReadinessAssessmentDto readiness = assessReadiness(readinessCtx);
        traceReadiness(projectId, currentArchitecture, readinessCtx, readiness);

        // 6. Compose final DTO.
        List<UUID> baselineIds = baselineSummary.baselines().stream()
            .map(MigrationDiscoveryContextDto.BaselineHighlight::baselineId)
            .toList();

        String summary = composeTopLineSummary(currentArchitecture, runs, allFindings,
            unresolvedDecisionTasks, baselineSummary, mappingsSummary, readiness);

        // ------------------------------------------------------------------
        // Target-state captured decisions block (Spec 2026-05-24 Task Group 4).
        //
        // Resolved from the project's *active* target architecture (kind='target',
        // draftState='active', archived=false) -- the same selection logic the
        // ActiveTargetArchitectureController exposes for the gateway resolver.
        // We intentionally do NOT use request.targetArchitectureId() here: that
        // field is the caller's mapping scope (current->target for the
        // architectureMappingsSummary block), which may legitimately point at a
        // draft target. Captured decisions only live on the *active* target.
        //
        // Empty default semantics:
        //   * includeTargetStateDecisions == false  -> empty()
        //   * no active target architecture         -> empty()
        //   * active target but zero decisions      -> empty()
        //   * captured-decisions service not wired  -> empty() (test isolation)
        // Always populated (never null) so existing consumers see a consistent
        // shape rather than an absent / nullable field.
        // ------------------------------------------------------------------
        TargetStateDecisionsSummaryDto targetStateDecisionsSummary =
            buildTargetStateDecisionsSummary(projectId, request);

        // ------------------------------------------------------------------
        // Scenario seeds block (Spec: capture-scenario-seeding, 2026-05-30).
        //
        // Compute-on-read from the already-persisted model + harness baselines:
        // one seed set per INCLUDED harness operation, sourced from the matched
        // model endpoint's data effects (safe-to-execute) and persisted response
        // contract (error / edge / auth seeds). Pure reads -- no persistence, no
        // new constructor dependency. Degrades to an empty list (never null,
        // never throws) when the coverage collaborators are absent (unit tests).
        // ------------------------------------------------------------------
        List<MigrationDiscoveryContextDto.ScenarioSeedSetDto> scenarioSeeds =
            computeScenarioSeeds(currentArchitecture, baselineSummary);

        return new MigrationDiscoveryContextDto(
            projectId,
            currentArchitecture.getId(),
            targetArchitecture == null ? null : targetArchitecture.getId(),
            runIds,
            baselineIds,
            Instant.now(),
            summary,
            currentArchSummary,
            targetArchSummary,
            runsSummary,
            findingsSummary,
            highPriorityFindings,
            findingsByCategory,
            evidenceHighlights,
            candidateSummary,
            unresolvedDecisionTasks.stream().map(this::toDecisionTaskHighlight).toList(),
            runtimeUsageSummary,
            databaseDiscoverySummary,
            baselineSummary,
            mappingsSummary,
            readiness,
            contextWarnings,
            targetStateDecisionsSummary,
            scenarioSeeds
        );
    }

    // -----------------------------------------------------------------------
    // Target-state captured decisions block (Spec 2026-05-24 Task Group 4)
    // -----------------------------------------------------------------------

    /**
     * Build the {@code targetStateDecisionsSummary} block for the aggregation
     * response. Always returns a populated envelope (never {@code null}).
     *
     * <p>Resolution path:</p>
     * <ol>
     *   <li>If the request flag {@code includeTargetStateDecisions} is
     *       explicitly {@code false}, return {@link TargetStateDecisionsSummaryDto#empty()}.
     *       Per spec.md, the empty envelope (not {@code null}) preserves the
     *       byte-stable shape contract across requests.</li>
     *   <li>If the captured-decisions service collaborator was not wired
     *       (legacy test paths that pass {@code null}), return
     *       {@link TargetStateDecisionsSummaryDto#empty()}.</li>
     *   <li>Resolve the project's active target architecture (kind=='target',
     *       draftState=='active', archived=false) using the same query the
     *       {@code ActiveTargetArchitectureController} exposes for the gateway
     *       resolver. If absent, return empty.</li>
     *   <li>List the latest non-superseded decisions for that active target;
     *       partition into architecture-wide (scopeKind=='architecture') and
     *       scoped overrides (service / interface / element). Populate the
     *       summary with {@code totalDecisionCount = rows.size()} and
     *       {@code lastDecisionAt = max(createdAt)}.</li>
     * </ol>
     */
    private TargetStateDecisionsSummaryDto buildTargetStateDecisionsSummary(
            UUID projectId, MigrationDiscoveryContextRequestDto request) {
        if (!request.includeTargetStateDecisionsOrDefault()) {
            return TargetStateDecisionsSummaryDto.empty();
        }
        if (targetStateCapturedDecisionService == null) {
            return TargetStateDecisionsSummaryDto.empty();
        }
        Optional<ArchitectureEntity> activeTarget = architectureRepository
            .findFirstByProjectIdAndKindAndDraftStateAndArchivedFalseOrderByCreatedAtDesc(
                projectId, "target", "active");
        if (activeTarget.isEmpty()) {
            return TargetStateDecisionsSummaryDto.empty();
        }
        UUID activeTargetId = activeTarget.get().getId();
        List<TargetStateCapturedDecisionEntity> rows =
            targetStateCapturedDecisionService.listLatestDecisions(projectId, activeTargetId);
        if (rows == null || rows.isEmpty()) {
            return TargetStateDecisionsSummaryDto.empty();
        }

        List<CapturedDecisionRefDto> architectureWide = new ArrayList<>();
        List<CapturedDecisionRefDto> scopedOverrides = new ArrayList<>();
        Instant latestAt = null;
        for (TargetStateCapturedDecisionEntity row : rows) {
            CapturedDecisionRefDto ref = new CapturedDecisionRefDto(
                row.getId(),
                row.getDecisionCode(),
                row.getScopeKind(),
                row.getScopeRefId(),
                row.getAnswerSummary(),
                row.getStandardsLookupRef()
            );
            if ("architecture".equalsIgnoreCase(row.getScopeKind())) {
                architectureWide.add(ref);
            } else {
                scopedOverrides.add(ref);
            }
            Instant createdAt = row.getCreatedAt();
            if (createdAt != null && (latestAt == null || createdAt.isAfter(latestAt))) {
                latestAt = createdAt;
            }
        }
        return new TargetStateDecisionsSummaryDto(
            architectureWide, scopedOverrides, rows.size(), latestAt);
    }

    // -----------------------------------------------------------------------
    // Scope validation
    // -----------------------------------------------------------------------

    private void validateProjectExists(UUID projectId) {
        if (!projectRepository.existsById(projectId)) {
            throw new ResourceNotFoundException("Project not found: " + projectId);
        }
    }

    private ArchitectureEntity requireArchitectureInProject(
            UUID projectId, UUID architectureId, String label) {
        ArchitectureEntity arch = architectureRepository.findById(architectureId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "Architecture not found for " + label + ": " + architectureId));
        if (!projectId.equals(arch.getProjectId())) {
            throw new ResourceNotFoundException(
                "Architecture " + architectureId + " (" + label
                    + ") does not belong to project " + projectId);
        }
        return arch;
    }

    /**
     * Resolve discovery runs:
     * <ul>
     *   <li>If the caller supplied an explicit list, load + validate each.</li>
     *   <li>Otherwise return the most recent {@code COMPLETED} runs for the
     *       current architecture, capped at {@link #DEFAULT_LATEST_RUN_LIMIT}.</li>
     * </ul>
     */
    private List<DiscoveryRunEntity> resolveDiscoveryRuns(
            UUID projectId, UUID currentArchitectureId, List<UUID> requestedIds) {
        if (requestedIds != null && !requestedIds.isEmpty()) {
            List<DiscoveryRunEntity> runs = new ArrayList<>(requestedIds.size());
            for (UUID id : requestedIds) {
                DiscoveryRunEntity run = discoveryRunRepository.findById(id)
                    .orElseThrow(() -> new ResourceNotFoundException(
                        "Discovery run not found: " + id));
                if (!projectId.equals(run.getProjectId())
                        || !currentArchitectureId.equals(run.getArchitectureId())) {
                    throw new ResourceNotFoundException(
                        "Discovery run " + id + " does not belong to project "
                            + projectId + " / architecture " + currentArchitectureId);
                }
                runs.add(run);
            }
            return runs;
        }
        List<DiscoveryRunEntity> all = discoveryRunRepository
            .findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(projectId, currentArchitectureId);
        return all.stream()
            .filter(r -> isCompleted(r.getStatus()))
            .limit(DEFAULT_LATEST_RUN_LIMIT)
            .toList();
    }

    private static boolean isCompleted(String status) {
        return status != null && (
            status.equalsIgnoreCase("COMPLETED")
                || status.equalsIgnoreCase("completed"));
    }

    // -----------------------------------------------------------------------
    // Findings loading + prioritisation
    // -----------------------------------------------------------------------

    private List<DiscoveryFindingEntity> loadFindingsForRuns(
            List<UUID> runIds, UUID projectId, UUID architectureId) {
        if (runIds.isEmpty()) {
            return Collections.emptyList();
        }
        // Reject-suppression (Spec 2, Task Group 2): exclude `rejected` findings
        // at the LOAD. Because this `allFindings` list feeds BOTH the
        // highPriorityFindings LLM payload (prioritiseAndCap -> toFindingHighlight)
        // AND the buildFindingsSummary counts, filtering here drops rejected IR
        // from the payload AND the counts in one move. `deferred` stays visible
        // (only `rejected` is the bright line). Keyed on the LIVE review_status
        // column -- no schema change, no IR mutation.
        List<DiscoveryFindingEntity> all = new ArrayList<>();
        for (UUID runId : runIds) {
            all.addAll(discoveryFindingRepository
                .findByRunIdAndProjectIdAndArchitectureIdAndReviewStatusNot(
                    runId, projectId, architectureId, REJECTED_REVIEW_STATUS));
        }
        return all;
    }

    /**
     * Priority sort (descending) + truncate to {@code maxFindings}. Order:
     * <ol>
     *   <li>severity == critical/high first</li>
     *   <li>review_status == pending_review before others</li>
     *   <li>status == accepted before remaining unreviewed</li>
     *   <li>category bucket ({@link #CATEGORY_PRIORITY})</li>
     *   <li>createdAt descending</li>
     * </ol>
     */
    static List<DiscoveryFindingEntity> prioritiseAndCap(
            List<DiscoveryFindingEntity> findings, int maxFindings) {
        if (findings == null || findings.isEmpty()) {
            return Collections.emptyList();
        }
        Comparator<DiscoveryFindingEntity> cmp = Comparator
            .comparingInt(MigrationDiscoveryContextService::severityRank)
            .thenComparingInt(MigrationDiscoveryContextService::statusRank)
            .thenComparingInt(MigrationDiscoveryContextService::categoryRank)
            .thenComparing(
                DiscoveryFindingEntity::getCreatedAt,
                Comparator.nullsLast(Comparator.reverseOrder()));

        List<DiscoveryFindingEntity> sorted = new ArrayList<>(findings);
        sorted.sort(cmp);
        if (maxFindings > 0 && sorted.size() > maxFindings) {
            return new ArrayList<>(sorted.subList(0, maxFindings));
        }
        return sorted;
    }

    private static int severityRank(DiscoveryFindingEntity f) {
        if (f == null || f.getSeverity() == null) {
            return 99;
        }
        switch (f.getSeverity().toLowerCase()) {
            case "critical": return 0;
            case "high":     return 1;
            case "medium":   return 5;
            case "low":      return 8;
            default:         return 9;
        }
    }

    private static int statusRank(DiscoveryFindingEntity f) {
        if (f == null || f.getReviewStatus() == null) {
            return 9;
        }
        switch (f.getReviewStatus().toLowerCase()) {
            case "pending_review": return 0;
            case "deferred":       return 2;
            case "approved":       return 5;
            case "rejected":       return 6;
            default:               return 9;
        }
    }

    private static int categoryRank(DiscoveryFindingEntity f) {
        if (f == null || f.getCategory() == null) {
            return CATEGORY_PRIORITY.size();
        }
        int idx = CATEGORY_PRIORITY.indexOf(f.getCategory().toLowerCase());
        return idx < 0 ? CATEGORY_PRIORITY.size() : idx;
    }

    private MigrationDiscoveryContextDto.FindingHighlight toFindingHighlight(
            DiscoveryFindingEntity f) {
        return new MigrationDiscoveryContextDto.FindingHighlight(
            f.getId(),
            f.getRunId(),
            f.getFindingType(),
            f.getCategory(),
            f.getSeverity(),
            f.getReviewStatus(),
            f.getTitle(),
            f.getSummary(),
            f.getSource(),
            f.getConfidence()
        );
    }

    // -----------------------------------------------------------------------
    // Evidence highlights
    // -----------------------------------------------------------------------

    private List<DiscoveryFindingLinkEntity> loadEvidenceLinksForFindings(
            List<DiscoveryFindingEntity> findings) {
        if (findings.isEmpty()) {
            return Collections.emptyList();
        }
        List<DiscoveryFindingLinkEntity> links = new ArrayList<>();
        for (DiscoveryFindingEntity f : findings) {
            List<DiscoveryFindingLinkEntity> rowLinks =
                discoveryFindingLinkRepository.findByFindingId(f.getId());
            for (DiscoveryFindingLinkEntity link : rowLinks) {
                if ("discovery_evidence".equals(link.getTargetType())) {
                    links.add(link);
                }
            }
        }
        return links;
    }

    private List<MigrationDiscoveryContextDto.EvidenceHighlight> buildEvidenceHighlights(
            List<DiscoveryFindingLinkEntity> links, int maxItems) {
        if (links.isEmpty()) {
            return Collections.emptyList();
        }
        // Group by evidence UUID -> list of finding IDs.
        Map<UUID, List<UUID>> evidenceToFindings = new LinkedHashMap<>();
        for (DiscoveryFindingLinkEntity link : links) {
            UUID evidenceId;
            try {
                evidenceId = UUID.fromString(link.getTargetId());
            } catch (IllegalArgumentException ex) {
                continue;
            }
            evidenceToFindings
                .computeIfAbsent(evidenceId, k -> new ArrayList<>())
                .add(link.getFindingId());
        }

        List<UUID> ids = new ArrayList<>(evidenceToFindings.keySet());
        if (maxItems > 0 && ids.size() > maxItems) {
            ids = ids.subList(0, maxItems);
        }

        List<MigrationDiscoveryContextDto.EvidenceHighlight> out = new ArrayList<>(ids.size());
        for (UUID evidenceId : ids) {
            Optional<DiscoveryEvidenceEntity> evidenceOpt =
                discoveryEvidenceRepository.findById(evidenceId);
            if (evidenceOpt.isEmpty()) {
                continue;
            }
            DiscoveryEvidenceEntity e = evidenceOpt.get();
            out.add(new MigrationDiscoveryContextDto.EvidenceHighlight(
                e.getId(),
                e.getRunId(),
                e.getType(),
                e.getSource(),
                e.getFilePath(),
                evidenceToFindings.get(evidenceId)
            ));
        }
        return out;
    }

    // -----------------------------------------------------------------------
    // Decision tasks
    // -----------------------------------------------------------------------

    private List<DiscoveryDecisionTaskEntity> loadUnresolvedDecisionTasks(List<UUID> runIds) {
        if (runIds.isEmpty()) {
            return Collections.emptyList();
        }
        List<DiscoveryDecisionTaskEntity> tasks = new ArrayList<>();
        for (UUID runId : runIds) {
            for (DiscoveryDecisionTaskEntity task :
                    discoveryDecisionTaskRepository.findByRunId(runId)) {
                if (task.getStatus() != null
                        && UNRESOLVED_DECISION_TASK_STATUSES.contains(task.getStatus().toLowerCase())) {
                    tasks.add(task);
                }
            }
        }
        return tasks;
    }

    private MigrationDiscoveryContextDto.DecisionTaskHighlight toDecisionTaskHighlight(
            DiscoveryDecisionTaskEntity task) {
        return new MigrationDiscoveryContextDto.DecisionTaskHighlight(
            task.getId(),
            task.getRunId(),
            task.getTaskType(),
            task.getStatus(),
            task.getCreatedAt()
        );
    }

    // -----------------------------------------------------------------------
    // Architecture summary
    // -----------------------------------------------------------------------

    private MigrationDiscoveryContextDto.ArchitectureSummary buildArchitectureSummary(
            UUID projectId, ArchitectureEntity arch) {
        if (metaModelSummaryService == null) {
            return new MigrationDiscoveryContextDto.ArchitectureSummary(
                arch.getId(), arch.getName(),
                0, 0, 0, 0, 0, 0, 0, 0, 0, false);
        }
        try {
            MetaModelSummaryDto summary =
                metaModelSummaryService.getMetaModelSummary(projectId, arch.getId());
            return new MigrationDiscoveryContextDto.ArchitectureSummary(
                arch.getId(),
                arch.getName(),
                summary.applications().size(),
                summary.services().size(),
                summary.interfaces().size(),
                summary.dataEntities().size(),
                summary.dataStoreCount(),
                summary.businessUsers().size(),
                summary.processActivities().size(),
                summary.uiScreens().size(),
                summary.userJourneys().size(),
                true
            );
        } catch (ResourceNotFoundException ex) {
            // No model file yet -- counts default to 0, hasModel = false.
            return new MigrationDiscoveryContextDto.ArchitectureSummary(
                arch.getId(), arch.getName(),
                0, 0, 0, 0, 0, 0, 0, 0, 0, false);
        }
    }

    // -----------------------------------------------------------------------
    // Discovery runs summary
    // -----------------------------------------------------------------------

    private MigrationDiscoveryContextDto.DiscoveryRunsSummary buildRunsSummary(
            List<DiscoveryRunEntity> runs) {
        int completed = (int) runs.stream().filter(r -> isCompleted(r.getStatus())).count();
        List<MigrationDiscoveryContextDto.DiscoveryRunHighlight> highlights = runs.stream()
            .map(r -> new MigrationDiscoveryContextDto.DiscoveryRunHighlight(
                r.getId(),
                r.getArchitectureId(),
                r.getStatus(),
                r.getDiscoveryKind(),
                r.getCreatedAt(),
                r.getUpdatedAt()))
            .toList();
        return new MigrationDiscoveryContextDto.DiscoveryRunsSummary(
            runs.size(), completed, highlights);
    }

    // -----------------------------------------------------------------------
    // Findings summary
    // -----------------------------------------------------------------------

    private MigrationDiscoveryContextDto.FindingsSummary buildFindingsSummary(
            List<DiscoveryFindingEntity> findings) {
        Map<String, Integer> byStatus = new LinkedHashMap<>();
        Map<String, Integer> bySeverity = new LinkedHashMap<>();
        Map<String, Integer> byCategory = new LinkedHashMap<>();
        int highSeverityUnreviewed = 0;
        int sampleDataHints = 0;
        for (DiscoveryFindingEntity f : findings) {
            increment(byStatus, normalise(f.getReviewStatus()));
            increment(bySeverity, normalise(f.getSeverity()));
            increment(byCategory, normalise(f.getCategory()));
            if (isHighSeverity(f) && isUnreviewed(f)) {
                highSeverityUnreviewed++;
            }
            if ("sample_data".equalsIgnoreCase(f.getCategory())) {
                sampleDataHints++;
            }
        }
        return new MigrationDiscoveryContextDto.FindingsSummary(
            findings.size(), byStatus, bySeverity, byCategory,
            highSeverityUnreviewed, sampleDataHints);
    }

    private static boolean isHighSeverity(DiscoveryFindingEntity f) {
        return f.getSeverity() != null
            && HIGH_SEVERITY.contains(f.getSeverity().toLowerCase());
    }

    private static boolean isUnreviewed(DiscoveryFindingEntity f) {
        return f.getReviewStatus() != null
            && UNREVIEWED_STATUSES.contains(f.getReviewStatus().toLowerCase());
    }

    // -----------------------------------------------------------------------
    // Candidates summary
    // -----------------------------------------------------------------------

    private MigrationDiscoveryContextDto.CandidateSummary buildCandidateSummary(List<UUID> runIds) {
        Map<String, Integer> byType = new LinkedHashMap<>();
        Map<String, Integer> byStatus = new LinkedHashMap<>();
        int total = 0;
        for (UUID runId : runIds) {
            // Reject-suppression (Spec 2, Task Group 2): exclude candidates whose
            // review_status == 'rejected' from the candidate summary so a rejected
            // candidate never inflates the counts. NOTE: the tally below counts by
            // candidate STATUS (proposed/committed) -- a DISTINCT field from
            // review_status; the suppression filter keys on review_status at the
            // load and leaves the by-status tally semantics for the surviving
            // (non-rejected) rows unchanged. `deferred` candidates stay visible.
            for (DiscoveryCandidateEntity c :
                    discoveryCandidateRepository.findByRunIdAndReviewStatusNot(
                        runId, REJECTED_REVIEW_STATUS)) {
                total++;
                increment(byType, normalise(c.getCandidateType()));
                increment(byStatus, normalise(c.getStatus()));
            }
        }
        return new MigrationDiscoveryContextDto.CandidateSummary(total, byType, byStatus);
    }

    // -----------------------------------------------------------------------
    // Runtime usage summary
    // -----------------------------------------------------------------------

    private MigrationDiscoveryContextDto.RuntimeUsageSummary buildRuntimeUsageSummary(
            List<UUID> runIds, List<DiscoveryFindingEntity> findings) {
        int runtimeFindings = (int) findings.stream()
            .filter(f -> f.getCategory() != null
                && RUNTIME_FINDING_CATEGORIES.contains(f.getCategory().toLowerCase()))
            .count();
        int runtimeEvidence = 0;
        for (UUID runId : runIds) {
            for (DiscoveryEvidenceEntity e : discoveryEvidenceRepository.findByRunId(runId)) {
                if ("log".equalsIgnoreCase(e.getSource())) {
                    runtimeEvidence++;
                }
            }
        }
        return new MigrationDiscoveryContextDto.RuntimeUsageSummary(
            runtimeEvidence, runtimeFindings,
            runtimeEvidence > 0 || runtimeFindings > 0);
    }

    // -----------------------------------------------------------------------
    // Database discovery summary
    // -----------------------------------------------------------------------

    private MigrationDiscoveryContextDto.DatabaseDiscoverySummary buildDatabaseDiscoverySummary(
            List<DiscoveryRunEntity> runs, List<DiscoveryFindingEntity> findings) {
        int dbFindings = (int) findings.stream()
            .filter(f -> f.getSource() != null && f.getSource().startsWith(DB_SOURCE_PREFIX))
            .count();
        int dbRuns = (int) runs.stream()
            .filter(r -> "database".equalsIgnoreCase(r.getDiscoveryKind())
                || "combined".equalsIgnoreCase(r.getDiscoveryKind()))
            .count();
        int sampleHints = (int) findings.stream()
            .filter(f -> "sample_data".equalsIgnoreCase(f.getCategory()))
            .count();
        return new MigrationDiscoveryContextDto.DatabaseDiscoverySummary(
            dbFindings, dbRuns, sampleHints,
            dbFindings > 0 || dbRuns > 0 || sampleHints > 0);
    }

    // -----------------------------------------------------------------------
    // API Behaviour Baseline summary
    // -----------------------------------------------------------------------

    private MigrationDiscoveryContextDto.ApiBehaviourBaselineSummary buildBaselineSummary(
            UUID projectId, UUID currentArchitectureId, List<UUID> explicitIds) {
        // Load all baselines for the (project, current-architecture) tuple. The
        // count-by-status totals always span this unfiltered set.
        List<ApiBehaviourBaselineEntity> all = apiBehaviourBaselineRepository
            .findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(projectId, currentArchitectureId);

        // Build the highlight list. When the caller supplied explicit IDs we
        // narrow to that subset (preserving requested-but-on-another-architecture
        // baselines that still belong to this project as a defence-in-depth).
        List<ApiBehaviourBaselineEntity> highlights = new ArrayList<>();
        if (explicitIds != null && !explicitIds.isEmpty()) {
            Set<UUID> wanted = new HashSet<>(explicitIds);
            for (ApiBehaviourBaselineEntity b : all) {
                if (wanted.contains(b.getId())) {
                    highlights.add(b);
                }
            }
            Set<UUID> seen = highlights.stream()
                .map(ApiBehaviourBaselineEntity::getId)
                .collect(java.util.stream.Collectors.toCollection(HashSet::new));
            for (UUID id : explicitIds) {
                if (!seen.contains(id)) {
                    apiBehaviourBaselineRepository.findById(id).ifPresent(b -> {
                        if (projectId.equals(b.getProjectId())) {
                            highlights.add(b);
                        }
                    });
                }
            }
        } else {
            highlights.addAll(all);
        }
        int active = (int) all.stream()
            .filter(b -> "active".equalsIgnoreCase(b.getStatus()))
            .count();
        int draft = (int) all.stream()
            .filter(b -> "draft".equalsIgnoreCase(b.getStatus()))
            .count();
        List<MigrationDiscoveryContextDto.BaselineHighlight> baselineList = highlights.stream()
            .map(this::toBaselineHighlight)
            .toList();
        return new MigrationDiscoveryContextDto.ApiBehaviourBaselineSummary(
            all.size(), active, draft, baselineList);
    }

    private MigrationDiscoveryContextDto.BaselineHighlight toBaselineHighlight(
            ApiBehaviourBaselineEntity b) {
        return new MigrationDiscoveryContextDto.BaselineHighlight(
            b.getId(),
            b.getArchitectureId(),
            b.getSessionId(),
            b.getName(),
            b.getStatus(),
            b.getOperationCount(),
            b.getAcceptedCaptureCount(),
            b.getCreatedAt()
        );
    }

    // -----------------------------------------------------------------------
    // Architecture mappings summary
    // -----------------------------------------------------------------------

    private MigrationDiscoveryContextDto.ArchitectureMappingsSummary buildMappingsSummary(
            UUID projectId, UUID currentArchitectureId, UUID targetArchitectureId) {
        List<ArchitectureElementMappingEntity> mappings = architectureElementMappingRepository
            .findByProjectIdAndSourceArchitectureIdAndTargetArchitectureId(
                projectId, currentArchitectureId, targetArchitectureId);

        Map<String, Integer> bySource = new LinkedHashMap<>();
        Map<String, Integer> byTarget = new LinkedHashMap<>();
        Map<String, Integer> byMapping = new LinkedHashMap<>();
        for (ArchitectureElementMappingEntity m : mappings) {
            increment(bySource, normalise(m.getSourceElementType()));
            increment(byTarget, normalise(m.getTargetElementType()));
            increment(byMapping, normalise(m.getMappingType()));
        }
        return new MigrationDiscoveryContextDto.ArchitectureMappingsSummary(
            mappings.size(), bySource, byTarget, byMapping);
    }

    private MigrationDiscoveryContextDto.ArchitectureMappingsSummary emptyMappingsSummary() {
        return new MigrationDiscoveryContextDto.ArchitectureMappingsSummary(
            0, new LinkedHashMap<>(), new LinkedHashMap<>(), new LinkedHashMap<>());
    }

    // -----------------------------------------------------------------------
    // Coverage gates (Spec: Capture Coverage Gates, 2026-05-30) -- computed-on-read
    // -----------------------------------------------------------------------

    /**
     * Orchestrate the three computed-on-read coverage dimensions. Every read is
     * deferred to an existing repository finder; absence of any collaborator
     * (the standalone unit-test path passes {@code null}) yields the empty
     * aggregate for that dimension. No schema change, no new persistence.
     *
     * <ul>
     *   <li>(A) CAPTURE: join the harness {@code api_behaviour_operations}
     *       ({@code included = true}) for each baseline session against the
     *       {@code api_behaviour_captures} rows; a current-only baseline never
     *       replayed has NO diffed coverage by nature (informational only).</li>
     *   <li>(B) SPECIFICATION: per-protocol bar over the model-file endpoints
     *       (resolved via {@link ModelFileRepository}).</li>
     *   <li>(C) RECONCILIATION: model endpoint inventory vs the union of harness
     *       operations across the baseline sessions, protocol-aware key.</li>
     * </ul>
     */
    private CoverageAggregates computeCoverageAggregates(
            UUID projectId,
            UUID currentArchitectureId,
            MigrationDiscoveryContextDto.ApiBehaviourBaselineSummary baselineSummary) {

        // --- Resolve the harness operation/capture sets per baseline session (A + C). ---
        List<MigrationDiscoveryContextDto.BaselineHighlight> baselines =
            baselineSummary == null || baselineSummary.baselines() == null
                ? List.of() : baselineSummary.baselines();

        // (A) CAPTURE -- aggregate across all selected baselines. Each baseline
        // is scoped by its own session id; the per-baseline included/captured
        // counts roll up into one architecture-level capture coverage.
        CaptureCoverage capture = computeCaptureCoverageForBaselines(baselines);

        // Resolve the model file ONCE (B + C). Mirror MetaModelSummaryService's
        // (projectId, architectureId)-scoped lookup; absent -> dimensions B + C
        // are skipped (empty).
        String modelFileId = resolveModelFileId(projectId, currentArchitectureId);
        List<EndpointEntity> endpoints = (modelFileId == null || endpointRepository == null)
            ? List.of()
            : endpointRepository.findByModelFileId(modelFileId);

        // (B) SPECIFICATION -- per-protocol "fully specified" bar over the model
        // endpoints.
        SpecificationCoverage specification = endpoints.isEmpty()
            ? SpecificationCoverage.empty()
            : computeSpecificationCoverageFromModel(endpoints);

        // (C) RECONCILIATION -- compare the model endpoint inventory against the
        // union of harness operations across the baseline sessions. Needs BOTH
        // an endpoint set and a harness operation set to be meaningful.
        List<ApiBehaviourOperationEntity> harnessOps =
            loadHarnessOperationsForBaselines(baselines);
        InventoryReconciliation reconciliation =
            (endpoints.isEmpty() && harnessOps.isEmpty())
                ? InventoryReconciliation.empty()
                : computeInventoryReconciliation(endpoints, harnessOps);

        return new CoverageAggregates(capture, specification, reconciliation);
    }

    /** Resolve the architecture's model_file_id the way MetaModelSummaryService does. */
    private String resolveModelFileId(UUID projectId, UUID currentArchitectureId) {
        if (modelFileRepository == null) {
            return null;
        }
        return modelFileRepository
            .findByProjectIdAndArchitectureId(projectId, currentArchitectureId)
            .map(ModelFileEntity::getId)
            .orElse(null);
    }

    /**
     * (A) Roll capture coverage up across every selected baseline. Each baseline
     * contributes its session's {@code included = true} operations (denominator)
     * and the captured subset; a diffed signal is collected purely as
     * informational completeness (never a coverage error).
     */
    private CaptureCoverage computeCaptureCoverageForBaselines(
            List<MigrationDiscoveryContextDto.BaselineHighlight> baselines) {
        if (baselines.isEmpty()
                || apiBehaviourOperationRepository == null
                || apiBehaviourCaptureRepository == null) {
            return CaptureCoverage.empty();
        }
        int includedTotal = 0;
        int capturedTotal = 0;
        List<String> missing = new ArrayList<>();
        boolean anyDiffed = false;
        for (MigrationDiscoveryContextDto.BaselineHighlight b : baselines) {
            UUID sessionId = b.sessionId();
            if (sessionId == null) {
                continue;
            }
            List<ApiBehaviourOperationEntity> ops =
                apiBehaviourOperationRepository.findBySessionIdOrderByCreatedAtAsc(sessionId);
            List<ApiBehaviourCaptureEntity> captures =
                apiBehaviourCaptureRepository.findBySessionIdOrderByCapturedAtAsc(sessionId);
            boolean baselineDiffed = baselineHasDiff(b.baselineId());
            CaptureCoverage perBaseline = computeCaptureCoverage(ops, captures, baselineDiffed);
            includedTotal += perBaseline.includedCount();
            capturedTotal += perBaseline.capturedCount();
            missing.addAll(perBaseline.missingOperationKeys());
            anyDiffed = anyDiffed || perBaseline.anyDiffed();
        }
        return new CaptureCoverage(includedTotal, capturedTotal, missing, anyDiffed);
    }

    /**
     * Resolve whether the baseline (as the diff SOURCE) has at least one diff
     * with at least one diff item. Used purely to populate the informational
     * {@code anyDiffed} flag -- an absent diff is the unexecuted-coverage signal
     * for a current-only baseline, NOT an error.
     */
    private boolean baselineHasDiff(UUID baselineId) {
        if (baselineId == null || apiBehaviourDiffRepository == null) {
            return false;
        }
        List<ApiBehaviourDiffEntity> diffs =
            apiBehaviourDiffRepository.findBySourceBaselineId(baselineId);
        if (diffs == null || diffs.isEmpty()) {
            return false;
        }
        if (apiBehaviourDiffItemRepository == null) {
            // Diff header present but we cannot confirm items -- treat as diffed
            // (the header only exists once a diff run started).
            return true;
        }
        for (ApiBehaviourDiffEntity diff : diffs) {
            if (!apiBehaviourDiffItemRepository
                    .findByDiffIdOrderByMethodAscPathAsc(diff.getId()).isEmpty()) {
                return true;
            }
        }
        return false;
    }

    /** Load the union of harness operations across every baseline's session. */
    private List<ApiBehaviourOperationEntity> loadHarnessOperationsForBaselines(
            List<MigrationDiscoveryContextDto.BaselineHighlight> baselines) {
        if (baselines.isEmpty() || apiBehaviourOperationRepository == null) {
            return List.of();
        }
        Set<UUID> seenSessions = new HashSet<>();
        List<ApiBehaviourOperationEntity> ops = new ArrayList<>();
        for (MigrationDiscoveryContextDto.BaselineHighlight b : baselines) {
            UUID sessionId = b.sessionId();
            if (sessionId == null || !seenSessions.add(sessionId)) {
                continue;
            }
            ops.addAll(apiBehaviourOperationRepository
                .findBySessionIdOrderByCreatedAtAsc(sessionId));
        }
        return ops;
    }

    /**
     * (B) Resolve the per-protocol "fully specified" inputs from the persisted
     * model and delegate to {@link #computeSpecificationCoverage}. REST reads
     * {@code endpoint_data_effects} by endpoint id; SOAP reads the parent
     * interface's bound message entities ({@code interface_logical_entities}).
     */
    private SpecificationCoverage computeSpecificationCoverageFromModel(
            List<EndpointEntity> endpoints) {
        Map<String, List<EndpointDataEffectEntity>> effectsByEndpoint = new LinkedHashMap<>();
        Map<String, List<InterfaceLogicalEntityEntity>> bindingsByInterface = new LinkedHashMap<>();
        for (EndpointEntity ep : endpoints) {
            if (isSoapEndpoint(ep)) {
                String interfaceId = ep.getInterfaceId();
                if (interfaceId != null && !bindingsByInterface.containsKey(interfaceId)
                        && interfaceLogicalEntityRepository != null) {
                    bindingsByInterface.put(interfaceId,
                        interfaceLogicalEntityRepository.findByInterfaceId(interfaceId));
                }
            } else {
                if (endpointDataEffectRepository != null) {
                    effectsByEndpoint.put(ep.getId(),
                        endpointDataEffectRepository.findByEndpointId(ep.getId()));
                }
            }
        }
        return computeSpecificationCoverage(endpoints, effectsByEndpoint, bindingsByInterface);
    }

    // -----------------------------------------------------------------------
    // Coverage computation helpers (PURE -- package-private + static for tests).
    // Each takes already-loaded entity lists so it can be unit-tested with no
    // Spring / Mockito wiring.
    // -----------------------------------------------------------------------

    /**
     * (A) CAPTURE coverage for ONE baseline session.
     *
     * @param sessionOperations the session's {@code api_behaviour_operations}
     *        (the denominator is the {@code included = true} subset)
     * @param sessionCaptures   the session's {@code api_behaviour_captures}
     *        (an operation is "captured" iff a capture row references it)
     * @param anyDiffed         whether the baseline (as diff SOURCE) produced a
     *        diff -- informational only; a current-only baseline never replayed
     *        is {@code false} BY NATURE and that is NOT an error
     */
    static CaptureCoverage computeCaptureCoverage(
            List<ApiBehaviourOperationEntity> sessionOperations,
            List<ApiBehaviourCaptureEntity> sessionCaptures,
            boolean anyDiffed) {
        List<ApiBehaviourOperationEntity> included = new ArrayList<>();
        if (sessionOperations != null) {
            for (ApiBehaviourOperationEntity op : sessionOperations) {
                if (Boolean.TRUE.equals(op.getIncluded())) {
                    included.add(op);
                }
            }
        }
        Set<UUID> capturedOperationIds = new HashSet<>();
        if (sessionCaptures != null) {
            for (ApiBehaviourCaptureEntity cap : sessionCaptures) {
                if (cap.getOperationId() != null) {
                    capturedOperationIds.add(cap.getOperationId());
                }
            }
        }
        int capturedCount = 0;
        List<String> missing = new ArrayList<>();
        for (ApiBehaviourOperationEntity op : included) {
            if (capturedOperationIds.contains(op.getId())) {
                capturedCount++;
            } else {
                missing.add(operationKey(op));
            }
        }
        return new CaptureCoverage(included.size(), capturedCount, missing, anyDiffed);
    }

    /**
     * (B) SPECIFICATION coverage over a discovered endpoint set, per protocol.
     * REST endpoint is "fully specified" iff it has a resolved
     * {@code endpoint_data_effects} edge; a SOAP operation is "fully specified"
     * iff its parent interface has bound message entities. Captured behaviour is
     * a BONUS only and is intentionally NOT consulted here.
     */
    static SpecificationCoverage computeSpecificationCoverage(
            List<EndpointEntity> endpoints,
            Map<String, List<EndpointDataEffectEntity>> effectsByEndpoint,
            Map<String, List<InterfaceLogicalEntityEntity>> bindingsByInterface) {
        if (endpoints == null || endpoints.isEmpty()) {
            return SpecificationCoverage.empty();
        }
        int fullySpecified = 0;
        List<String> underSpecified = new ArrayList<>();
        for (EndpointEntity ep : endpoints) {
            boolean specified;
            if (isSoapEndpoint(ep)) {
                List<InterfaceLogicalEntityEntity> bindings =
                    bindingsByInterface == null ? null : bindingsByInterface.get(ep.getInterfaceId());
                specified = bindings != null && !bindings.isEmpty();
            } else {
                List<EndpointDataEffectEntity> effects =
                    effectsByEndpoint == null ? null : effectsByEndpoint.get(ep.getId());
                specified = effects != null && !effects.isEmpty();
            }
            if (specified) {
                fullySpecified++;
            } else {
                underSpecified.add(ep.getId());
            }
        }
        return new SpecificationCoverage(endpoints.size(), fullySpecified, underSpecified);
    }

    /**
     * (C) INVENTORY reconciliation across both directions, with a protocol-aware
     * reconciliation key:
     * <ul>
     *   <li>SOAP endpoint -&gt; {@code soap::<soap_action|request_root_element>}
     *       (every SOAP op emits {@code {POST, servletPath|null}} so
     *       {@code {method, path}} would collapse N ops to one).</li>
     *   <li>REST endpoint / harness operation -&gt; {@code <METHOD> <path>}.</li>
     * </ul>
     * Harness operations carry no SOAP-action concept, so they always key on
     * {@code {method, path}}; a SOAP op discovered in the model therefore shows
     * up as discovered-but-not-captured (and vice versa).
     */
    static InventoryReconciliation computeInventoryReconciliation(
            List<EndpointEntity> endpoints,
            List<ApiBehaviourOperationEntity> harnessOperations) {
        // Delegate to the shared calculator (Spec: Model-Seeded Capture
        // Inventory, 2026-06-11) and derive the existing two integers from
        // the detailed result. The distinct unmatched KEY-set sizes are
        // byte-identical to the pre-extraction counting (which counted
        // distinct keys, not rows) -- readiness gate C behaviour is FROZEN.
        InventoryReconciliationCalculator.Result result =
            InventoryReconciliationCalculator.reconcile(endpoints, harnessOperations);
        return new InventoryReconciliation(
            result.unmatchedEndpointKeys().size(),
            result.unmatchedOperationKeys().size());
    }

    /**
     * Reconciliation key for a harness operation: always {@code <METHOD> <path>}.
     * Moved to {@link InventoryReconciliationCalculator} (Spec: Model-Seeded
     * Capture Inventory, 2026-06-11); thin delegation keeps internal call
     * sites unchanged.
     */
    private static String operationKey(ApiBehaviourOperationEntity op) {
        return InventoryReconciliationCalculator.operationKey(op);
    }

    /**
     * Protocol-aware reconciliation key for a model endpoint. Moved to
     * {@link InventoryReconciliationCalculator}; see its Javadoc for the
     * SOAP/REST key semantics (unchanged).
     */
    private static String endpointKey(EndpointEntity ep) {
        return InventoryReconciliationCalculator.endpointKey(ep);
    }

    /** Detect SOAP via {@code protocol} / {@code endpoint_type} (case-insensitive). */
    private static boolean isSoapEndpoint(EndpointEntity ep) {
        return InventoryReconciliationCalculator.isSoapEndpoint(ep);
    }

    // -----------------------------------------------------------------------
    // Readiness assessment (Part 6)
    // -----------------------------------------------------------------------

    /** Read-only bundle of intermediate aggregates required for readiness scoring. */
    record ReadinessContext(
        MigrationDiscoveryContextDto.ArchitectureSummary currentArchSummary,
        MigrationDiscoveryContextDto.ArchitectureSummary targetArchSummary,
        List<DiscoveryRunEntity> runs,
        List<DiscoveryFindingEntity> findings,
        List<DiscoveryDecisionTaskEntity> unresolvedDecisionTasks,
        MigrationDiscoveryContextDto.ApiBehaviourBaselineSummary baselineSummary,
        MigrationDiscoveryContextDto.ArchitectureMappingsSummary mappingsSummary,
        MigrationDiscoveryContextDto.DatabaseDiscoverySummary databaseDiscoverySummary,
        MigrationDiscoveryContextDto.RuntimeUsageSummary runtimeUsageSummary,
        boolean targetArchitectureProvided,
        /**
         * Computed-on-read coverage aggregates (Spec: Capture Coverage Gates,
         * 2026-05-30). Never {@code null} -- the orchestrator supplies
         * {@link CoverageAggregates#empty()} when no coverage signal is
         * available.
         */
        CoverageAggregates coverage
    ) {}

    /** Deterministic per-stream readiness rules + gap-code emission. */
    static ReadinessAssessmentDto assessReadiness(ReadinessContext ctx) {
        List<String> gaps = new ArrayList<>();

        // ------ API readiness ------
        boolean hasInterfaces = ctx.currentArchSummary != null
            && ctx.currentArchSummary.interfaceCount() != null
            && ctx.currentArchSummary.interfaceCount() > 0;
        boolean hasBaseline = ctx.baselineSummary != null
            && ctx.baselineSummary.totalBaselines() != null
            && ctx.baselineSummary.totalBaselines() > 0;
        boolean hasActiveBaseline = ctx.baselineSummary != null
            && ctx.baselineSummary.activeBaselineCount() != null
            && ctx.baselineSummary.activeBaselineCount() > 0;
        String apiReadiness;
        if (hasInterfaces && hasActiveBaseline) {
            apiReadiness = MigrationGapCodes.STATUS_SUFFICIENT;
        } else if (hasInterfaces && !hasBaseline) {
            apiReadiness = MigrationGapCodes.STATUS_PARTIAL;
            gaps.add(MigrationGapCodes.NO_API_BEHAVIOUR_BASELINE);
        } else if (!hasInterfaces) {
            apiReadiness = MigrationGapCodes.STATUS_INSUFFICIENT;
            gaps.add(MigrationGapCodes.MISSING_OAS_FOR_IN_SCOPE_INTERFACE);
        } else {
            apiReadiness = MigrationGapCodes.STATUS_PARTIAL;
            gaps.add(MigrationGapCodes.NO_API_BEHAVIOUR_BASELINE);
        }

        // ------ Data readiness ------
        boolean hasDataEntities = ctx.currentArchSummary != null
            && ctx.currentArchSummary.dataEntityCount() != null
            && ctx.currentArchSummary.dataEntityCount() > 0;
        boolean hasDbFindings = ctx.databaseDiscoverySummary != null
            && ctx.databaseDiscoverySummary.hasDatabaseDiscovery() != null
            && ctx.databaseDiscoverySummary.hasDatabaseDiscovery();
        boolean hasSampleDataHints = ctx.databaseDiscoverySummary != null
            && ctx.databaseDiscoverySummary.sampleDataHintCount() != null
            && ctx.databaseDiscoverySummary.sampleDataHintCount() > 0;
        String dataReadiness;
        if (hasDataEntities && hasDbFindings) {
            dataReadiness = MigrationGapCodes.STATUS_SUFFICIENT;
        } else if (hasDataEntities) {
            dataReadiness = MigrationGapCodes.STATUS_PARTIAL;
            gaps.add(MigrationGapCodes.NO_DATABASE_DISCOVERY_FINDINGS);
        } else {
            dataReadiness = MigrationGapCodes.STATUS_INSUFFICIENT;
            gaps.add(MigrationGapCodes.NO_DATABASE_DISCOVERY_FINDINGS);
        }
        if (!hasSampleDataHints) {
            gaps.add(MigrationGapCodes.NO_SAMPLE_DATA_HINTS);
        }

        // ------ Infrastructure readiness (Part 6 lists no specific gaps; surface model presence) ------
        String infrastructureReadiness;
        if (ctx.currentArchSummary == null
                || ctx.currentArchSummary.hasModel() == null
                || !ctx.currentArchSummary.hasModel()) {
            infrastructureReadiness = MigrationGapCodes.STATUS_INSUFFICIENT;
        } else {
            infrastructureReadiness = MigrationGapCodes.STATUS_PARTIAL;
        }

        // ------ Discovery readiness ------
        boolean hasCompletedRun = ctx.runs != null && ctx.runs.stream()
            .anyMatch(r -> isCompleted(r.getStatus()));
        long highSeverityUnreviewed = ctx.findings == null ? 0 : ctx.findings.stream()
            .filter(MigrationDiscoveryContextService::isHighSeverity)
            .filter(MigrationDiscoveryContextService::isUnreviewed)
            .count();
        String discoveryReadiness;
        if (!hasCompletedRun) {
            discoveryReadiness = MigrationGapCodes.STATUS_INSUFFICIENT;
        } else if (highSeverityUnreviewed > 0) {
            discoveryReadiness = MigrationGapCodes.STATUS_PARTIAL;
            gaps.add(MigrationGapCodes.HIGH_SEVERITY_UNREVIEWED_FINDINGS);
        } else {
            discoveryReadiness = MigrationGapCodes.STATUS_SUFFICIENT;
        }

        // ------ Mapping readiness ------
        String mappingReadiness;
        if (!ctx.targetArchitectureProvided) {
            mappingReadiness = MigrationGapCodes.STATUS_INSUFFICIENT;
            gaps.add(MigrationGapCodes.MISSING_CURRENT_TO_TARGET_MAPPINGS);
        } else {
            int mappings = ctx.mappingsSummary != null
                && ctx.mappingsSummary.totalMappings() != null
                ? ctx.mappingsSummary.totalMappings() : 0;
            if (mappings == 0) {
                mappingReadiness = MigrationGapCodes.STATUS_INSUFFICIENT;
                gaps.add(MigrationGapCodes.MISSING_CURRENT_TO_TARGET_MAPPINGS);
            } else if (mappings < 5) {
                mappingReadiness = MigrationGapCodes.STATUS_PARTIAL;
            } else {
                mappingReadiness = MigrationGapCodes.STATUS_SUFFICIENT;
            }
        }

        // ------ Baseline readiness ------
        String baselineReadiness;
        if (hasActiveBaseline) {
            baselineReadiness = MigrationGapCodes.STATUS_SUFFICIENT;
        } else if (hasBaseline) {
            baselineReadiness = MigrationGapCodes.STATUS_PARTIAL;
        } else {
            baselineReadiness = MigrationGapCodes.STATUS_INSUFFICIENT;
            // no_api_behaviour_baseline was already emitted above where applicable.
        }

        // ------ Decision readiness ------
        int unresolvedTaskCount = ctx.unresolvedDecisionTasks == null
            ? 0 : ctx.unresolvedDecisionTasks.size();
        String decisionReadiness;
        if (unresolvedTaskCount == 0) {
            decisionReadiness = MigrationGapCodes.STATUS_SUFFICIENT;
        } else if (unresolvedTaskCount <= 3) {
            decisionReadiness = MigrationGapCodes.STATUS_PARTIAL;
            gaps.add(MigrationGapCodes.UNRESOLVED_DISCOVERY_DECISIONS);
        } else {
            decisionReadiness = MigrationGapCodes.STATUS_INSUFFICIENT;
            gaps.add(MigrationGapCodes.UNRESOLVED_DISCOVERY_DECISIONS);
        }

        // ------ Runtime evidence gap (advisory) ------
        boolean hasRuntimeEvidence = ctx.runtimeUsageSummary != null
            && ctx.runtimeUsageSummary.hasRuntimeEvidence() != null
            && ctx.runtimeUsageSummary.hasRuntimeEvidence();
        if (!hasRuntimeEvidence) {
            gaps.add(MigrationGapCodes.INSUFFICIENT_RUNTIME_EVIDENCE);
        }

        // ------------------------------------------------------------------
        // Coverage gates (Spec: Capture Coverage Gates, 2026-05-30).
        //
        // ADVISORY ONLY: each dimension downgrades the relevant stream from
        // `sufficient` to `partial` (never below, never blocking) and emits a
        // distinct gap code. A current-only baseline never replayed against a
        // target has NO diffed coverage by nature -- that absence is NOT folded
        // as an error (the (A) code is driven by capture, not diff).
        // ------------------------------------------------------------------
        CoverageAggregates coverage = ctx.coverage == null
            ? CoverageAggregates.empty() : ctx.coverage;

        // (A) CAPTURE coverage -> baselineReadiness / apiReadiness.
        if (coverage.capture() != null && coverage.capture().isIncomplete()) {
            gaps.add(MigrationGapCodes.INCOMPLETE_CAPTURE_COVERAGE);
            baselineReadiness = downgradeToPartial(baselineReadiness);
            apiReadiness = downgradeToPartial(apiReadiness);
        }

        // (C) INVENTORY reconciliation -> apiReadiness / baselineReadiness.
        if (coverage.reconciliation() != null && !coverage.reconciliation().isReconciled()) {
            gaps.add(MigrationGapCodes.DISCOVERY_HARNESS_INVENTORY_MISMATCH);
            apiReadiness = downgradeToPartial(apiReadiness);
            baselineReadiness = downgradeToPartial(baselineReadiness);
        }

        // (B) SPECIFICATION coverage -> discoveryReadiness.
        if (coverage.specification() != null && coverage.specification().isIncomplete()) {
            gaps.add(MigrationGapCodes.UNDER_SPECIFIED_ENDPOINTS);
            discoveryReadiness = downgradeToPartial(discoveryReadiness);
        }

        // ------ Overall rollup ------
        // Sufficient ONLY when all core streams (api, discovery, baseline)
        // are sufficient AND mapping/decision aren't insufficient.
        List<String> coreStatuses = List.of(
            apiReadiness, discoveryReadiness, baselineReadiness);
        boolean anyInsufficient = coreStatuses.contains(MigrationGapCodes.STATUS_INSUFFICIENT)
            || mappingReadiness.equals(MigrationGapCodes.STATUS_INSUFFICIENT)
            || decisionReadiness.equals(MigrationGapCodes.STATUS_INSUFFICIENT)
            || dataReadiness.equals(MigrationGapCodes.STATUS_INSUFFICIENT);
        boolean allCoreSufficient = coreStatuses.stream()
            .allMatch(MigrationGapCodes.STATUS_SUFFICIENT::equals);
        String overall;
        if (anyInsufficient) {
            overall = MigrationGapCodes.STATUS_INSUFFICIENT;
        } else if (allCoreSufficient
                && MigrationGapCodes.STATUS_SUFFICIENT.equals(mappingReadiness)
                && MigrationGapCodes.STATUS_SUFFICIENT.equals(decisionReadiness)) {
            overall = MigrationGapCodes.STATUS_SUFFICIENT;
        } else {
            overall = MigrationGapCodes.STATUS_PARTIAL;
        }

        // Dedupe gaps while preserving order.
        List<String> dedupedGaps = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (String g : gaps) {
            if (seen.add(g)) {
                dedupedGaps.add(g);
            }
        }

        return new ReadinessAssessmentDto(
            overall, apiReadiness, dataReadiness, infrastructureReadiness,
            discoveryReadiness, mappingReadiness, baselineReadiness, decisionReadiness,
            dedupedGaps);
    }

    // -----------------------------------------------------------------------
    // Haikai trace -- readiness verdict (SUMMARY) + inputs (detail)
    // -----------------------------------------------------------------------

    /**
     * Emit the Haikai trace for a readiness assessment. No-op unless
     * {@code HAIKAI_TRACE} is set -- the project-name lookup and all string /
     * JSON building are skipped entirely when tracing is OFF, so production is
     * unaffected. NEVER throws (any failure is swallowed).
     *
     * <p>SUMMARY: one glyph-led line per verdict ({@code fail} = insufficient,
     * {@code warn} = partial, {@code ok} = sufficient) carrying the total
     * baseline count and the resolved gap codes. DETAIL ({@code readiness.assessed}):
     * everything needed to diagnose an INSUFFICIENT verdict from the file alone
     * -- the per-axis readiness, the inputs that drove them, and the full gap
     * list with a human reason per code.</p>
     */
    private void traceReadiness(
            UUID projectId,
            ArchitectureEntity currentArchitecture,
            ReadinessContext ctx,
            ReadinessAssessmentDto readiness) {
        if (!TRACE.isEnabled() || readiness == null) {
            return;
        }
        try {
            String projectName = resolveProjectName(projectId);
            String archName = currentArchitecture == null ? null : currentArchitecture.getName();
            HaikaiTrace.Corr corr = HaikaiTrace.Corr.of()
                .project(projectName)
                .arch(archName);

            String verdict = readiness.overallStatus() == null
                ? "unknown" : readiness.overallStatus();
            int totalBaselines = ctx.baselineSummary() != null
                && ctx.baselineSummary().totalBaselines() != null
                ? ctx.baselineSummary().totalBaselines() : 0;
            int activeBaselineCount = ctx.baselineSummary() != null
                && ctx.baselineSummary().activeBaselineCount() != null
                ? ctx.baselineSummary().activeBaselineCount() : 0;
            List<String> gaps = readiness.gaps() == null
                ? List.of() : readiness.gaps();
            String gapCodesJoined = gaps.isEmpty() ? "(none)" : String.join(", ", gaps);

            String message = "plan readiness " + verdict.toUpperCase()
                + " — baselines=" + totalBaselines + "; gaps: " + gapCodesJoined;
            if (MigrationGapCodes.STATUS_INSUFFICIENT.equals(verdict)) {
                TRACE.fail(message, corr);
            } else if (MigrationGapCodes.STATUS_PARTIAL.equals(verdict)) {
                TRACE.warn(message, corr);
            } else {
                TRACE.ok(message, corr);
            }

            // DETAIL: only built when tier == detail (toJson + the map below are
            // skipped otherwise inside the tracer; this guard avoids the work too).
            int mappings = ctx.mappingsSummary() != null
                && ctx.mappingsSummary().totalMappings() != null
                ? ctx.mappingsSummary().totalMappings() : 0;
            List<Map<String, Object>> gapDetails = new ArrayList<>();
            for (String code : gaps) {
                Map<String, Object> g = new LinkedHashMap<>();
                g.put("code", code);
                g.put("reason", gapReason(code));
                gapDetails.add(g);
            }
            Map<String, Object> detail = new LinkedHashMap<>();
            detail.put("verdict", verdict);
            detail.put("findings", ctx.findings() == null ? 0 : ctx.findings().size());
            detail.put("totalBaselines", totalBaselines);
            detail.put("activeBaselineCount", activeBaselineCount);
            detail.put("mappings", mappings);
            detail.put("apiReadiness", readiness.apiReadiness());
            detail.put("dataReadiness", readiness.dataReadiness());
            detail.put("runtimeReadiness", readiness.infrastructureReadiness());
            detail.put("discoveryReadiness", readiness.discoveryReadiness());
            detail.put("baselineReadiness", readiness.baselineReadiness());
            detail.put("mappingReadiness", readiness.mappingReadiness());
            detail.put("decisionReadiness", readiness.decisionReadiness());
            detail.put("gaps", gapDetails);
            TRACE.detail("readiness.assessed", detail, corr);
        } catch (RuntimeException ignored) {
            // tracing must never affect the request
        }
    }

    /** Resolve the project's human name for trace correlation (best-effort). */
    private String resolveProjectName(UUID projectId) {
        if (projectId == null) {
            return null;
        }
        try {
            return projectRepository.findById(projectId)
                .map(p -> p.getName())
                .orElse(null);
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    /** Short human reason per gap code, for the self-diagnosing detail line. */
    private static String gapReason(String code) {
        if (code == null) {
            return "";
        }
        switch (code) {
            case MigrationGapCodes.NO_API_BEHAVIOUR_BASELINE:
                return "no API behaviour baseline saved for the current architecture";
            case MigrationGapCodes.MISSING_OAS_FOR_IN_SCOPE_INTERFACE:
                return "current architecture has no in-scope interfaces / OAS";
            case MigrationGapCodes.NO_DATABASE_DISCOVERY_FINDINGS:
                return "no database discovery findings";
            case MigrationGapCodes.NO_SAMPLE_DATA_HINTS:
                return "no sample-data hints";
            case MigrationGapCodes.HIGH_SEVERITY_UNREVIEWED_FINDINGS:
                return "high-severity findings still unreviewed";
            case MigrationGapCodes.MISSING_CURRENT_TO_TARGET_MAPPINGS:
                return "no / too few current-to-target element mappings";
            case MigrationGapCodes.UNRESOLVED_DISCOVERY_DECISIONS:
                return "unresolved discovery decision tasks";
            case MigrationGapCodes.INSUFFICIENT_RUNTIME_EVIDENCE:
                return "no runtime / log evidence captured";
            case MigrationGapCodes.INCOMPLETE_CAPTURE_COVERAGE:
                return "not all included operations were captured";
            case MigrationGapCodes.UNDER_SPECIFIED_ENDPOINTS:
                return "one or more endpoints are not fully specified";
            case MigrationGapCodes.DISCOVERY_HARNESS_INVENTORY_MISMATCH:
                return "model endpoint inventory and harness operations diverge";
            default:
                return code;
        }
    }

    /**
     * Advisory downgrade helper: {@code sufficient} becomes {@code partial};
     * {@code partial} / {@code insufficient} are left unchanged. NEVER promotes
     * and NEVER blocks.
     */
    private static String downgradeToPartial(String current) {
        return MigrationGapCodes.STATUS_SUFFICIENT.equals(current)
            ? MigrationGapCodes.STATUS_PARTIAL
            : current;
    }

    // -----------------------------------------------------------------------
    // Coverage aggregate records (read-only; NOT wire DTOs -- the gap codes ride
    // the existing ReadinessAssessmentDto.gaps() list, so no DTO shape change).
    // -----------------------------------------------------------------------

    /**
     * (A) CAPTURE coverage roll-up across the selected baselines.
     *
     * @param includedCount        count of {@code included = true} operations
     * @param capturedCount        of those, how many have a capture row
     * @param missingOperationKeys WHICH included operations were not captured
     *        ({@code <METHOD> <path>}), surfaced for the analyst -- not just a
     *        count
     * @param anyDiffed            informational: did any baseline (as diff
     *        SOURCE) produce a diff? {@code false} for a current-only baseline
     *        never replayed -- the unexecuted signal, NOT an error
     */
    record CaptureCoverage(
        int includedCount,
        int capturedCount,
        List<String> missingOperationKeys,
        boolean anyDiffed
    ) {
        static CaptureCoverage empty() {
            return new CaptureCoverage(0, 0, List.of(), false);
        }

        /** True when there is at least one included op and all of them were captured. */
        boolean isComplete() {
            return includedCount > 0 && capturedCount >= includedCount;
        }

        /** True when there is at least one included op and at least one was NOT captured. */
        boolean isIncomplete() {
            return includedCount > 0 && capturedCount < includedCount;
        }
    }

    /**
     * (B) SPECIFICATION coverage over the discovered endpoint set.
     *
     * @param totalEndpoints            total discovered endpoints (REST + SOAP)
     * @param fullySpecifiedCount       endpoints meeting the per-protocol bar
     * @param underSpecifiedEndpointIds the endpoint ids that fell short
     */
    record SpecificationCoverage(
        int totalEndpoints,
        int fullySpecifiedCount,
        List<String> underSpecifiedEndpointIds
    ) {
        static SpecificationCoverage empty() {
            return new SpecificationCoverage(0, 0, List.of());
        }

        boolean isComplete() {
            return totalEndpoints > 0 && fullySpecifiedCount >= totalEndpoints;
        }

        boolean isIncomplete() {
            return totalEndpoints > 0 && fullySpecifiedCount < totalEndpoints;
        }
    }

    /**
     * (C) INVENTORY reconciliation between the model endpoint inventory and the
     * harness operation set, both directions.
     *
     * @param discoveredNotCapturedCount discovered endpoints with no matching
     *        harness operation
     * @param capturedNotDiscoveredCount harness operations with no matching
     *        discovered endpoint
     */
    record InventoryReconciliation(
        int discoveredNotCapturedCount,
        int capturedNotDiscoveredCount
    ) {
        static InventoryReconciliation empty() {
            return new InventoryReconciliation(0, 0);
        }

        /** True when neither direction has a mismatch. */
        boolean isReconciled() {
            return discoveredNotCapturedCount == 0 && capturedNotDiscoveredCount == 0;
        }
    }

    /** Bundle of the three coverage aggregates threaded through {@link ReadinessContext}. */
    record CoverageAggregates(
        CaptureCoverage capture,
        SpecificationCoverage specification,
        InventoryReconciliation reconciliation
    ) {
        static CoverageAggregates empty() {
            return new CoverageAggregates(
                CaptureCoverage.empty(),
                SpecificationCoverage.empty(),
                InventoryReconciliation.empty());
        }
    }

    // -----------------------------------------------------------------------
    // Top-line summary
    // -----------------------------------------------------------------------

    private String composeTopLineSummary(
            ArchitectureEntity currentArch,
            List<DiscoveryRunEntity> runs,
            List<DiscoveryFindingEntity> findings,
            List<DiscoveryDecisionTaskEntity> unresolvedDecisions,
            MigrationDiscoveryContextDto.ApiBehaviourBaselineSummary baselineSummary,
            MigrationDiscoveryContextDto.ArchitectureMappingsSummary mappingsSummary,
            ReadinessAssessmentDto readiness) {
        StringBuilder sb = new StringBuilder();
        sb.append("Migration discovery context for architecture '")
            .append(currentArch.getName()).append("': ")
            .append(runs.size()).append(" discovery run(s), ")
            .append(findings.size()).append(" finding(s), ")
            .append(unresolvedDecisions.size()).append(" unresolved decision task(s), ")
            .append(safeInt(baselineSummary == null ? null : baselineSummary.totalBaselines()))
                .append(" baseline(s), ")
            .append(safeInt(mappingsSummary == null ? null : mappingsSummary.totalMappings()))
                .append(" mapping(s). ")
            .append("Overall readiness: ")
            .append(readiness.overallStatus()).append('.');
        return sb.toString();
    }

    private static int safeInt(Integer v) { return v == null ? 0 : v; }

    // -----------------------------------------------------------------------
    // Small helpers
    // -----------------------------------------------------------------------

    private static void increment(Map<String, Integer> map, String key) {
        if (key == null) {
            return;
        }
        map.merge(key, 1, Integer::sum);
    }

    private static String normalise(String s) {
        if (s == null) {
            return null;
        }
        String trimmed = s.trim();
        return trimmed.isEmpty() ? null : trimmed.toLowerCase();
    }

    /** Visible to the test suite for direct prioritisation assertions. */
    static List<DiscoveryFindingEntity> prioritiseAndCapForTest(
            List<DiscoveryFindingEntity> findings, int max) {
        return prioritiseAndCap(findings, max);
    }

    // -----------------------------------------------------------------------
    // Scenario seeds (Spec: capture-scenario-seeding, 2026-05-30) -- computed-on-read
    //
    // For every INCLUDED harness operation across the selected baseline sessions
    // we emit a ScenarioSeedSetDto. The happy_path seed is ALWAYS present; error /
    // edge / auth seeds are best-effort from the matched model endpoint's
    // persisted response contract. All parsing is defensive (instanceof casts,
    // null guards); the method never throws and never returns null.
    // -----------------------------------------------------------------------

    /**
     * Build the {@code scenarioSeeds} block. Reuses the same harness/model
     * enumeration the coverage gates use ({@link #loadHarnessOperationsForBaselines}
     * + {@link #resolveModelFileId} + {@link EndpointRepository}), so no new
     * collaborator or persistence is introduced.
     *
     * @return one seed set per included operation; empty (never null) when the
     *         coverage collaborators are absent or there are no included ops
     */
    private List<MigrationDiscoveryContextDto.ScenarioSeedSetDto> computeScenarioSeeds(
            ArchitectureEntity architecture,
            MigrationDiscoveryContextDto.ApiBehaviourBaselineSummary baselineSummary) {
        if (architecture == null
                || apiBehaviourOperationRepository == null
                || apiBehaviourBaselineRepository == null) {
            return List.of();
        }
        try {
            List<MigrationDiscoveryContextDto.BaselineHighlight> baselines =
                baselineSummary == null || baselineSummary.baselines() == null
                    ? List.of() : baselineSummary.baselines();

            // Included harness operations across all baseline sessions.
            List<ApiBehaviourOperationEntity> includedOps = new ArrayList<>();
            for (ApiBehaviourOperationEntity op : loadHarnessOperationsForBaselines(baselines)) {
                if (op != null && Boolean.TRUE.equals(op.getIncluded())) {
                    includedOps.add(op);
                }
            }
            if (includedOps.isEmpty()) {
                return List.of();
            }

            // Index the model endpoints by their REST/SOAP key for matching.
            Map<String, EndpointEntity> endpointsByKey = new LinkedHashMap<>();
            String modelFileId = resolveModelFileId(architecture.getProjectId(), architecture.getId());
            if (modelFileId != null && endpointRepository != null) {
                List<EndpointEntity> endpoints = endpointRepository.findByModelFileId(modelFileId);
                if (endpoints != null) {
                    for (EndpointEntity ep : endpoints) {
                        if (ep != null) {
                            endpointsByKey.putIfAbsent(endpointKey(ep), ep);
                        }
                    }
                }
            }

            List<MigrationDiscoveryContextDto.ScenarioSeedSetDto> sets = new ArrayList<>();
            for (ApiBehaviourOperationEntity op : includedOps) {
                try {
                    sets.add(buildSeedSet(op, endpointsByKey.get(operationKey(op))));
                } catch (RuntimeException ex) {
                    log.warn("scenario seeds: skipping operation {} due to error: {}",
                        operationKey(op), ex.toString());
                }
            }
            return sets;
        } catch (RuntimeException ex) {
            log.warn("scenario seeds: computation failed, returning empty list: {}", ex.toString());
            return List.of();
        }
    }

    /** Build the seed set for one included operation against its (optional) model endpoint. */
    private MigrationDiscoveryContextDto.ScenarioSeedSetDto buildSeedSet(
            ApiBehaviourOperationEntity op, EndpointEntity endpoint) {
        String key = operationKey(op);
        String method = op.getMethod() == null ? "" : op.getMethod().trim().toUpperCase();
        String path = op.getPath() == null ? "" : op.getPath().trim();

        // Resolve operation-level write-safety from persisted data effects, with
        // an HTTP-verb fallback when the endpoint is unmatched or has no effects.
        List<EndpointDataEffectEntity> effects = loadEffectsForSeeds(endpoint);
        boolean hasEffects = !effects.isEmpty();
        boolean anyWrite = false;
        for (EndpointDataEffectEntity effect : effects) {
            String mode = effect == null ? null : effect.getAccessMode();
            if ("write".equalsIgnoreCase(mode) || "read-write".equalsIgnoreCase(mode)) {
                anyWrite = true;
                break;
            }
        }
        boolean safeToExecute = hasEffects ? !anyWrite : isReadOnlyVerb(method);

        Map<String, Object> responseContract = safeResponseContract(endpoint);

        List<MigrationDiscoveryContextDto.ScenarioSeedDto> seeds = new ArrayList<>();
        Set<String> usedNames = new LinkedHashSet<>();

        // --- happy_path (ALWAYS) ---
        List<String> preconditions = new ArrayList<>();
        for (EndpointDataEffectEntity effect : effects) {
            String mode = effect == null ? null : effect.getAccessMode();
            if ("read".equalsIgnoreCase(mode) || "read-write".equalsIgnoreCase(mode)) {
                String target = effectTarget(effect);
                if (target != null && !target.isBlank()) {
                    preconditions.add("data for " + target + " must pre-exist");
                }
            }
        }
        int happyStatus = safeToExecute ? 200 : ("POST".equalsIgnoreCase(method) ? 201 : 200);
        String happyProvenance = hasEffects ? "access_mode" : "verb_fallback";
        addSeed(seeds, usedNames, "happy_path", new LinkedHashMap<>(), preconditions,
            happyStatus, safeToExecute, happyProvenance);

        // --- error seeds: documented non-2xx statuses ---
        Set<Integer> errorStatuses = new LinkedHashSet<>();
        collectErrorResponseStatuses(responseContract, errorStatuses);
        collectStatusCodeStatuses(responseContract, errorStatuses);
        collectValidationStatuses(responseContract, errorStatuses);
        boolean has401 = errorStatuses.contains(401);
        boolean has403 = errorStatuses.contains(403);
        for (Integer status : errorStatuses) {
            if (status != null && status >= 300) {
                addSeed(seeds, usedNames, "error_" + status, new LinkedHashMap<>(), List.of(),
                    status, safeToExecute, "response_contract");
            }
        }

        // --- edge seeds ---
        if (hasRequiredFieldValidation(responseContract)) {
            addSeed(seeds, usedNames, "edge_missing_required_field", new LinkedHashMap<>(),
                List.of(), 400, safeToExecute, "response_contract");
        }
        List<Object> variants = asList(valueOf(responseContract, "conditional_variants"));
        for (int i = 0; i < variants.size(); i++) {
            addSeed(seeds, usedNames, "edge_variant_" + i, new LinkedHashMap<>(),
                List.of(), 200, safeToExecute, "response_contract");
        }

        // --- auth_variant (only when auth is indicated) ---
        if (authIndicatesRequired(responseContract) || has401 || has403) {
            int authStatus = has401 ? 401 : (has403 ? 403 : 401);
            addSeed(seeds, usedNames, "auth_missing_token", new LinkedHashMap<>(),
                List.of(), authStatus, safeToExecute, "response_contract");
        }

        return new MigrationDiscoveryContextDto.ScenarioSeedSetDto(
            key, method, path, safeToExecute, seeds);
    }

    private List<EndpointDataEffectEntity> loadEffectsForSeeds(EndpointEntity endpoint) {
        if (endpoint == null || endpoint.getId() == null || endpointDataEffectRepository == null) {
            return List.of();
        }
        List<EndpointDataEffectEntity> effects =
            endpointDataEffectRepository.findByEndpointId(endpoint.getId());
        return effects == null ? List.of() : effects;
    }

    private static boolean isReadOnlyVerb(String method) {
        return "GET".equalsIgnoreCase(method)
            || "HEAD".equalsIgnoreCase(method)
            || "OPTIONS".equalsIgnoreCase(method);
    }

    /** Best-effort human-readable target for a precondition (the effect's data-entity-point id). */
    private static String effectTarget(EndpointDataEffectEntity effect) {
        if (effect == null) {
            return null;
        }
        return effect.getDataEntityPointId();
    }

    /** Add a seed, de-duping by scenarioName. scenarioType is the leading token of the name. */
    private static void addSeed(
            List<MigrationDiscoveryContextDto.ScenarioSeedDto> seeds,
            Set<String> usedNames,
            String scenarioName,
            Map<String, Object> exampleRequest,
            List<String> preconditions,
            Integer expectedStatus,
            Boolean safeToExecute,
            String provenance) {
        if (!usedNames.add(scenarioName)) {
            return;
        }
        String scenarioType = scenarioName.contains("_")
            ? scenarioName.substring(0, scenarioName.indexOf('_'))
            : scenarioName;
        seeds.add(new MigrationDiscoveryContextDto.ScenarioSeedDto(
            scenarioType, scenarioName, exampleRequest, preconditions,
            expectedStatus, safeToExecute, provenance));
    }

    /** Defensively read the endpoint's persisted {@code response_contract} as a String-keyed map. */
    private static Map<String, Object> safeResponseContract(EndpointEntity endpoint) {
        if (endpoint == null) {
            return Map.of();
        }
        Object raw;
        try {
            raw = endpoint.getResponseContract();
        } catch (RuntimeException ex) {
            return Map.of();
        }
        return asMap(raw);
    }

    private static Object valueOf(Map<String, Object> map, String key) {
        return map == null ? null : map.get(key);
    }

    @SuppressWarnings("unchecked")
    private static List<Object> asList(Object obj) {
        if (obj instanceof List<?> list) {
            return new ArrayList<>((List<Object>) list);
        }
        return List.of();
    }

    private static Map<String, Object> asMap(Object obj) {
        if (obj instanceof Map<?, ?> map) {
            Map<String, Object> result = new LinkedHashMap<>();
            for (Map.Entry<?, ?> e : map.entrySet()) {
                if (e.getKey() != null) {
                    result.put(e.getKey().toString(), e.getValue());
                }
            }
            return result;
        }
        return Map.of();
    }

    /** Coerce a status value (Integer, Number, or numeric String) to Integer, else null. */
    private static Integer coerceStatus(Object obj) {
        if (obj instanceof Integer i) {
            return i;
        }
        if (obj instanceof Number n) {
            return n.intValue();
        }
        if (obj instanceof String s) {
            String trimmed = s.trim();
            if (trimmed.isEmpty()) {
                return null;
            }
            try {
                return Integer.parseInt(trimmed);
            } catch (NumberFormatException ex) {
                return null;
            }
        }
        return null;
    }

    private static void collectErrorResponseStatuses(
            Map<String, Object> responseContract, Set<Integer> out) {
        for (Object entry : asList(valueOf(responseContract, "error_responses"))) {
            Map<String, Object> m = asMap(entry);
            Integer status = coerceStatus(m.get("status"));
            if (status == null) {
                status = coerceStatus(m.get("status_code"));
            }
            if (status == null) {
                status = coerceStatus(m.get("code"));
            }
            if (status != null && status >= 300) {
                out.add(status);
            }
        }
    }

    private static void collectStatusCodeStatuses(
            Map<String, Object> responseContract, Set<Integer> out) {
        Object statusCodes = valueOf(responseContract, "status_codes");
        if (statusCodes instanceof Map<?, ?> map) {
            for (Map.Entry<?, ?> e : map.entrySet()) {
                Integer status = coerceStatus(e.getKey());
                if (status == null) {
                    status = coerceStatus(e.getValue());
                }
                if (status != null && status >= 300) {
                    out.add(status);
                }
            }
        } else if (statusCodes instanceof List<?>) {
            for (Object entry : asList(statusCodes)) {
                Integer status = coerceStatus(entry);
                if (status == null) {
                    status = coerceStatus(asMap(entry).get("status"));
                }
                if (status != null && status >= 300) {
                    out.add(status);
                }
            }
        }
    }

    private static void collectValidationStatuses(
            Map<String, Object> responseContract, Set<Integer> out) {
        for (Object entry : asList(valueOf(responseContract, "validation"))) {
            Map<String, Object> m = asMap(entry);
            Integer status = coerceStatus(m.get("status"));
            if (status == null) {
                status = coerceStatus(m.get("status_code"));
            }
            if (status != null && status >= 300) {
                out.add(status);
            }
        }
    }

    private static boolean hasRequiredFieldValidation(Map<String, Object> responseContract) {
        for (Object entry : asList(valueOf(responseContract, "validation"))) {
            Map<String, Object> m = asMap(entry);
            String blob = String.valueOf(m.getOrDefault("check", ""))
                + " " + String.valueOf(m.getOrDefault("error", ""))
                + " " + String.valueOf(m.getOrDefault("rule", ""));
            String lower = blob.toLowerCase();
            if (lower.contains("required") || lower.contains("missing") || lower.contains("mandatory")) {
                return true;
            }
        }
        return false;
    }

    private static boolean authIndicatesRequired(Map<String, Object> responseContract) {
        Object auth = valueOf(responseContract, "auth");
        if (auth == null) {
            return false;
        }
        if (auth instanceof Boolean b) {
            return b;
        }
        if (auth instanceof Map<?, ?>) {
            Map<String, Object> m = asMap(auth);
            Object required = m.get("required");
            if (required instanceof Boolean rb) {
                return rb;
            }
            // A non-empty auth descriptor (e.g. a scheme/type) implies auth is in play.
            return !m.isEmpty();
        }
        if (auth instanceof String s) {
            String lower = s.trim().toLowerCase();
            return !lower.isEmpty() && !"none".equals(lower) && !"false".equals(lower);
        }
        return true;
    }
}
