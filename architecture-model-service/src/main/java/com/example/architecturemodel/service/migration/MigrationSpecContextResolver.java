package com.example.architecturemodel.service.migration;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.migration.MigrationSpecContextDto;
import com.example.architecturemodel.model.dto.migration.MigrationSpecContextDto.ApiContextBlock;
import com.example.architecturemodel.model.dto.migration.MigrationSpecContextDto.BudgetMeta;
import com.example.architecturemodel.model.dto.migration.MigrationSpecContextDto.CapturedDecision;
import com.example.architecturemodel.model.dto.migration.MigrationSpecContextDto.DataContextBlock;
import com.example.architecturemodel.model.dto.migration.MigrationSpecContextDto.DedupedRef;
import com.example.architecturemodel.model.dto.migration.MigrationSpecContextDto.EpicBlock;
import com.example.architecturemodel.model.dto.migration.MigrationSpecContextDto.FeatureBlock;
import com.example.architecturemodel.model.dto.migration.MigrationSpecContextDto.InfrastructureContextBlock;
import com.example.architecturemodel.model.dto.migration.MigrationSpecContextDto.InitiativeBlock;
import com.example.architecturemodel.model.dto.migration.MigrationSpecContextDto.MissingInput;
import com.example.architecturemodel.model.dto.migration.MigrationSpecContextDto.OperationalCapabilityContextBlock;
import com.example.architecturemodel.model.dto.migration.MigrationSpecContextDto.ParentRollup;
import com.example.architecturemodel.model.dto.migration.MigrationSpecContextDto.ServiceContextBlock;
import com.example.architecturemodel.model.dto.migration.MigrationSpecContextDto.SiblingSummary;
import com.example.architecturemodel.model.dto.migration.MigrationSpecContextDto.SoapContextBlock;
import com.example.architecturemodel.model.dto.migration.MigrationSpecContextDto.TestPackContextBlock;
import com.example.architecturemodel.model.dto.migration.MigrationSpecContextDto.WorkstreamContext;
import com.example.architecturemodel.model.dto.migration.MigrationSpecContextRequestDto;
import com.example.architecturemodel.model.entity.ArchitectureElementMappingEntity;
import com.example.architecturemodel.model.entity.EpicCapturedDecisionEntity;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationEntity;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationStatus;
import com.example.architecturemodel.model.entity.ProjectEntity;
import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourBaselineEntity;
import com.example.architecturemodel.model.entity.discovery.DiscoveryCapabilityEntity;
import com.example.architecturemodel.model.entity.discovery.DiscoveryCapabilityMemberEntity;
import com.example.architecturemodel.model.entity.discovery.DiscoveryFindingEntity;
import com.example.architecturemodel.repository.ProjectRepository;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourBaselineRepository;
import com.example.architecturemodel.repository.discovery.DiscoveryCapabilityMemberRepository;
import com.example.architecturemodel.repository.discovery.DiscoveryCapabilityRepository;
import com.example.architecturemodel.repository.discovery.DiscoveryFindingRepository;
import com.example.architecturemodel.repository.entity.ArchitectureElementMappingRepository;
import com.example.architecturemodel.repository.entity.EpicCapturedDecisionRepository;
import com.example.architecturemodel.repository.entity.MigrationStorySpecGenerationRepository;
import com.example.architecturemodel.repository.entity.WorkItemRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Resolver for the new focused-migration-context endpoint
 * {@code POST /api/projects/{projectId}/migration-spec-context} (A-5).
 *
 * <p>Separate from {@link MigrationDiscoveryContextService} (which produces a
 * project-level base context blob for the migration delivery plan flow).
 * This resolver takes a per-story request -- {@code workItemId} plus optional
 * book-of-work item id -- and returns one bounded block per requested
 * {@code contextType}
 * ({@code service|api|soap|data|infrastructure|test_pack|operational_capability}).
 * It MAY internally call the discovery-context summary resolver for project-
 * level base context but layers per-story drill-down on top.</p>
 *
 * <p><b>Bounded payloads (R-5).</b> Each block respects the request's
 * {@code maxFindings} / {@code maxEvidenceItems} / {@code maxBaselineItems}
 * caps. NO unbounded raw dump is ever emitted -- this AMS-side cap is the
 * first stage of the two-stage budget; the gateway then applies its
 * {@code applyTokenBudgetCascade} (R-5 / A-3) on top before the LLM call so
 * the per-story payload stays under the ~24K token cap.</p>
 *
 * <p><b>Missing-input blockers.</b> When required detail is absent -- e.g.
 * no current->target mapping, no API behaviour baseline, no DB discovery
 * findings -- each block carries a {@code missingInputs[]} list AND the
 * top-level DTO aggregates blockers across blocks. The resolver returns the
 * partial DTO with HTTP 200 rather than 4xx-ing; the gateway decides between
 * an {@code insufficient_context} per-story result and an LLM attempt.</p>
 *
 * <p>Spec: PM Migration Shape-Spec Batch Generation (2026-05-19) -- Task Group 7.</p>
 *
 * <p><b>Cross-Story Context Injection (2026-05-20, Task Group 3).</b> Adds
 * four top-level fields on the response:
 * {@code sibling_summaries[]} / {@code parent_rollup} / {@code workstream_context} /
 * {@code budget_meta}. Two new optional request fields drive the pass-2
 * sibling-aware path: {@code pass} (1 or 2) and {@code passOneSpecIdsInScope[]}.
 * The resolver enforces the loop guardrails at this boundary -- sibling
 * summaries are pass-1-only and exclude failed / insufficient_context rows
 * regardless of what the caller put in the scope list.</p>
 *
 * <p><b>7th context type: {@code operational_capability} (D3, 2026-06-14).</b>
 * Closes the verified "dead zone" so a non-API D2 {@code discovery_capability}
 * (or a behaviour-bearing {@code operational_artifact} finding) becomes a
 * genuinely implementation-ready, Migrate-able spec. The block resolves the
 * capability FIRST by {@code source_capability_id} (the PREFERRED, coherent
 * source — read from the WorkItem's {@code book_of_work_json} blob by the
 * gateway and passed on the request), then FALLS BACK to assembling from a
 * behaviour-bearing {@code operational_artifact} finding (the per-file
 * fallback, which also makes D3 testable before D2's entity is populated). The
 * block assembles from the capability's {@code detail_json} exactly as D2
 * persists it (JIL-DAG topology snapshot, typed {@code invocations[]} edges,
 * members + kinds, schedule / trigger metadata, inputs / outputs, side-effects,
 * external systems, plus name / kind / summary + the aggregated
 * {@code behaviourBearing} hint), emitting block-level {@code missingInputs[]}
 * ({@code capability_members} / {@code capability_behaviour}) when the
 * capability is thin so the gateway's pre-LLM {@code insufficient_context}
 * short-circuit fires with no LLM call. NO new Liquibase changeset — the
 * provenance link rides the blob, never a column.</p>
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@Slf4j
public class MigrationSpecContextResolver {

    private static final Set<String> KNOWN_CONTEXT_TYPES = Set.of(
        MigrationSpecContextRequestDto.CTX_SERVICE,
        MigrationSpecContextRequestDto.CTX_API,
        MigrationSpecContextRequestDto.CTX_SOAP,
        MigrationSpecContextRequestDto.CTX_DATA,
        MigrationSpecContextRequestDto.CTX_INFRASTRUCTURE,
        MigrationSpecContextRequestDto.CTX_TEST_PACK,
        MigrationSpecContextRequestDto.CTX_OPERATIONAL_CAPABILITY
    );

    private static final Set<String> SIBLING_ELIGIBLE_STATUSES = Set.of(
        MigrationStorySpecGenerationStatus.GENERATED,
        MigrationStorySpecGenerationStatus.GENERATED_WITH_WARNINGS
    );

    private static final Set<String> EPIC_DECISION_FEED_STATUSES = Set.of(
        "draft", "confirmed"
    );

    /**
     * The {@code finding_type} values that mark a {@code discovery_findings} row
     * as a behaviour-bearing operational artifact eligible for the
     * {@code operational_capability} FALLBACK source (D3). Free-text /
     * extensible, matched case-insensitively against the finding's
     * {@code finding_type} / {@code category} / {@code source}.
     */
    private static final Set<String> OPERATIONAL_ARTIFACT_FINDING_TYPES = Set.of(
        "operational_artifact", "operational_capability", "batch_artifact"
    );

    private final ProjectRepository projectRepository;
    private final WorkItemRepository workItemRepository;
    private final ArchitectureElementMappingRepository architectureElementMappingRepository;
    private final ApiBehaviourBaselineRepository apiBehaviourBaselineRepository;
    private final DiscoveryFindingRepository discoveryFindingRepository;
    private final MigrationStorySpecGenerationRepository specGenerationRepository;
    private final EpicCapturedDecisionRepository epicCapturedDecisionRepository;
    private final DiscoveryCapabilityRepository discoveryCapabilityRepository;
    private final DiscoveryCapabilityMemberRepository discoveryCapabilityMemberRepository;

    @Autowired
    public MigrationSpecContextResolver(
            ProjectRepository projectRepository,
            WorkItemRepository workItemRepository,
            ArchitectureElementMappingRepository architectureElementMappingRepository,
            ApiBehaviourBaselineRepository apiBehaviourBaselineRepository,
            DiscoveryFindingRepository discoveryFindingRepository,
            MigrationStorySpecGenerationRepository specGenerationRepository,
            EpicCapturedDecisionRepository epicCapturedDecisionRepository,
            DiscoveryCapabilityRepository discoveryCapabilityRepository,
            DiscoveryCapabilityMemberRepository discoveryCapabilityMemberRepository) {
        this.projectRepository = projectRepository;
        this.workItemRepository = workItemRepository;
        this.architectureElementMappingRepository = architectureElementMappingRepository;
        this.apiBehaviourBaselineRepository = apiBehaviourBaselineRepository;
        this.discoveryFindingRepository = discoveryFindingRepository;
        this.specGenerationRepository = specGenerationRepository;
        this.epicCapturedDecisionRepository = epicCapturedDecisionRepository;
        this.discoveryCapabilityRepository = discoveryCapabilityRepository;
        this.discoveryCapabilityMemberRepository = discoveryCapabilityMemberRepository;
    }

    /**
     * Resolve the focused-context bundle for a single saved-story WorkItem.
     *
     * @param projectId path-scoped project UUID
     * @param request   request body
     * @return populated DTO with one block per requested context type
     * @throws ResourceNotFoundException when project or WorkItem cannot be found
     *         in the scope
     * @throws IllegalArgumentException when the request body is missing required
     *         fields
     */
    @Transactional(readOnly = true)
    public MigrationSpecContextDto resolve(
            UUID projectId, MigrationSpecContextRequestDto request) {
        if (projectId == null) {
            throw new IllegalArgumentException("projectId is required");
        }
        if (request == null) {
            throw new IllegalArgumentException("request body is required");
        }
        if (request.workItemId() == null) {
            throw new IllegalArgumentException("workItemId is required");
        }
        if (request.contextTypes() == null || request.contextTypes().isEmpty()) {
            throw new IllegalArgumentException("contextTypes must be non-empty");
        }

        // Scope validation: 404 for unknown project / WorkItem rather than a
        // partial DTO -- the resolver only returns partial DTOs for
        // missing-input cases, NOT for unknown identifiers.
        // Spec 2026-05-20 -- Task Group 9: load the full project entity so we can
        // read per_story_context_token_cap / cross_story_context_token_cap below
        // when constructing BudgetMetaTracker. Loading via findById here (rather
        // than existsById) avoids a second round-trip for the config read.
        ProjectEntity projectEntity = projectRepository.findById(projectId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "Project not found: " + projectId));
        WorkItemEntity workItem = workItemRepository
            .findByIdAndProjectId(request.workItemId(), projectId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "WorkItem not found in project " + projectId + ": " + request.workItemId()));

        int maxFindings = request.maxFindingsOrDefault();
        int maxEvidence = request.maxEvidenceItemsOrDefault();
        int maxBaselines = request.maxBaselineItemsOrDefault();

        // Load mappings between current+target architecture, if both supplied.
        List<ArchitectureElementMappingEntity> mappings = loadMappings(
            projectId, request.currentArchitectureId(), request.targetArchitectureId());

        // Load API behaviour baselines for the current architecture, capped.
        List<ApiBehaviourBaselineEntity> baselines = loadBaselines(
            projectId, request.currentArchitectureId(), maxBaselines);

        // Load a bounded slice of discovery findings.
        List<DiscoveryFindingEntity> findings = loadFindings(
            projectId, request.currentArchitectureId(), maxFindings);

        List<String> requestedTypes = new ArrayList<>(request.contextTypes());
        List<String> returnedTypes = new ArrayList<>();
        List<MissingInput> topLevelMissing = new ArrayList<>();

        ServiceContextBlock service = null;
        ApiContextBlock api = null;
        SoapContextBlock soap = null;
        DataContextBlock data = null;
        InfrastructureContextBlock infrastructure = null;
        TestPackContextBlock testPack = null;
        OperationalCapabilityContextBlock operationalCapability = null;

        for (String type : requestedTypes) {
            if (type == null) continue;
            String normalised = type.trim().toLowerCase(Locale.ROOT);
            if (!KNOWN_CONTEXT_TYPES.contains(normalised)) {
                topLevelMissing.add(new MissingInput(
                    "context_type", normalised, "Unknown context type"));
                continue;
            }
            switch (normalised) {
                case MigrationSpecContextRequestDto.CTX_SERVICE:
                    service = buildServiceBlock(workItem, mappings, findings, maxFindings);
                    returnedTypes.add(normalised);
                    aggregateMissing(topLevelMissing, service.missingInputs());
                    break;
                case MigrationSpecContextRequestDto.CTX_API:
                    api = buildApiBlock(workItem, mappings, baselines, findings, maxFindings);
                    returnedTypes.add(normalised);
                    aggregateMissing(topLevelMissing, api.missingInputs());
                    break;
                case MigrationSpecContextRequestDto.CTX_SOAP:
                    soap = buildSoapBlock(workItem, mappings, baselines, findings);
                    returnedTypes.add(normalised);
                    aggregateMissing(topLevelMissing, soap.missingInputs());
                    break;
                case MigrationSpecContextRequestDto.CTX_DATA:
                    data = buildDataBlock(workItem, mappings, findings, maxFindings);
                    returnedTypes.add(normalised);
                    aggregateMissing(topLevelMissing, data.missingInputs());
                    break;
                case MigrationSpecContextRequestDto.CTX_INFRASTRUCTURE:
                    infrastructure = buildInfrastructureBlock(workItem);
                    returnedTypes.add(normalised);
                    aggregateMissing(topLevelMissing, infrastructure.missingInputs());
                    break;
                case MigrationSpecContextRequestDto.CTX_TEST_PACK:
                    testPack = buildTestPackBlock(workItem, baselines, findings, maxFindings);
                    returnedTypes.add(normalised);
                    aggregateMissing(topLevelMissing, testPack.missingInputs());
                    break;
                case MigrationSpecContextRequestDto.CTX_OPERATIONAL_CAPABILITY:
                    operationalCapability = buildOperationalCapabilityBlock(
                        request.sourceCapabilityId(), findings, maxFindings);
                    returnedTypes.add(normalised);
                    aggregateMissing(topLevelMissing, operationalCapability.missingInputs());
                    break;
                default:
                    // Unreachable: KNOWN_CONTEXT_TYPES guards above.
                    break;
            }
        }

        // -----------------------------------------------------------------
        // Cross-Story Context Injection (Task Group 3)
        // -----------------------------------------------------------------
        // Spec 2026-05-20 -- Task Group 9: read per-project caps from the project
        // entity loaded above. Null values (which the DB DEFAULT clauses ensure
        // are present as 24000 / 12000) fall through to BudgetMetaTracker's
        // DEFAULT_*_TOKEN_CAP constants -- defensive two-layer defaulting.
        BudgetMetaTracker tracker = new BudgetMetaTracker(
            projectEntity.getPerStoryContextTokenCap(),
            projectEntity.getCrossStoryContextTokenCap());
        // Story description / requested-block payload is never trimmed; book a
        // rough non-trimmable cost so the budget envelope reflects per-story
        // usage in the response.
        tracker.reservePerStoryNonTrimmable(BudgetMetaTracker.estimateTokens(workItem.getDescription()));

        ParentRollup parentRollup = buildParentRollup(projectId, workItem, tracker);

        WorkstreamContext workstreamContext = buildWorkstreamContext(
            projectId, request, tracker);

        List<SiblingSummary> siblingSummaries = buildSiblingSummaries(
            projectId, workItem, request, tracker);

        BudgetMeta budgetMeta = tracker.toBudgetMeta();

        log.info(
            "[diag-ams] spec_generation cross_story_resolved projectId={} workItemId={}"
                + " pass={} siblingsAdmitted={} siblingsDropped={} evidenceDropped={}"
                + " parentRollupEpicPresent={} workstreamApiBaselines={} workstreamArchRefs={}",
            shortPrefix(projectId), shortPrefix(request.workItemId()),
            request.passOrDefault(),
            siblingSummaries == null ? 0 : siblingSummaries.size(),
            tracker.siblingSpecsDropped(),
            tracker.evidenceRefsDropped(),
            parentRollup != null && parentRollup.epic() != null,
            workstreamContext != null && workstreamContext.apiBaselines() != null
                ? workstreamContext.apiBaselines().size() : 0,
            workstreamContext != null && workstreamContext.architectureRefs() != null
                ? workstreamContext.architectureRefs().size() : 0);

        log.info(
            "[diag-ams] spec_generation focused_context_resolved projectId={} workItemId={}"
                + " contextTypes={} blocksReturned={} missingInputs={}",
            shortPrefix(projectId), shortPrefix(request.workItemId()),
            returnedTypes, returnedTypes.size(), topLevelMissing.size());

        return new MigrationSpecContextDto(
            projectId,
            request.workItemId(),
            request.bookOfWorkId(),
            request.bookItemId(),
            request.currentArchitectureId(),
            request.targetArchitectureId(),
            requestedTypes,
            returnedTypes,
            service,
            api,
            soap,
            data,
            infrastructure,
            testPack,
            operationalCapability,
            topLevelMissing.isEmpty() ? Collections.emptyList() : topLevelMissing,
            siblingSummaries,
            parentRollup,
            workstreamContext,
            budgetMeta
        );
    }

    // -----------------------------------------------------------------------
    // Block builders -- one per supported context type
    // -----------------------------------------------------------------------

    private ServiceContextBlock buildServiceBlock(
            WorkItemEntity workItem,
            List<ArchitectureElementMappingEntity> mappings,
            List<DiscoveryFindingEntity> findings,
            int maxFindings) {
        List<MissingInput> missing = new ArrayList<>();

        List<Map<String, Object>> serviceMappings = mappingsFilteredByType(
            mappings, Set.of("service", "application", "component"));
        if (serviceMappings.isEmpty()) {
            missing.add(new MissingInput("mapping", "service",
                "No current->target service/application mappings for this story"));
        }

        List<Map<String, Object>> packFindings = boundedFindings(
            findings, Set.of("pack_finding", "code_scan", "static_analysis"), maxFindings);
        List<Map<String, Object>> rawSqlFindings = boundedFindings(
            findings, Set.of("raw_sql"), maxFindings);
        List<Map<String, Object>> spJdbcFindings = boundedFindings(
            findings, Set.of("stored_proc", "jdbc"), maxFindings);
        List<Map<String, Object>> dependencyFindings = boundedFindings(
            findings, Set.of("dependency", "library"), maxFindings);

        if (packFindings.isEmpty() && rawSqlFindings.isEmpty() && spJdbcFindings.isEmpty()) {
            missing.add(new MissingInput("discovery_finding", "service",
                "No service-level discovery findings (pack/raw_sql/stored_proc) for this story"));
        }

        return new ServiceContextBlock(
            workItem.getTitle(),
            null,                            // targetServiceRef -- gateway derives from mappings
            Collections.emptyList(),         // sourceCodeCandidateRefs (Spec 1 fixture-driven future hook)
            packFindings,
            dependencyFindings,
            rawSqlFindings,
            spJdbcFindings,
            serviceMappings,
            Collections.emptyList(),         // relatedArchitectureRefs (future hook)
            missing
        );
    }

    private ApiContextBlock buildApiBlock(
            WorkItemEntity workItem,
            List<ArchitectureElementMappingEntity> mappings,
            List<ApiBehaviourBaselineEntity> baselines,
            List<DiscoveryFindingEntity> findings,
            int maxFindings) {
        List<MissingInput> missing = new ArrayList<>();

        List<Map<String, Object>> apiMappings = mappingsFilteredByType(
            mappings, Set.of("interface", "api", "endpoint"));
        if (apiMappings.isEmpty()) {
            missing.add(new MissingInput("mapping", "api",
                "No current->target API/interface mappings for this story"));
        }

        List<String> baselineRefs = new ArrayList<>();
        for (ApiBehaviourBaselineEntity b : baselines) {
            if (b.getId() != null) baselineRefs.add(b.getId().toString());
        }
        if (baselineRefs.isEmpty()) {
            missing.add(new MissingInput("baseline", "api_behaviour",
                "No API behaviour baseline for this endpoint"));
        }

        List<Map<String, Object>> runtimeUsage = boundedFindings(
            findings, Set.of("runtime_usage", "runtime_log"), maxFindings);
        List<Map<String, Object>> missingContracts = boundedFindings(
            findings, Set.of("missing_contract", "oas_gap"), maxFindings);

        return new ApiContextBlock(
            null,                             // operationId (gateway resolves from BoW)
            null,                             // oasContractId (future)
            workItem.getTitle(),
            Collections.emptyList(),
            baselineRefs,
            Collections.emptyList(),
            runtimeUsage,
            missingContracts,
            apiMappings,
            Collections.emptyList(),
            Collections.emptyList(),
            missing
        );
    }

    private SoapContextBlock buildSoapBlock(
            WorkItemEntity workItem,
            List<ArchitectureElementMappingEntity> mappings,
            List<ApiBehaviourBaselineEntity> baselines,
            List<DiscoveryFindingEntity> findings) {
        List<MissingInput> missing = new ArrayList<>();
        List<Map<String, Object>> soapMappings = mappingsFilteredByType(
            mappings, Set.of("soap", "wsdl", "interface"));
        if (soapMappings.isEmpty()) {
            missing.add(new MissingInput("mapping", "soap",
                "No current->target SOAP operation mappings for this story"));
        }
        List<String> baselineRefs = new ArrayList<>();
        for (ApiBehaviourBaselineEntity b : baselines) {
            if (b.getId() != null) baselineRefs.add(b.getId().toString());
        }
        List<Map<String, Object>> soapFindings = new ArrayList<>();
        for (DiscoveryFindingEntity f : findings) {
            String type = f.getFindingType() == null ? "" : f.getFindingType().toLowerCase(Locale.ROOT);
            String src = f.getSource() == null ? "" : f.getSource().toLowerCase(Locale.ROOT);
            if (type.contains("soap") || type.contains("wsdl") || src.contains("soap")) {
                soapFindings.add(toFindingMap(f));
            }
        }
        if (soapFindings.isEmpty()) {
            missing.add(new MissingInput("discovery_finding", "soap",
                "No SOAP-related discovery findings for this story"));
        }
        return new SoapContextBlock(
            workItem.getTitle(),
            null,                             // wsdlRef (future)
            Collections.emptyList(),
            null,
            Collections.emptyList(),
            Collections.emptyMap(),
            Collections.emptyMap(),
            Collections.emptyList(),
            baselineRefs,
            Collections.emptyList(),
            soapFindings,
            soapMappings,
            missing
        );
    }

    private DataContextBlock buildDataBlock(
            WorkItemEntity workItem,
            List<ArchitectureElementMappingEntity> mappings,
            List<DiscoveryFindingEntity> findings,
            int maxFindings) {
        List<MissingInput> missing = new ArrayList<>();
        List<Map<String, Object>> dataMappings = mappingsFilteredByType(
            mappings, Set.of("data_entity", "table", "entity"));
        if (dataMappings.isEmpty()) {
            missing.add(new MissingInput("mapping", "data",
                "No current->target data entity / table mapping for this story"));
        }
        List<Map<String, Object>> dbProfile = boundedFindings(
            findings, Set.of("db_profile", "db_discovery", "schema_profile"), maxFindings);
        List<Map<String, Object>> dataQuality = boundedFindings(
            findings, Set.of("data_quality"), maxFindings);
        List<Map<String, Object>> spViewTrigger = boundedFindings(
            findings, Set.of("stored_proc", "view", "trigger"), maxFindings);
        List<Map<String, Object>> sampleData = boundedFindings(
            findings, Set.of("sample_data"), maxFindings);
        List<Map<String, Object>> reconciliation = boundedFindings(
            findings, Set.of("reconciliation"), maxFindings);
        if (dbProfile.isEmpty() && dataQuality.isEmpty() && spViewTrigger.isEmpty()) {
            missing.add(new MissingInput("discovery_finding", "data",
                "No DB / data-discovery findings for this story"));
        }
        return new DataContextBlock(
            workItem.getTitle(),
            null,
            null,
            null,
            Collections.emptyList(),
            dataMappings,
            dbProfile,
            dataQuality,
            spViewTrigger,
            sampleData,
            reconciliation,
            missing
        );
    }

    private InfrastructureContextBlock buildInfrastructureBlock(WorkItemEntity workItem) {
        // Infra context surfaces are intentionally lightweight in v1 -- the
        // resolver returns a populated-shell block + a "no infra refs in
        // architecture model" missing-input when nothing concrete is wired
        // through. The gateway decides whether to treat this as
        // insufficient_context.
        List<MissingInput> missing = new ArrayList<>();
        missing.add(new MissingInput("infrastructure_refs", workItem.getId().toString(),
            "No infrastructure-typed architecture refs / IaC sources resolved for this story"));
        return new InfrastructureContextBlock(
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            missing
        );
    }

    private TestPackContextBlock buildTestPackBlock(
            WorkItemEntity workItem,
            List<ApiBehaviourBaselineEntity> baselines,
            List<DiscoveryFindingEntity> findings,
            int maxFindings) {
        List<MissingInput> missing = new ArrayList<>();
        List<String> baselineRefs = new ArrayList<>();
        for (ApiBehaviourBaselineEntity b : baselines) {
            if (b.getId() != null) baselineRefs.add(b.getId().toString());
        }
        if (baselineRefs.isEmpty()) {
            missing.add(new MissingInput("baseline", "test_pack",
                "No API behaviour baselines available for reconciliation test pack"));
        }
        List<Map<String, Object>> dbFindings = boundedFindings(
            findings, Set.of("db_profile", "db_discovery", "schema_profile"), maxFindings);
        List<Map<String, Object>> sampleData = boundedFindings(
            findings, Set.of("sample_data"), maxFindings);
        List<Map<String, Object>> reconciliation = boundedFindings(
            findings, Set.of("reconciliation"), maxFindings);
        if (dbFindings.isEmpty() && reconciliation.isEmpty()) {
            missing.add(new MissingInput("discovery_finding", "test_pack",
                "No reconciliation / DB discovery findings for this story"));
        }
        return new TestPackContextBlock(
            baselineRefs,
            Collections.emptyList(),
            Collections.emptyList(),
            dbFindings,
            sampleData,
            reconciliation,
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            missing
        );
    }

    /**
     * Build the {@code operational_capability} block (D3, the 7th context type).
     *
     * <p>Resolution order:</p>
     * <ol>
     *   <li><b>PREFERRED — capability.</b> When the request carries a
     *       {@code sourceCapabilityId} and a {@link DiscoveryCapabilityEntity}
     *       resolves by that id, the block is assembled from the capability's
     *       {@code name} / {@code kind} / {@code summary} / boxed
     *       {@code confidence} + its {@code detail_json} (the JIL-DAG topology
     *       snapshot, the typed {@code invocations[]} edges, schedule / trigger
     *       metadata, inputs / outputs, side-effects, external systems, and the
     *       aggregated {@code behaviourBearing} hint) + its members + kinds from
     *       {@code discovery_capability_member}.</li>
     *   <li><b>FALLBACK — finding.</b> Otherwise the block is assembled from the
     *       first behaviour-bearing {@code operational_artifact}
     *       {@code discovery_findings} row in the already-loaded bounded slice:
     *       its {@code title} (as {@code name}), its {@code detail_json}
     *       {@code artifactKind} (as {@code kind}), {@code summary}, and the
     *       {@code detail_json} (purpose / invokes / inputs / outputs /
     *       sideEffects / externalSystems / behaviourBearing).</li>
     * </ol>
     *
     * <p>Block-level {@code missingInputs[]} carry {@code capability_members}
     * (zero members) and/or {@code capability_behaviour} (no behaviour signal)
     * when the source is thin, OR a single {@code operational_capability} blocker
     * when NEITHER a capability NOR a behaviour-bearing finding resolves. Those
     * aggregate into the DTO top-level list so the gateway's pre-LLM
     * {@code insufficient_context} short-circuit (D6) fires with no LLM call.</p>
     */
    OperationalCapabilityContextBlock buildOperationalCapabilityBlock(
            UUID sourceCapabilityId,
            List<DiscoveryFindingEntity> findings,
            int maxFindings) {
        // PREFERRED: a D2 discovery_capability resolved by source_capability_id.
        if (sourceCapabilityId != null) {
            Optional<DiscoveryCapabilityEntity> capOpt = loadCapability(sourceCapabilityId);
            if (capOpt.isPresent()) {
                return fromCapability(capOpt.get());
            }
            log.info(
                "[diag-ams] spec_generation operational_capability_fallback sourceCapabilityId={} reason=capability_not_found",
                shortPrefix(sourceCapabilityId));
        }

        // FALLBACK: the first behaviour-bearing operational_artifact finding.
        DiscoveryFindingEntity artifact = firstBehaviourBearingArtifact(findings);
        if (artifact != null) {
            return fromFinding(artifact);
        }

        // Neither source resolved -- emit a single block-level blocker so the
        // gateway short-circuits to insufficient_context (no LLM call).
        List<MissingInput> missing = new ArrayList<>();
        missing.add(new MissingInput("operational_capability",
            sourceCapabilityId == null ? null : sourceCapabilityId.toString(),
            "No discovery_capability resolved by source_capability_id and no "
                + "behaviour-bearing operational_artifact finding for this story"));
        return new OperationalCapabilityContextBlock(
            sourceCapabilityId == null ? null : sourceCapabilityId.toString(),
            null,
            "none",
            null,
            null,
            null,
            null,
            null,
            false,
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyMap(),
            missing
        );
    }

    private OperationalCapabilityContextBlock fromCapability(DiscoveryCapabilityEntity cap) {
        List<MissingInput> missing = new ArrayList<>();

        // Members + their kinds (from discovery_capability_member).
        List<DiscoveryCapabilityMemberEntity> members = loadCapabilityMembers(cap.getId());
        List<Map<String, Object>> memberMaps = new ArrayList<>();
        Set<String> memberKinds = new LinkedHashSet<>();
        for (DiscoveryCapabilityMemberEntity m : members) {
            if (m == null) continue;
            memberMaps.add(toCapabilityMemberMap(m));
            if (m.getMemberType() != null) memberKinds.add(m.getMemberType());
        }
        if (memberMaps.isEmpty()) {
            missing.add(new MissingInput("capability_members", cap.getId().toString(),
                "Capability has no members -- nothing to derive an implementation-ready spec from"));
        }

        // Behaviour signal: the aggregated behaviourBearing hint on detail_json.
        Map<String, Object> detail = cap.getDetailJson() == null
            ? Collections.emptyMap() : cap.getDetailJson();
        boolean behaviourBearing = readBehaviourBearing(detail);
        if (!behaviourBearing) {
            missing.add(new MissingInput("capability_behaviour", cap.getId().toString(),
                "Capability carries no behaviour-bearing signal -- effect-oriented spec cannot be derived"));
        }

        return new OperationalCapabilityContextBlock(
            cap.getId() == null ? null : cap.getId().toString(),
            null,
            "capability",
            cap.getName(),
            cap.getKind(),
            cap.getSummary(),
            cap.getConfidence(),
            cap.getReviewStatus(),
            behaviourBearing,
            memberMaps,
            new ArrayList<>(memberKinds),
            detail,
            missing
        );
    }

    private OperationalCapabilityContextBlock fromFinding(DiscoveryFindingEntity f) {
        List<MissingInput> missing = new ArrayList<>();
        Map<String, Object> detail = f.getDetailJson() == null
            ? Collections.emptyMap() : f.getDetailJson();
        // The fallback path only selects behaviour-bearing artifacts, so the
        // hint is true by construction; still read it so the block reflects the
        // payload faithfully.
        boolean behaviourBearing = readBehaviourBearing(detail);
        // A finding fallback has no membership edges; surface the (informational)
        // blocker only if the artifact is somehow NOT behaviour-bearing.
        if (!behaviourBearing) {
            missing.add(new MissingInput("capability_behaviour", f.getId().toString(),
                "Operational-artifact finding carries no behaviour-bearing signal"));
        }
        String kind = stringFromDetail(detail, "artifactKind");
        return new OperationalCapabilityContextBlock(
            null,
            f.getId() == null ? null : f.getId().toString(),
            "finding",
            f.getTitle(),
            kind,
            f.getSummary(),
            f.getConfidence(),
            f.getReviewStatus(),
            behaviourBearing,
            Collections.emptyList(),
            Collections.emptyList(),
            detail,
            missing
        );
    }

    private Optional<DiscoveryCapabilityEntity> loadCapability(UUID capabilityId) {
        if (capabilityId == null) return Optional.empty();
        try {
            return discoveryCapabilityRepository.findById(capabilityId);
        } catch (RuntimeException e) {
            log.warn(
                "[diag-ams] spec_generation operational_capability_load_capability_fail capabilityId={} reason={}",
                shortPrefix(capabilityId), e.getMessage());
            return Optional.empty();
        }
    }

    private List<DiscoveryCapabilityMemberEntity> loadCapabilityMembers(UUID capabilityId) {
        if (capabilityId == null) return Collections.emptyList();
        try {
            List<DiscoveryCapabilityMemberEntity> rows = discoveryCapabilityMemberRepository
                .findByCapabilityIdOrderByCreatedAtAsc(capabilityId);
            return rows == null ? Collections.emptyList() : rows;
        } catch (RuntimeException e) {
            log.warn(
                "[diag-ams] spec_generation operational_capability_load_members_fail capabilityId={} reason={}",
                shortPrefix(capabilityId), e.getMessage());
            return Collections.emptyList();
        }
    }

    /**
     * The first behaviour-bearing {@code operational_artifact} finding in the
     * bounded slice, or {@code null} when none qualifies. A finding qualifies
     * when its {@code finding_type} / {@code category} / {@code source} matches
     * an operational-artifact token AND its {@code detail_json}
     * {@code behaviourBearing} hint is truthy.
     */
    private DiscoveryFindingEntity firstBehaviourBearingArtifact(List<DiscoveryFindingEntity> findings) {
        if (findings == null || findings.isEmpty()) return null;
        for (DiscoveryFindingEntity f : findings) {
            if (f == null) continue;
            if (!matchesAny(f, OPERATIONAL_ARTIFACT_FINDING_TYPES)) continue;
            Map<String, Object> detail = f.getDetailJson();
            if (readBehaviourBearing(detail == null ? Collections.emptyMap() : detail)) {
                return f;
            }
        }
        return null;
    }

    private static Map<String, Object> toCapabilityMemberMap(DiscoveryCapabilityMemberEntity m) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", m.getId() == null ? null : m.getId().toString());
        out.put("memberType", m.getMemberType());
        out.put("memberId", m.getMemberId() == null ? null : m.getMemberId().toString());
        return out;
    }

    /**
     * Read the aggregated {@code behaviourBearing} hint from a detail payload.
     * Accepts a boolean, or a string {@code "true"} / {@code "false"} (JSONB
     * round-trips can stringify), defaulting to {@code false} when absent.
     */
    private static boolean readBehaviourBearing(Map<String, Object> detail) {
        if (detail == null) return false;
        Object v = detail.get("behaviourBearing");
        if (v instanceof Boolean b) return b;
        if (v instanceof String s) return Boolean.parseBoolean(s.trim());
        return false;
    }

    private static String stringFromDetail(Map<String, Object> detail, String key) {
        if (detail == null) return null;
        Object v = detail.get(key);
        return v instanceof String s ? s : null;
    }

    // -----------------------------------------------------------------------
    // Cross-Story Context Injection builders (Task Group 3, 2026-05-20)
    // -----------------------------------------------------------------------

    /**
     * Build the {@code sibling_summaries[]} list for pass-2 generation.
     *
     * <p><b>Loop guardrails enforced here:</b></p>
     * <ul>
     *   <li>Only rows with {@code generation_pass = 1} appear -- pass-2
     *       outputs are NEVER exposed to other pass-2 calls.</li>
     *   <li>Rows with status {@code failed} or {@code insufficient_context} are
     *       excluded regardless of whether their id appears in
     *       {@code passOneSpecIdsInScope[]}.</li>
     *   <li>Sibling-summary content comes from {@code decisions_json} /
     *       {@code interfaces_json} / {@code assumptions_json} columns
     *       (populated at write-time by {@code ShapeSpecHeadingParser}); the
     *       resolver NEVER re-parses spec text at request time.</li>
     * </ul>
     *
     * <p>Sibling scope: the current story's parent epic/feature, looked up via
     * {@link WorkItemEntity#getParentId()}. Stories sharing a parent WorkItem
     * are siblings.</p>
     *
     * <p>For pass=1 callers (or callers that omitted the field) the resolver
     * still returns {@code null} for {@code sibling_summaries} -- pass-1 must
     * not see other stories' siblings by contract.</p>
     */
    List<SiblingSummary> buildSiblingSummaries(
            UUID projectId,
            WorkItemEntity workItem,
            MigrationSpecContextRequestDto request,
            BudgetMetaTracker tracker) {
        if (request.passOrDefault() != 2) {
            // Pass-1: sibling summaries intentionally absent (loop guardrail).
            return null;
        }
        UUID parentId = workItem.getParentId();
        if (parentId == null) {
            // Orphan story (no parent feature/epic) has no siblings by
            // structural definition.
            return Collections.emptyList();
        }

        // Find all sibling WorkItem ids (children of the same parent).
        List<WorkItemEntity> siblings;
        try {
            siblings = workItemRepository
                .findByProjectIdAndParentIdOrderBySortOrderAscCreatedAtAscIdAsc(
                    projectId, parentId);
        } catch (RuntimeException e) {
            log.warn(
                "[diag-ams] spec_generation cross_story_load_siblings_fail projectId={} reason={}",
                shortPrefix(projectId), e.getMessage());
            return Collections.emptyList();
        }
        if (siblings == null || siblings.isEmpty()) {
            return Collections.emptyList();
        }

        // Index sibling WorkItem ids for quick filter.
        Map<UUID, WorkItemEntity> siblingsByWorkItemId = new LinkedHashMap<>();
        for (WorkItemEntity wi : siblings) {
            if (wi.getId() == null) continue;
            // Skip the current story -- a story is never its own sibling.
            if (wi.getId().equals(workItem.getId())) continue;
            siblingsByWorkItemId.put(wi.getId(), wi);
        }
        if (siblingsByWorkItemId.isEmpty()) {
            return Collections.emptyList();
        }

        // Load candidate spec-generation rows: prefer the caller-supplied scope
        // list (the gateway's pass-2 boundary explicitly listed which pass-1
        // ids it considers in-scope), fall back to a per-sibling lookup.
        List<MigrationStorySpecGenerationEntity> candidates = new ArrayList<>();
        List<UUID> scope = request.passOneSpecIdsInScope();
        if (scope != null && !scope.isEmpty()) {
            for (UUID specId : scope) {
                if (specId == null) continue;
                Optional<MigrationStorySpecGenerationEntity> opt =
                    specGenerationRepository.findById(specId);
                opt.ifPresent(candidates::add);
            }
        } else {
            // No explicit scope -- pull all generation rows for the sibling
            // WorkItems and let the filter below trim to pass-1 + eligible.
            for (UUID siblingWorkItemId : siblingsByWorkItemId.keySet()) {
                List<MigrationStorySpecGenerationEntity> rows = specGenerationRepository
                    .findByWorkItemId(siblingWorkItemId);
                if (rows != null) candidates.addAll(rows);
            }
        }

        // Apply the loop guardrails: pass-1 only, eligible status only,
        // sibling-scope only.
        List<SiblingSummary> raw = new ArrayList<>();
        for (MigrationStorySpecGenerationEntity row : candidates) {
            if (row == null) continue;
            if (row.getGenerationPass() == null || row.getGenerationPass() != 1) {
                continue; // pass-2 outputs are never sibling context
            }
            if (row.getStatus() == null
                || !SIBLING_ELIGIBLE_STATUSES.contains(row.getStatus())) {
                continue; // failed / insufficient_context / skipped_blocked excluded
            }
            UUID wid = row.getWorkItemId();
            if (wid == null || !siblingsByWorkItemId.containsKey(wid)) {
                continue; // not a sibling of the current story
            }
            WorkItemEntity siblingWi = siblingsByWorkItemId.get(wid);
            raw.add(new SiblingSummary(
                wid,
                siblingWi.getTitle(),
                nullSafeList(row.getDecisionsJson()),
                nullSafeList(row.getInterfacesJson()),
                nullSafeList(row.getAssumptionsJson()),
                row.getGenerationPass()
            ));
        }

        // Hand to the tracker for tiered trimming (highest-relevance first --
        // we use input order as a stand-in until a relevance signal is wired).
        return tracker.admitSiblings(raw);
    }

    /**
     * Build the {@code parent_rollup} block by walking the WorkItem parent
     * chain: story -> feature -> epic -> initiative.
     *
     * <p>Epic block carries the curated captured-decisions list (only rows
     * with status in {@code draft, confirmed} per the spec); feature and
     * initiative blocks are intentionally short (title + 1-sentence summary).</p>
     *
     * <p>Parent rollup is NEVER trimmed -- it occupies non-trimmable budget
     * via {@link BudgetMetaTracker#reserveCrossStoryNonTrimmable(int)} so the
     * envelope reflects its cost, but is always returned in full.</p>
     */
    ParentRollup buildParentRollup(
            UUID projectId,
            WorkItemEntity workItem,
            BudgetMetaTracker tracker) {
        if (workItem.getParentId() == null) {
            return null;
        }
        // Walk up the parent chain by type. The work_item table is free-text
        // typed; we accept the canonical FEATURE / EPIC / INITIATIVE strings
        // (any case) and short-circuit on any anomaly.
        WorkItemEntity feature = null;
        WorkItemEntity epic = null;
        WorkItemEntity initiative = null;

        WorkItemEntity current = lookupParent(projectId, workItem.getParentId());
        // Up to 3 ancestors expected -- defensive cap of 8 hops to avoid
        // accidental cycles taking the resolver down.
        for (int hops = 0; hops < 8 && current != null; hops++) {
            String type = current.getType() == null ? "" : current.getType().toLowerCase(Locale.ROOT);
            switch (type) {
                case "feature":
                    if (feature == null) feature = current;
                    break;
                case "epic":
                    if (epic == null) epic = current;
                    break;
                case "initiative":
                    if (initiative == null) initiative = current;
                    break;
                default:
                    // Unknown level -- continue walking.
                    break;
            }
            if (current.getParentId() == null) break;
            current = lookupParent(projectId, current.getParentId());
        }

        EpicBlock epicBlock = null;
        if (epic != null) {
            List<CapturedDecision> capturedDecisions = loadCapturedDecisions(
                projectId, epic.getId());
            epicBlock = new EpicBlock(
                epic.getId(),
                epic.getTitle(),
                epic.getDescription(),
                capturedDecisions);
            tracker.reserveCrossStoryNonTrimmable(
                BudgetMetaTracker.estimateTokens(epic.getTitle())
                    + BudgetMetaTracker.estimateTokens(epic.getDescription())
                    + capturedDecisionTokens(capturedDecisions));
        }
        FeatureBlock featureBlock = null;
        if (feature != null) {
            String summary = oneSentenceSummary(feature.getDescription());
            featureBlock = new FeatureBlock(feature.getId(), feature.getTitle(), summary);
            tracker.reserveCrossStoryNonTrimmable(
                BudgetMetaTracker.estimateTokens(feature.getTitle())
                    + BudgetMetaTracker.estimateTokens(summary));
        }
        InitiativeBlock initiativeBlock = null;
        if (initiative != null) {
            String summary = oneSentenceSummary(initiative.getDescription());
            initiativeBlock = new InitiativeBlock(initiative.getId(), initiative.getTitle(), summary);
            tracker.reserveCrossStoryNonTrimmable(
                BudgetMetaTracker.estimateTokens(initiative.getTitle())
                    + BudgetMetaTracker.estimateTokens(summary));
        }

        if (epicBlock == null && featureBlock == null && initiativeBlock == null) {
            return null;
        }
        return new ParentRollup(epicBlock, featureBlock, initiativeBlock);
    }

    private WorkItemEntity lookupParent(UUID projectId, UUID parentId) {
        if (parentId == null) return null;
        try {
            return workItemRepository.findByIdAndProjectId(parentId, projectId).orElse(null);
        } catch (RuntimeException e) {
            log.warn(
                "[diag-ams] spec_generation cross_story_load_parent_fail projectId={} reason={}",
                shortPrefix(projectId), e.getMessage());
            return null;
        }
    }

    private List<CapturedDecision> loadCapturedDecisions(UUID projectId, UUID epicWorkItemId) {
        if (epicWorkItemId == null) return Collections.emptyList();
        try {
            List<EpicCapturedDecisionEntity> rows = epicCapturedDecisionRepository
                .findByProjectIdAndEpicWorkItemIdAndStatusIn(
                    projectId, epicWorkItemId, EPIC_DECISION_FEED_STATUSES);
            if (rows == null || rows.isEmpty()) return Collections.emptyList();
            List<CapturedDecision> out = new ArrayList<>();
            for (EpicCapturedDecisionEntity r : rows) {
                if (r == null) continue;
                out.add(new CapturedDecision(
                    r.getId(),
                    r.getDecisionKey(),
                    r.getDecisionText(),
                    r.getStatus(),
                    r.getSource()
                ));
            }
            return out;
        } catch (RuntimeException e) {
            log.warn(
                "[diag-ams] spec_generation cross_story_load_captured_decisions_fail "
                    + "projectId={} reason={}",
                shortPrefix(projectId), e.getMessage());
            return Collections.emptyList();
        }
    }

    private static int capturedDecisionTokens(List<CapturedDecision> decisions) {
        if (decisions == null || decisions.isEmpty()) return 0;
        int total = 0;
        for (CapturedDecision d : decisions) {
            total += BudgetMetaTracker.estimateTokens(d.decisionKey());
            total += BudgetMetaTracker.estimateTokens(d.decisionText());
        }
        return total;
    }

    private static String oneSentenceSummary(String text) {
        if (text == null || text.isEmpty()) return null;
        String trimmed = text.trim();
        int end = trimmed.length();
        for (int i = 0; i < trimmed.length(); i++) {
            char c = trimmed.charAt(i);
            if (c == '.' || c == '!' || c == '?' || c == '\n') {
                end = i + 1;
                break;
            }
        }
        return trimmed.substring(0, end).trim();
    }

    /**
     * Build the workstream-deduped {@code workstream_context} block.
     *
     * <p>For v1 the dedupe scope is the current architecture's API behaviour
     * baselines and architecture mappings (the same loaders the per-story
     * blocks use). Each entry carries {@code referencedByStoryIds[]} -- when
     * a {@code passOneSpecIdsInScope[]} list is supplied the resolver attempts
     * to attribute each ref to the stories that originally referenced it via
     * their evidence/focused-context refs; without that scope list the
     * referencedByStoryIds list is left empty (the gateway is the canonical
     * referrer-attribution authority once it sees the per-story payloads).</p>
     */
    WorkstreamContext buildWorkstreamContext(
            UUID projectId,
            MigrationSpecContextRequestDto request,
            BudgetMetaTracker tracker) {
        UUID currentArch = request.currentArchitectureId();
        if (currentArch == null) {
            return null;
        }

        // API baselines -- dedupe by id.
        List<ApiBehaviourBaselineEntity> baselines = loadBaselines(
            projectId, currentArch, request.maxBaselineItemsOrDefault());
        Map<String, DedupedRef> baselineMap = new LinkedHashMap<>();
        for (ApiBehaviourBaselineEntity b : baselines) {
            if (b.getId() == null) continue;
            String id = b.getId().toString();
            String label = b.getName() != null ? b.getName() : id;
            baselineMap.putIfAbsent(id, new DedupedRef(
                id, "api_behaviour_baseline", label, attributeReferrers(id, request)));
        }

        // Architecture mappings -- dedupe by mapping id. Useful as architecture
        // refs surfaced once per workstream.
        Map<String, DedupedRef> archMap = new LinkedHashMap<>();
        List<ArchitectureElementMappingEntity> mappings = loadMappings(
            projectId, currentArch, request.targetArchitectureId());
        for (ArchitectureElementMappingEntity m : mappings) {
            if (m.getId() == null) continue;
            String id = m.getId().toString();
            String label = (m.getSourceElementType() == null ? "" : m.getSourceElementType())
                + "->" + (m.getTargetElementType() == null ? "" : m.getTargetElementType());
            archMap.putIfAbsent(id, new DedupedRef(
                id, "architecture_mapping", label, attributeReferrers(id, request)));
        }

        if (baselineMap.isEmpty() && archMap.isEmpty()) {
            return null;
        }

        List<DedupedRef> apiBaselineList = new ArrayList<>(baselineMap.values());
        List<DedupedRef> archRefList = new ArrayList<>(archMap.values());
        // Token accounting for workstream context goes against the cross-story
        // budget (non-trimmable in v1 -- workstream context is the whole point
        // of the dedupe pass).
        tracker.reserveCrossStoryNonTrimmable(dedupedRefTokens(apiBaselineList));
        tracker.reserveCrossStoryNonTrimmable(dedupedRefTokens(archRefList));
        return new WorkstreamContext(apiBaselineList, archRefList);
    }

    /**
     * Best-effort referrer attribution. When the caller supplied
     * {@code passOneSpecIdsInScope[]} the resolver consults each row's
     * {@code evidence_refs_json} / {@code focused_context_refs_json} to find
     * which siblings referenced this id. Without the scope list (or on lookup
     * failure) we return an empty list -- the gateway can finish the
     * attribution itself when it has the full per-story payload set.
     */
    private List<UUID> attributeReferrers(
            String refId, MigrationSpecContextRequestDto request) {
        List<UUID> scope = request.passOneSpecIdsInScope();
        if (scope == null || scope.isEmpty()) return Collections.emptyList();
        List<UUID> out = new ArrayList<>();
        for (UUID specId : scope) {
            if (specId == null) continue;
            try {
                Optional<MigrationStorySpecGenerationEntity> opt =
                    specGenerationRepository.findById(specId);
                if (opt.isEmpty()) continue;
                MigrationStorySpecGenerationEntity row = opt.get();
                if (referencesId(row.getEvidenceRefsJson(), refId)
                    || referencesId(row.getFocusedContextRefsJson(), refId)) {
                    if (row.getWorkItemId() != null && !out.contains(row.getWorkItemId())) {
                        out.add(row.getWorkItemId());
                    }
                }
            } catch (RuntimeException e) {
                // tolerate per-row lookup failure
            }
        }
        return out;
    }

    private static boolean referencesId(List<String> evidenceRefs, String refId) {
        if (evidenceRefs == null || refId == null) return false;
        for (String r : evidenceRefs) {
            if (refId.equals(r)) return true;
        }
        return false;
    }

    private static boolean referencesId(Map<String, Object> refs, String refId) {
        if (refs == null || refId == null) return false;
        for (Object v : refs.values()) {
            if (v == null) continue;
            if (refId.equals(v.toString())) return true;
            if (v instanceof List<?> list) {
                for (Object item : list) {
                    if (item != null && refId.equals(item.toString())) return true;
                }
            }
        }
        return false;
    }

    private static int dedupedRefTokens(List<DedupedRef> refs) {
        if (refs == null || refs.isEmpty()) return 0;
        int total = 0;
        for (DedupedRef r : refs) {
            total += BudgetMetaTracker.estimateTokens(r.id());
            total += BudgetMetaTracker.estimateTokens(r.kind());
            total += BudgetMetaTracker.estimateTokens(r.label());
        }
        return total;
    }

    // -----------------------------------------------------------------------
    // Loaders
    // -----------------------------------------------------------------------

    private List<ArchitectureElementMappingEntity> loadMappings(
            UUID projectId, UUID currentArchId, UUID targetArchId) {
        if (currentArchId == null || targetArchId == null) {
            return Collections.emptyList();
        }
        try {
            return architectureElementMappingRepository
                .findByProjectIdAndSourceArchitectureIdAndTargetArchitectureId(
                    projectId, currentArchId, targetArchId);
        } catch (RuntimeException e) {
            log.warn(
                "[diag-ams] spec_generation focused_context_load_mappings_fail projectId={} reason={}",
                shortPrefix(projectId), e.getMessage());
            return Collections.emptyList();
        }
    }

    private List<ApiBehaviourBaselineEntity> loadBaselines(
            UUID projectId, UUID currentArchId, int max) {
        if (currentArchId == null) {
            return Collections.emptyList();
        }
        try {
            List<ApiBehaviourBaselineEntity> all = apiBehaviourBaselineRepository
                .findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(projectId, currentArchId);
            if (max > 0 && all.size() > max) {
                return new ArrayList<>(all.subList(0, max));
            }
            return all;
        } catch (RuntimeException e) {
            log.warn(
                "[diag-ams] spec_generation focused_context_load_baselines_fail projectId={} reason={}",
                shortPrefix(projectId), e.getMessage());
            return Collections.emptyList();
        }
    }

    private List<DiscoveryFindingEntity> loadFindings(
            UUID projectId, UUID currentArchId, int max) {
        if (currentArchId == null) {
            return Collections.emptyList();
        }
        try {
            // Filters out diff-sourced findings (api_behaviour_diff_id set,
            // run_id null). The resolver reads f.getRunId() directly into
            // MigrationDiscoveryContextDto.FindingHighlight.runId; a null
            // would NPE downstream or render "Run: -" garbage in spec
            // context templates. Revisit in v2 if migration specs want
            // API-drift findings as context (accepted Q7).
            //
            // Reject-suppression (Spec 2, Task Group 2): ALSO exclude `rejected`
            // findings so every per-story block builder (buildServiceBlock /
            // buildApiBlock / buildSoapBlock / buildDataBlock / buildTestPackBlock
            // via boundedFindings) never sees rejected IR. `deferred` stays
            // visible. Keyed on the LIVE review_status column -- no schema change,
            // no IR mutation.
            List<DiscoveryFindingEntity> all = discoveryFindingRepository
                .findByProjectIdAndArchitectureIdAndRunIdNotNullAndReviewStatusNot(
                    projectId, currentArchId, "rejected");
            if (max > 0 && all.size() > max) {
                return new ArrayList<>(all.subList(0, max));
            }
            return all;
        } catch (RuntimeException e) {
            // Some test profiles don't wire the finding repository fully; we
            // tolerate that here and surface "no findings" rather than 5xx-ing.
            log.warn(
                "[diag-ams] spec_generation focused_context_load_findings_fail projectId={} reason={}",
                shortPrefix(projectId), e.getMessage());
            return Collections.emptyList();
        }
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private static List<Map<String, Object>> mappingsFilteredByType(
            List<ArchitectureElementMappingEntity> mappings, Set<String> matchingTypes) {
        if (mappings == null || mappings.isEmpty()) return Collections.emptyList();
        List<Map<String, Object>> out = new ArrayList<>();
        for (ArchitectureElementMappingEntity m : mappings) {
            String sourceType = m.getSourceElementType() == null
                ? "" : m.getSourceElementType().toLowerCase(Locale.ROOT);
            String targetType = m.getTargetElementType() == null
                ? "" : m.getTargetElementType().toLowerCase(Locale.ROOT);
            boolean matches = false;
            for (String t : matchingTypes) {
                if (sourceType.contains(t) || targetType.contains(t)) {
                    matches = true;
                    break;
                }
            }
            if (matches) {
                out.add(toMappingMap(m));
            }
        }
        return out;
    }

    private static Map<String, Object> toMappingMap(ArchitectureElementMappingEntity m) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", m.getId() == null ? null : m.getId().toString());
        out.put("sourceElementType", m.getSourceElementType());
        out.put("sourceElementId", m.getSourceElementId());
        out.put("targetElementType", m.getTargetElementType());
        out.put("targetElementId", m.getTargetElementId());
        out.put("mappingType", m.getMappingType());
        out.put("status", m.getStatus());
        out.put("confidence", m.getConfidence());
        return out;
    }

    private static List<Map<String, Object>> boundedFindings(
            List<DiscoveryFindingEntity> findings, Set<String> matchingTypes, int max) {
        if (findings == null || findings.isEmpty()) return Collections.emptyList();
        List<Map<String, Object>> out = new ArrayList<>();
        for (DiscoveryFindingEntity f : findings) {
            if (matchesAny(f, matchingTypes)) {
                out.add(toFindingMap(f));
                if (max > 0 && out.size() >= max) {
                    break;
                }
            }
        }
        return out;
    }

    private static boolean matchesAny(DiscoveryFindingEntity f, Set<String> matchingTypes) {
        String type = f.getFindingType() == null ? "" : f.getFindingType().toLowerCase(Locale.ROOT);
        String category = f.getCategory() == null ? "" : f.getCategory().toLowerCase(Locale.ROOT);
        String src = f.getSource() == null ? "" : f.getSource().toLowerCase(Locale.ROOT);
        for (String t : matchingTypes) {
            if (type.contains(t) || category.contains(t) || src.contains(t)) {
                return true;
            }
        }
        return false;
    }

    private static Map<String, Object> toFindingMap(DiscoveryFindingEntity f) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", f.getId() == null ? null : f.getId().toString());
        out.put("findingType", f.getFindingType());
        out.put("category", f.getCategory());
        out.put("severity", f.getSeverity());
        out.put("status", f.getReviewStatus());
        out.put("title", f.getTitle());
        out.put("summary", f.getSummary());
        out.put("source", f.getSource());
        return out;
    }

    private static void aggregateMissing(List<MissingInput> top, List<MissingInput> block) {
        if (block == null || block.isEmpty()) return;
        for (MissingInput mi : block) {
            if (mi != null) top.add(mi);
        }
    }

    private static <T> List<T> nullSafeList(List<T> list) {
        return list == null ? Collections.emptyList() : list;
    }

    private static String shortPrefix(UUID id) {
        if (id == null) return "00000000";
        String s = id.toString();
        return s.substring(0, Math.min(8, s.length()));
    }

    // Convenience for tests that need to grab the set of known context types.
    public static Set<String> knownContextTypes() {
        return KNOWN_CONTEXT_TYPES;
    }

    // Visible for test convenience -- avoids reflection in unit tests.
    public Optional<WorkItemEntity> findWorkItem(UUID projectId, UUID workItemId) {
        return workItemRepository.findByIdAndProjectId(workItemId, projectId);
    }
}
