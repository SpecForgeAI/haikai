package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.jackson.CamelCaseWire;
import com.example.architecturemodel.mapper.MigrationStorySpecGenerationMapper;
import com.example.architecturemodel.model.dto.MigrationStorySpecGenerationDto;
import com.example.architecturemodel.model.entity.GeneratedMigrationBookOfWorkEntity;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationConfidence;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationEntity;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationStatus;
import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.example.architecturemodel.repository.entity.GeneratedMigrationBookOfWorkRepository;
import com.example.architecturemodel.repository.entity.MigrationStorySpecGenerationRepository;
import com.example.architecturemodel.repository.entity.WorkItemRepository;
import com.example.architecturemodel.service.quality.SpecQualityScorer;
import com.example.architecturemodel.util.ShapeSpecHeadingParser;
import com.example.architecturemodel.util.ShapeSpecHeadingParser.ParseResult;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Service for the spec-generation persistence path-B endpoints (Group 8).
 *
 * <p>Wraps {@link MigrationStorySpecGenerationRepository} with the gateway-facing
 * batch + list + update + summary surface required by Spec 2. Manual-edit
 * protection (acceptance signal 17) is enforced inside
 * {@link #updateRow(UUID, UUID, MigrationStorySpecGenerationService.UpdateRowRequest)} and the
 * per-row branch of {@link #persistBatchResults(UUID, UUID, List)}.</p>
 *
 * <p>Failure isolation (R-12): the batch persistence path catches every per-row
 * exception and accumulates it into the response's
 * {@code resultsCouldNotPersist} bucket so the gateway can surface unpersisted
 * results inline.</p>
 *
 * <p>Lazy {@code not_attempted} (A-6): the summary endpoint computes
 * {@code notAttempted = totalSavedStories - attemptedRows}; no row is ever
 * persisted with {@code status='not_attempted'}.</p>
 *
 * <p>Spec: PM Migration Shape-Spec Batch Generation (2026-05-19) -- Task Group 8.</p>
 *
 * <p><b>Cross-Story Context Injection extension (2026-05-20, Task Group 2):</b>
 * the persistence write path invokes {@link ShapeSpecHeadingParser} on every
 * incoming {@code generatedSpecText} and populates the structured
 * {@code decisions_json} / {@code interfaces_json} / {@code assumptions_json}
 * columns. Parser warnings (e.g. {@code parser_missing_heading}) are appended
 * to {@code warnings_json}. The parser is the single canonical source for
 * structured sibling fields; the resolver never re-parses spec text at
 * request time. Parser failures NEVER block persistence of the spec text
 * itself.</p>
 *
 * <p><b>Missing Input Resolver Flow extension (2026-05-20, Task Group 3.4):</b>
 * when the persistence write path receives a row with
 * {@code status='insufficient_context'} and a structured
 * {@code missing_inputs_json}, it walks the items and hashes each v1-type
 * entry ({@code api_contract} / {@code mapping} / {@code target_element}) via
 * {@link MissingInputKeyHasher}, then writes the resulting list of stable
 * 16-hex-char keys to {@code missing_input_keys_json}. Out-of-v1 entries
 * (decisions / baselines / etc.) NEVER produce a key. This is the canonical
 * source of truth for the cross-story matcher (Task Group 3.2) -- without
 * this hook the matcher returns nothing.</p>
 *
 * <p><b>Spec Quality Scoring extension (2026-05-20, Task Group 3):</b>
 * persist time invokes {@link SpecQualityScorer} on every row whose
 * {@code status} is NOT {@code insufficient_context} or {@code failed},
 * AFTER the parser hook and the missing-input-keys hook, BEFORE
 * {@code repository.save(...)}. The scorer's output populates the four
 * quality columns ({@code quality_score}, {@code quality_grade},
 * {@code quality_dimensions_json}, {@code previous_quality_score}). For
 * {@code insufficient_context} / {@code failed} rows scoring is SKIPPED and
 * all four columns are set to {@code null} -- we do not want to falsely lump
 * these rows in with F-graded specs that DO have content. On overwrite, the
 * row's pre-overwrite {@code quality_score} is captured into
 * {@code previous_quality_score} BEFORE the new score is written so the
 * drawer delta chip has a single immediately-previous value to compare
 * against. Scoring failures NEVER block persistence: any thrown exception is
 * logged at WARN, all four quality fields are nulled, and a
 * {@code quality_scoring_error} entry is appended to {@code warnings_json}.</p>
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@Slf4j
public class MigrationStorySpecGenerationService {

    /**
     * Producer task id for this generator. When the persisted row's
     * {@code createdByTask} differs from this value the manual-edit protection
     * gate fires on overwrite attempts (acceptance signal 17).
     */
    public static final String GENERATOR_TASK_ID =
        "product-manager--migration-shape-spec-generation";

    private static final int DEFAULT_BATCH_SIZE = 25;

    /**
     * v1 missing-input type values that produce a stable key. Out-of-v1 types
     * (decisions, baselines, etc.) are ignored at hash time. Mirrors the
     * allowed types on the {@code missing_input_resolutions} table CHECK
     * constraint {@code chk_mir_type}.
     */
    private static final String MISSING_INPUT_TYPE_API_CONTRACT = "api_contract";
    private static final String MISSING_INPUT_TYPE_MAPPING = "mapping";
    private static final String MISSING_INPUT_TYPE_TARGET_ELEMENT = "target_element";

    /**
     * Stable warning kind appended to {@code warnings_json} when the quality
     * scorer throws an exception. Persistence proceeds with all four quality
     * columns NULL; the warning surfaces the failure for operator audit.
     */
    private static final String WARNING_KIND_QUALITY_SCORING_ERROR =
        "quality_scoring_error";

    private final MigrationStorySpecGenerationRepository repository;
    private final GeneratedMigrationBookOfWorkRepository bookOfWorkRepository;
    private final WorkItemRepository workItemRepository;
    private final ShapeSpecHeadingParser shapeSpecHeadingParser;
    private final MissingInputKeyHasher missingInputKeyHasher;
    private final SpecQualityScorer specQualityScorer;

    @org.springframework.beans.factory.annotation.Autowired
    public MigrationStorySpecGenerationService(
            MigrationStorySpecGenerationRepository repository,
            GeneratedMigrationBookOfWorkRepository bookOfWorkRepository,
            WorkItemRepository workItemRepository,
            ShapeSpecHeadingParser shapeSpecHeadingParser,
            MissingInputKeyHasher missingInputKeyHasher,
            SpecQualityScorer specQualityScorer) {
        this.repository = repository;
        this.bookOfWorkRepository = bookOfWorkRepository;
        this.workItemRepository = workItemRepository;
        this.shapeSpecHeadingParser = shapeSpecHeadingParser;
        this.missingInputKeyHasher = missingInputKeyHasher;
        this.specQualityScorer = specQualityScorer;
    }

    /**
     * Back-compat constructor for tests / callers that predate the
     * {@link SpecQualityScorer} dependency (Task Group 3 -- spec
     * 2026-05-20-spec-quality-scoring). Falls back to a fresh scorer instance --
     * the scorer is stateless and deterministic so this is safe. New callers
     * should prefer the 6-arg constructor; the Spring DI graph wires the
     * 6-arg form automatically.
     */
    public MigrationStorySpecGenerationService(
            MigrationStorySpecGenerationRepository repository,
            GeneratedMigrationBookOfWorkRepository bookOfWorkRepository,
            WorkItemRepository workItemRepository,
            ShapeSpecHeadingParser shapeSpecHeadingParser,
            MissingInputKeyHasher missingInputKeyHasher) {
        this(repository, bookOfWorkRepository, workItemRepository,
            shapeSpecHeadingParser, missingInputKeyHasher, new SpecQualityScorer());
    }

    /**
     * Back-compat constructor for tests / callers that predate the
     * {@link MissingInputKeyHasher} dependency (Task Group 3.4). Falls back to
     * fresh hasher + scorer instances -- both are stateless and deterministic
     * so this is safe. New callers should prefer the 6-arg constructor; the
     * Spring DI graph wires the 6-arg form automatically.
     */
    public MigrationStorySpecGenerationService(
            MigrationStorySpecGenerationRepository repository,
            GeneratedMigrationBookOfWorkRepository bookOfWorkRepository,
            WorkItemRepository workItemRepository,
            ShapeSpecHeadingParser shapeSpecHeadingParser) {
        this(repository, bookOfWorkRepository, workItemRepository,
            shapeSpecHeadingParser, new MissingInputKeyHasher(), new SpecQualityScorer());
    }

    // -----------------------------------------------------------------------
    // Batch persistence (R-12 partial-failure tolerance)
    // -----------------------------------------------------------------------

    /**
     * Persist a batch of per-story generation results. Each row is inserted in
     * isolation; a row-level failure does NOT abort the batch. The response
     * surfaces {@code persistedCount}, {@code resultsCouldNotPersist}, and
     * per-row diagnostics so the gateway can render unpersisted failures
     * inline.
     */
    @Transactional
    public BatchPersistResult persistBatchResults(
        UUID projectId, UUID bookId, List<MigrationStorySpecGenerationDto> batchResults) {
        requireBookOfWork(projectId, bookId);
        if (batchResults == null) batchResults = List.of();

        int persisted = 0;
        int couldNotPersist = 0;
        List<MigrationStorySpecGenerationDto> persistedDtos = new ArrayList<>();
        List<PerRowError> errors = new ArrayList<>();

        for (int i = 0; i < batchResults.size(); i++) {
            MigrationStorySpecGenerationDto dto = batchResults.get(i);
            try {
                MigrationStorySpecGenerationDto persistedDto =
                    persistOne(projectId, bookId, dto);
                persistedDtos.add(persistedDto);
                persisted++;
            } catch (RuntimeException ex) {
                couldNotPersist++;
                String wid = dto == null || dto.workItemId() == null
                    ? "<null>" : dto.workItemId().toString();
                errors.add(new PerRowError(wid, dto == null ? null : dto.status(),
                    ex.getMessage(), i));
                log.warn(
                    "[diag-ams] spec_generation batch_persist_row_fail bookId={} index={} workItemId={} reason={}",
                    shortPrefix(bookId), i, wid, ex.getMessage());
            }
        }
        log.info(
            "[diag-ams] spec_generation batch_persisted bookOfWorkId={} received={} persistedCount={} resultsCouldNotPersist={}",
            shortPrefix(bookId), batchResults.size(), persisted, couldNotPersist);
        return new BatchPersistResult(persisted, couldNotPersist, persistedDtos, errors);
    }

    private MigrationStorySpecGenerationDto persistOne(
        UUID projectId, UUID bookId, MigrationStorySpecGenerationDto dto) {
        if (dto == null) {
            throw new IllegalArgumentException("per-story result is null");
        }
        if (dto.workItemId() == null) {
            throw new IllegalArgumentException("workItemId is required");
        }
        if (dto.status() == null || !MigrationStorySpecGenerationStatus.ALL.contains(dto.status())) {
            throw new IllegalArgumentException(
                "Invalid status '" + dto.status() + "'; allowed: "
                    + MigrationStorySpecGenerationStatus.ALL);
        }
        if (dto.confidence() != null
                && !MigrationStorySpecGenerationConfidence.ALL.contains(dto.confidence())) {
            throw new IllegalArgumentException(
                "Invalid confidence '" + dto.confidence() + "'; allowed: "
                    + MigrationStorySpecGenerationConfidence.ALL);
        }
        // WorkItem must exist + belong to project (R-9 FK source-of-truth).
        Optional<WorkItemEntity> workItemOpt =
            workItemRepository.findByIdAndProjectId(dto.workItemId(), projectId);
        if (workItemOpt.isEmpty()) {
            throw new IllegalArgumentException(
                "WorkItem not found in project " + projectId + ": " + dto.workItemId());
        }
        String storyTitle = workItemOpt.get().getTitle();

        // Upsert per work_item_id within this book. In the lazy single-row
        // model there's at most one existing row per workItemId; the upsert
        // honours manual-edit protection on overwrite.
        List<MigrationStorySpecGenerationEntity> existing =
            repository.findByWorkItemId(dto.workItemId());

        MigrationStorySpecGenerationEntity target = existing.stream()
            .filter(e -> bookId.equals(e.getBookOfWorkId()))
            .findFirst()
            .orElse(null);

        if (target == null && !existing.isEmpty()) {
            // No row tied to this book yet, but rows for other books exist;
            // create a new row scoped to the requested book.
            target = null;
        }

        Instant now = Instant.now();
        if (target == null) {
            MigrationStorySpecGenerationEntity entity =
                MigrationStorySpecGenerationMapper.toNewEntity(
                    new MigrationStorySpecGenerationDto(
                        dto.id() != null ? dto.id() : UUID.randomUUID(),
                        projectId,
                        dto.workItemId(),
                        bookId,
                        dto.bookItemId(),
                        dto.status(),
                        dto.confidence(),
                        dto.predictedReadiness(),
                        dto.generatedSpecText(),
                        dto.warningsJson(),
                        dto.missingInputsJson(),
                        dto.focusedContextRefsJson(),
                        dto.evidenceRefsJson(),
                        dto.generatedAt(),
                        dto.errorMessage(),
                        dto.generationAttemptNumber() != null
                            ? dto.generationAttemptNumber() : 1,
                        dto.createdByTask() != null
                            ? dto.createdByTask() : GENERATOR_TASK_ID,
                        null, // createdAt -- defaulted by mapper/@PrePersist
                        null, // updatedAt -- defaulted by mapper/@PrePersist
                        // Manual-edit fields: a fresh batch-create row is never
                        // manually edited; mapper/entity mirror the DB default.
                        Boolean.FALSE, null, null, null,
                        // Implementation-Ready fields (2026-06-14, D6/D9):
                        // carry the structured test pack + endpoint-coverage
                        // groundwork through the batch-create path so a brand
                        // new row persists them (the update branch already
                        // null-guards them through updateEntityFromDto).
                        dto.structuredTestsJson(),
                        dto.coveredEndpointIds()
                    ),
                    projectId);
            // Parser is invoked at write time; populates decisions/interfaces/
            // assumptions JSONB columns and appends warnings. NEVER blocks
            // persistence (Task Group 2.3 -- spec 2026-05-20).
            applyShapeSpecParserOutput(entity);
            // Missing-input key population for insufficient_context rows.
            // NEVER throws; populates missing_input_keys_json with stable
            // 16-hex-char keys for every v1-type missing input (Task 3.4).
            populateMissingInputKeys(entity);
            // Quality scoring (Spec Quality Scoring, Task Group 3 --
            // 2026-05-20). Fresh-insert: no prior quality score exists, so
            // previous_quality_score stays null for the first scored write.
            applyQualityScoring(entity, storyTitle, /*priorScore*/ null);
            MigrationStorySpecGenerationEntity saved = repository.save(entity);
            return MigrationStorySpecGenerationMapper.toDto(saved);
        }

        // Existing row -- enforce manual-edit protection on overwrite.
        boolean manuallyEdited = isManuallyEdited(target);
        boolean confirmOverwrite = false; // batch flow never overrides; explicit PUT path is the override route
        if (manuallyEdited && !confirmOverwrite) {
            throw new IllegalStateException("manual_edit_protected");
        }
        // Capture the pre-overwrite quality_score BEFORE the mapper rewrites
        // any field. Drives previous_quality_score on the post-write row.
        Integer priorQualityScore = target.getQualityScore();
        MigrationStorySpecGenerationMapper.updateEntityFromDto(target, dto);
        // Re-parse the (possibly-updated) spec text. The mapper will have set
        // generatedSpecText when the PATCH carries one; the parser refreshes
        // the structured columns to match.
        applyShapeSpecParserOutput(target);
        // Re-derive the missing-input keys from the (possibly-updated)
        // missing_inputs_json. Idempotent and side-effect-free for non-
        // insufficient_context rows.
        populateMissingInputKeys(target);
        // Re-score the (possibly-updated) row. The prior score (captured
        // before the mapper ran) seeds previous_quality_score. For
        // insufficient_context / failed status rows scoring is skipped and
        // all four quality columns are nulled, but previous_quality_score
        // is still set to the prior value so the drawer has a historical
        // anchor for delta-chip rendering.
        applyQualityScoring(target, storyTitle, priorQualityScore);
        // Always bump attempt # by 1 on upsert through the batch path (R-8),
        // since the batch flow comes from a generate or regenerate-all run.
        Integer prior = target.getGenerationAttemptNumber();
        target.setGenerationAttemptNumber((prior == null ? 0 : prior) + 1);
        // Clear the stale flag whenever a successful regeneration overwrites a
        // previously-stale row (Target Architecture Authoring Flow spec, Task
        // Group 9). The batch persist path is the only entry point the
        // dashboard's 'Regenerate stale specs' action exercises, so this
        // clear-on-success keeps the stale-spec count + indicator coherent
        // without forcing the gateway / frontend to send an explicit clear.
        // Only successful statuses clear stale: a row that re-fails or comes
        // back as insufficient_context retains its stale flag so the user
        // can see it still needs attention.
        if (MigrationStorySpecGenerationStatus.SUCCESSFULLY_GENERATED.contains(dto.status())) {
            target.setStale(Boolean.FALSE);
            target.setStaleMarkedAt(null);
            // Per spec.md line 41-42: stale + stale_reason are cleared
            // together on successful regeneration. Without this clear the
            // dashboard chip would still render "stale: resolution_reset"
            // on a freshly-regenerated row.
            target.setStaleReason(null);
        }
        target.setUpdatedAt(now);
        return MigrationStorySpecGenerationMapper.toDto(repository.save(target));
    }

    // -----------------------------------------------------------------------
    // Listings
    // -----------------------------------------------------------------------

    /**
     * List spec-generation rows for a given book of work.
     */
    @Transactional(readOnly = true)
    public List<MigrationStorySpecGenerationDto> listByBookOfWork(UUID projectId, UUID bookId) {
        requireBookOfWork(projectId, bookId);
        return repository.findByBookOfWorkIdOrderByCreatedAtAsc(bookId).stream()
            .filter(e -> projectId.equals(e.getProjectId()))
            .map(MigrationStorySpecGenerationMapper::toDto)
            .toList();
    }

    /**
     * List spec-generation rows for a single WorkItem. Returned ordered by
     * attempt number ascending so the most recent (highest-numbered) attempt
     * is last -- gives the UI a stable history shape.
     */
    @Transactional(readOnly = true)
    public List<MigrationStorySpecGenerationDto> listByWorkItem(UUID projectId, UUID workItemId) {
        if (workItemRepository.findByIdAndProjectId(workItemId, projectId).isEmpty()) {
            throw new ResourceNotFoundException(
                "WorkItem not found in project " + projectId + ": " + workItemId);
        }
        List<MigrationStorySpecGenerationEntity> rows = new ArrayList<>(
            repository.findByWorkItemId(workItemId));
        rows.removeIf(e -> !projectId.equals(e.getProjectId()));
        rows.sort(Comparator.comparing(
            e -> e.getGenerationAttemptNumber() == null ? 0 : e.getGenerationAttemptNumber()));
        return rows.stream().map(MigrationStorySpecGenerationMapper::toDto).toList();
    }

    // -----------------------------------------------------------------------
    // Stale-spec dashboard surface (Target Architecture Authoring Flow,
    // Task Group 9).
    // -----------------------------------------------------------------------

    /**
     * Project-scoped stale-spec count + WorkItem id list for the Migration
     * Delivery Dashboard.
     */
    @Transactional(readOnly = true)
    public StaleSpecSummary getStaleSpecSummary(UUID projectId) {
        if (projectId == null) {
            return new StaleSpecSummary(0, List.of());
        }
        List<MigrationStorySpecGenerationEntity> rows =
            repository.findByProjectIdAndStaleTrue(projectId);
        if (rows == null || rows.isEmpty()) {
            return new StaleSpecSummary(0, List.of());
        }
        List<String> ids = new ArrayList<>(rows.size());
        for (MigrationStorySpecGenerationEntity row : rows) {
            if (row.getWorkItemId() != null) {
                ids.add(row.getWorkItemId().toString());
            }
        }
        log.debug(
            "[diag-ams] spec_generation stale_summary project={} staleCount={}",
            shortPrefix(projectId), rows.size());
        return new StaleSpecSummary(rows.size(), ids);
    }

    // -----------------------------------------------------------------------
    // Quality recompute (Spec Quality Scoring -- Task Group 4)
    // -----------------------------------------------------------------------

    @Transactional
    public RecomputeQualityResult recomputeQualityForSpec(UUID projectId, UUID specId) {
        if (projectId == null || specId == null) {
            throw new ResourceNotFoundException(
                "Spec generation row not found: " + specId);
        }
        MigrationStorySpecGenerationEntity entity = repository.findById(specId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "Spec generation row not found: " + specId));
        if (!projectId.equals(entity.getProjectId())) {
            throw new ResourceNotFoundException(
                "Spec generation row not in project " + projectId + ": " + specId);
        }

        String status = entity.getStatus();
        if (MigrationStorySpecGenerationStatus.INSUFFICIENT_CONTEXT.equals(status)
                || MigrationStorySpecGenerationStatus.FAILED.equals(status)) {
            return new RecomputeQualityResult(
                entity.getQualityScore(),
                entity.getQualityGrade(),
                entity.getQualityDimensionsJson(),
                entity.getPreviousQualityScore(),
                "N/A: no spec text to assess");
        }

        String storyTitle = null;
        if (entity.getWorkItemId() != null) {
            storyTitle = workItemRepository.findById(entity.getWorkItemId())
                .map(WorkItemEntity::getTitle)
                .orElse(null);
        }

        Integer priorScore = entity.getQualityScore();
        applyQualityScoring(entity, storyTitle, priorScore);
        entity.setUpdatedAt(Instant.now());
        MigrationStorySpecGenerationEntity saved = repository.save(entity);
        return new RecomputeQualityResult(
            saved.getQualityScore(),
            saved.getQualityGrade(),
            saved.getQualityDimensionsJson(),
            saved.getPreviousQualityScore(),
            null);
    }

    @Transactional
    public BulkRecomputeQualityResult bulkRecomputeQualityForProject(UUID projectId) {
        Map<String, Integer> grades = new LinkedHashMap<>();
        grades.put("A", 0);
        grades.put("B", 0);
        grades.put("C", 0);
        grades.put("D", 0);
        grades.put("F", 0);
        grades.put("na", 0);

        if (projectId == null) {
            return new BulkRecomputeQualityResult(0, 0, grades);
        }
        List<MigrationStorySpecGenerationEntity> rows =
            repository.findByProjectId(projectId);
        if (rows == null) rows = List.of();

        int totalScored = 0;
        int totalSkipped = 0;
        for (MigrationStorySpecGenerationEntity row : rows) {
            String status = row.getStatus();
            if (MigrationStorySpecGenerationStatus.INSUFFICIENT_CONTEXT.equals(status)
                    || MigrationStorySpecGenerationStatus.FAILED.equals(status)) {
                totalSkipped++;
                grades.merge("na", 1, Integer::sum);
                continue;
            }
            String storyTitle = null;
            if (row.getWorkItemId() != null) {
                storyTitle = workItemRepository.findById(row.getWorkItemId())
                    .map(WorkItemEntity::getTitle)
                    .orElse(null);
            }
            Integer priorScore = row.getQualityScore();
            applyQualityScoring(row, storyTitle, priorScore);
            row.setUpdatedAt(Instant.now());
            MigrationStorySpecGenerationEntity saved = repository.save(row);
            totalScored++;
            String grade = saved.getQualityGrade();
            if (grade != null && grades.containsKey(grade)) {
                grades.merge(grade, 1, Integer::sum);
            } else {
                grades.merge("na", 1, Integer::sum);
            }
        }
        log.info(
            "[diag-ams] spec_generation quality_bulk_recompute project={} totalScored={} totalSkipped={} grades={}",
            shortPrefix(projectId), totalScored, totalSkipped, grades);
        return new BulkRecomputeQualityResult(totalScored, totalSkipped, grades);
    }

    // -----------------------------------------------------------------------
    // Update / overwrite (manual-edit protection -- acceptance signal 17)
    // -----------------------------------------------------------------------

    @Transactional
    public MigrationStorySpecGenerationDto updateRow(
        UUID projectId, UUID generationId, UpdateRowRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("request body is required");
        }
        MigrationStorySpecGenerationEntity entity = repository.findById(generationId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "Spec generation row not found: " + generationId));
        if (!projectId.equals(entity.getProjectId())) {
            throw new ResourceNotFoundException(
                "Spec generation row not in project " + projectId + ": " + generationId);
        }
        if (isManuallyEdited(entity) && !Boolean.TRUE.equals(request.confirmOverwrite())) {
            log.info("[diag-ams] spec_generation overwrite_rejected workItemId={} reason=manual_edit_protected",
                shortPrefix(entity.getWorkItemId()));
            throw new ManualEditProtectedException(
                "Refusing to overwrite manually-edited spec without confirmOverwrite=true");
        }
        MigrationStorySpecGenerationMapper.updateEntityFromDto(entity, request.patch());
        if (request.patch() != null && request.patch().generatedSpecText() != null) {
            applyShapeSpecParserOutput(entity);
        }
        if (request.patch() != null && request.patch().missingInputsJson() != null) {
            populateMissingInputKeys(entity);
        }
        if (request.patch() != null && request.patch().status() != null) {
            Integer prior = entity.getGenerationAttemptNumber();
            entity.setGenerationAttemptNumber((prior == null ? 0 : prior) + 1);
        }
        if (Boolean.TRUE.equals(request.confirmOverwrite())) {
            entity.setCreatedByTask(GENERATOR_TASK_ID);
        }
        entity.setUpdatedAt(Instant.now());
        return MigrationStorySpecGenerationMapper.toDto(repository.save(entity));
    }

    // -----------------------------------------------------------------------
    // Manual-edit save path (In-Product Spec Editor + Confirm-Overwrite,
    // Task Group 2 -- 2026-05-20)
    // -----------------------------------------------------------------------

    /**
     * Persist a user-authored manual edit against a single spec-generation
     * row. Mirrors the post-write pipeline from {@link #persistOne} so the
     * downstream parser / scorer columns stay coherent with LLM-generated
     * rows.
     *
     * <p>Behaviour:</p>
     * <ol>
     *   <li>404 (via {@link ResourceNotFoundException}) when the row does not
     *       exist, or when the row's {@code projectId} does not match the URL
     *       path variable. Cross-project access is never leaked.</li>
     *   <li>Copies the current {@code generatedSpecText} into
     *       {@code previousSpecText} BEFORE overwriting (single-slot prior-
     *       version history; drives the drawer's diff toggle).</li>
     *   <li>Sets {@code generatedSpecText = specText},
     *       {@code manuallyEdited = true},
     *       {@code lastManuallyEditedAt = Instant.now()},
     *       {@code lastManuallyEditedBy = editedBy} (sourced from
     *       {@code X-User-Id} request header on the controller).</li>
     *   <li>Re-runs {@link ShapeSpecHeadingParser} to refresh
     *       {@code decisionsJson} / {@code interfacesJson} /
     *       {@code assumptionsJson} so the drawer tabs match the new text.</li>
     *   <li>Re-runs {@link SpecQualityScorer} to refresh
     *       {@code qualityScore} / {@code qualityGrade} /
     *       {@code qualityDimensionsJson}; the prior score is captured into
     *       {@code previousQualityScore} BEFORE the new score lands so the
     *       drawer's grade-delta indicator has a single immediately-previous
     *       value to compare against. The scorer is SKIPPED for
     *       {@code insufficient_context} / {@code failed} rows per the
     *       existing rule; in that case the four quality columns are still
     *       nulled (and the prior score still captured), but the parser +
     *       audit fields are persisted normally.</li>
     * </ol>
     *
     * <p>Returns the full refreshed DTO so the frontend can replace the in-
     * memory spec row with one round-trip -- the drawer's grade chip, the
     * quality-breakdown panel, the decisions / interfaces / assumptions tabs,
     * and the hierarchy "Edited" chip all refresh from this response.</p>
     *
     * <p>Spec: In-Product Spec Editor + Confirm-Overwrite (2026-05-20) --
     * Task Group 2.</p>
     */
    @Transactional
    public MigrationStorySpecGenerationDto applyManualEdit(
            UUID projectId, UUID specId, String specText, String editedBy) {
        if (projectId == null || specId == null) {
            throw new ResourceNotFoundException(
                "Spec generation row not found: " + specId);
        }
        MigrationStorySpecGenerationEntity entity = repository.findById(specId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "Spec generation row not found: " + specId));
        if (!projectId.equals(entity.getProjectId())) {
            // Never leak ownership: cross-project access reads as 404 the
            // same way it does on the other AMS endpoints.
            throw new ResourceNotFoundException(
                "Spec generation row not in project " + projectId + ": " + specId);
        }

        // Capture the prior values BEFORE we overwrite anything. The
        // previous_spec_text slot is single-slot history (no edit log table);
        // the prior quality score drives previous_quality_score on the post-
        // write row.
        String priorSpecText = entity.getGeneratedSpecText();
        Integer priorQualityScore = entity.getQualityScore();

        // Apply the manual edit. The four manual-edit audit columns are set
        // here in one place so the persistence record is unambiguous.
        entity.setPreviousSpecText(priorSpecText);
        entity.setGeneratedSpecText(specText);
        entity.setManuallyEdited(Boolean.TRUE);
        entity.setLastManuallyEditedAt(Instant.now());
        entity.setLastManuallyEditedBy(editedBy);

        // D5 status-promotion fix (Spec: Net-new backlog items + provenance,
        // 2026-06-14, Spec 5 of 6 -- Task Group 1): a hand-authored spec is a
        // deliberate escape hatch, so when the supplied text is non-empty PROMOTE
        // status to `generated` (the dispatchable state) BEFORE scoring. Without
        // this an insufficient_context / failed row stays un-dispatchable even
        // after a human authored a complete spec on it (the latent bug: the four
        // audit columns + the text were overwritten but status was never set).
        // The promotion runs BEFORE applyQualityScoring so the now-`generated`
        // row scores NORMALLY (the scorer's skip-rule keys off entity.getStatus()
        // -- skipping only insufficient_context / failed). Empty text is left
        // alone: clearing a spec must not silently mark the row dispatchable.
        if (specText != null && !specText.isBlank()) {
            entity.setStatus(MigrationStorySpecGenerationStatus.GENERATED);
        }

        // Resolve the story title for the scorer input (used by some
        // dimensions). Best-effort: a missing WorkItem does not block the
        // save -- the scorer treats null story-title as an empty signal.
        String storyTitle = null;
        if (entity.getWorkItemId() != null) {
            storyTitle = workItemRepository.findById(entity.getWorkItemId())
                .map(WorkItemEntity::getTitle)
                .orElse(null);
        }

        // Refresh parser-derived columns from the new text. Mirrors the
        // persistOne / updateRow contract: parser invocation never blocks
        // persistence.
        applyShapeSpecParserOutput(entity);
        // Refresh quality columns. For insufficient_context / failed rows
        // the scorer is skipped (all four quality columns nulled) but the
        // prior score is still copied into previous_quality_score so the
        // historical anchor survives.
        applyQualityScoring(entity, storyTitle, priorQualityScore);

        entity.setUpdatedAt(Instant.now());
        log.info(
            "[diag-ams] spec_generation manual_edit_applied specId={} workItemId={} editedBy={}",
            shortPrefix(specId), shortPrefix(entity.getWorkItemId()), editedBy);
        return MigrationStorySpecGenerationMapper.toDto(repository.save(entity));
    }

    // -----------------------------------------------------------------------
    // Manually-edited-in-scope listing (Task Group 3.4 -- 2026-05-20)
    // -----------------------------------------------------------------------

    /**
     * Return the set of manually-edited spec-generation rows currently in
     * scope for a Generate-all run against a single Book of Work. Powers the
     * frontend's bulk-overwrite picker step 2 (the modal that surfaces "X
     * stories have been hand-edited -- which do you want to overwrite?").
     *
     * <p>Filters: only rows whose {@code manuallyEdited == true} AND whose
     * {@code bookOfWorkId} matches the supplied {@code bookId}. The book
     * itself must exist and belong to the supplied {@code projectId} or a
     * 404 ({@link ResourceNotFoundException}) is raised.</p>
     *
     * <p>The retry-batch flow re-uses the same shape by passing the
     * candidate work-item-id set to the controller, which filters the result
     * server-side via the optional {@code workItemIdsInScope} parameter.</p>
     *
     * <p>Spec: In-Product Spec Editor + Confirm-Overwrite (2026-05-20) --
     * Task Group 3.4.</p>
     */
    @Transactional(readOnly = true)
    public List<ManuallyEditedInScopeRow> listManuallyEditedInScope(
            UUID projectId, UUID bookId, java.util.Collection<UUID> workItemIdsInScope) {
        requireBookOfWork(projectId, bookId);
        List<MigrationStorySpecGenerationEntity> rows =
            repository.findByBookOfWorkIdOrderByCreatedAtAsc(bookId);
        List<ManuallyEditedInScopeRow> out = new ArrayList<>();
        java.util.Set<UUID> filter = (workItemIdsInScope == null || workItemIdsInScope.isEmpty())
            ? null
            : new java.util.HashSet<>(workItemIdsInScope);
        for (MigrationStorySpecGenerationEntity row : rows) {
            if (!projectId.equals(row.getProjectId())) continue;
            if (!Boolean.TRUE.equals(row.getManuallyEdited())) continue;
            if (filter != null && !filter.contains(row.getWorkItemId())) continue;
            String title = null;
            if (row.getWorkItemId() != null) {
                title = workItemRepository.findById(row.getWorkItemId())
                    .map(WorkItemEntity::getTitle)
                    .orElse(null);
            }
            out.add(new ManuallyEditedInScopeRow(
                row.getId(),
                row.getWorkItemId(),
                title,
                row.getLastManuallyEditedAt() == null
                    ? null : row.getLastManuallyEditedAt().toString(),
                row.getLastManuallyEditedBy()));
        }
        log.debug(
            "[diag-ams] spec_generation manually_edited_in_scope bookId={} count={}",
            shortPrefix(bookId), out.size());
        return out;
    }

    // -----------------------------------------------------------------------
    // Single-story regenerate with overwrite-manually-edited gate
    // (Task Group 3.3 -- 2026-05-20)
    // -----------------------------------------------------------------------

    /**
     * Persist a single-row LLM regenerate against an existing spec row,
     * gated on the new {@code manually_edited} column. Mirrors the
     * post-write pipeline from {@link #persistOne}.
     *
     * <p>If the existing row carries {@code manuallyEdited == true} and the
     * caller has NOT set {@code overwriteManuallyEdited=true}, the call
     * throws {@link ManuallyEditedSkipRequiredException} carrying the audit
     * fields the frontend modal needs to render the confirm dialog. The
     * controller translates that into an HTTP 409 with a structured envelope
     * ({@code { code: 'manually_edited_skip_required', ... }}).</p>
     *
     * <p>When {@code overwriteManuallyEdited=true}, the row IS regenerated;
     * AFTER the regenerate succeeds {@code manuallyEdited} is cleared back
     * to {@code false} and the audit fields ({@code lastManuallyEditedAt},
     * {@code lastManuallyEditedBy}) are nulled -- the row is LLM-generated
     * again, no longer user-edited. {@code previousSpecText} is overwritten
     * with the most recent LLM output so the manual edit drops out of the
     * single-slot history.</p>
     *
     * <p>Spec: In-Product Spec Editor + Confirm-Overwrite (2026-05-20) --
     * Task Group 3.3.</p>
     */
    @Transactional
    public MigrationStorySpecGenerationDto regenerateSingleStory(
            UUID projectId, UUID specId,
            MigrationStorySpecGenerationDto patch,
            boolean overwriteManuallyEdited) {
        if (projectId == null || specId == null) {
            throw new ResourceNotFoundException(
                "Spec generation row not found: " + specId);
        }
        MigrationStorySpecGenerationEntity entity = repository.findById(specId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "Spec generation row not found: " + specId));
        if (!projectId.equals(entity.getProjectId())) {
            throw new ResourceNotFoundException(
                "Spec generation row not in project " + projectId + ": " + specId);
        }

        // Manual-edit gate (new manually_edited column -- the OLD
        // createdByTask drift check on updateRow stays as-is for legacy
        // callers; this gate is the source of truth for the new flow).
        if (Boolean.TRUE.equals(entity.getManuallyEdited()) && !overwriteManuallyEdited) {
            log.info(
                "[diag-ams] spec_generation regenerate_blocked specId={} workItemId={} reason=manually_edited",
                shortPrefix(specId), shortPrefix(entity.getWorkItemId()));
            throw new ManuallyEditedSkipRequiredException(
                specId,
                entity.getLastManuallyEditedBy(),
                entity.getLastManuallyEditedAt() == null
                    ? null : entity.getLastManuallyEditedAt().toString());
        }

        // Capture prior quality score for previous_quality_score delta.
        Integer priorQualityScore = entity.getQualityScore();
        // Resolve story title for scorer input.
        String storyTitle = null;
        if (entity.getWorkItemId() != null) {
            storyTitle = workItemRepository.findById(entity.getWorkItemId())
                .map(WorkItemEntity::getTitle)
                .orElse(null);
        }

        if (patch != null) {
            MigrationStorySpecGenerationMapper.updateEntityFromDto(entity, patch);
        }
        applyShapeSpecParserOutput(entity);
        populateMissingInputKeys(entity);
        applyQualityScoring(entity, storyTitle, priorQualityScore);
        // Bump attempt # since this is a regenerate.
        Integer prior = entity.getGenerationAttemptNumber();
        entity.setGenerationAttemptNumber((prior == null ? 0 : prior) + 1);

        // Clear stale-on-success per the existing persistOne contract.
        if (patch != null && patch.status() != null
                && MigrationStorySpecGenerationStatus.SUCCESSFULLY_GENERATED.contains(patch.status())) {
            entity.setStale(Boolean.FALSE);
            entity.setStaleMarkedAt(null);
            entity.setStaleReason(null);
        }

        // Overwrite-manually-edited cleanup: the row is LLM-generated again,
        // so clear the four manual-edit columns. previous_spec_text is set
        // to the most recent LLM output via the parser-refresh path above --
        // we explicitly null it here to mirror the spec's "the manual edit
        // drops out of the single slot" contract.
        if (overwriteManuallyEdited) {
            entity.setManuallyEdited(Boolean.FALSE);
            entity.setLastManuallyEditedAt(null);
            entity.setLastManuallyEditedBy(null);
            entity.setPreviousSpecText(null);
            log.info(
                "[diag-ams] spec_generation manual_edit_cleared specId={} reason=overwrite_regenerate",
                shortPrefix(specId));
        }

        entity.setUpdatedAt(Instant.now());
        return MigrationStorySpecGenerationMapper.toDto(repository.save(entity));
    }


    // -----------------------------------------------------------------------
    // Summary (lazy not_attempted per A-6)
    // -----------------------------------------------------------------------

    @Transactional(readOnly = true)
    public SpecGenerationSummary getSummary(UUID projectId, UUID bookId) {
        GeneratedMigrationBookOfWorkEntity book = requireBookOfWork(projectId, bookId);

        List<MigrationStorySpecGenerationEntity> rows = new ArrayList<>(
            repository.findByBookOfWorkIdOrderByCreatedAtAsc(bookId));
        rows.removeIf(e -> !projectId.equals(e.getProjectId()));

        int generated = countByStatus(rows, MigrationStorySpecGenerationStatus.GENERATED);
        int generatedWithWarnings = countByStatus(rows,
            MigrationStorySpecGenerationStatus.GENERATED_WITH_WARNINGS);
        int insufficient = countByStatus(rows,
            MigrationStorySpecGenerationStatus.INSUFFICIENT_CONTEXT);
        int failed = countByStatus(rows, MigrationStorySpecGenerationStatus.FAILED);
        int skippedBlocked = countByStatus(rows,
            MigrationStorySpecGenerationStatus.SKIPPED_BLOCKED);

        int attempted = rows.size();

        int totalSavedStories = countSavedStories(book.getBookOfWorkJson());
        int notAttempted = Math.max(0, totalSavedStories - attempted);

        NextBatch nextBatch = computeNextBatch(book.getBookOfWorkJson(), rows);

        log.info(
            "[diag-ams] spec_generation summary_computed bookOfWorkId={} totalSavedStories={} attempted={}"
                + " notAttempted={} nextBatchStart={}",
            shortPrefix(bookId), totalSavedStories, attempted, notAttempted,
            nextBatch.nextBatchStart());

        return new SpecGenerationSummary(
            totalSavedStories,
            totalSavedStories,
            attempted,
            generated,
            generatedWithWarnings,
            insufficient,
            failed,
            skippedBlocked,
            notAttempted,
            nextBatch.nextBatchStart(),
            nextBatch.nextBatchSize()
        );
    }

    // -----------------------------------------------------------------------
    // Helpers + internal types
    // -----------------------------------------------------------------------

    /**
     * Hash every v1-type entry in {@code missing_inputs_json} via
     * {@link MissingInputKeyHasher} and write the resulting list to
     * {@code missing_input_keys_json}. Out-of-v1 entries are ignored.
     *
     * <p>Spec: Missing Input Resolver Flow (2026-05-20) -- Task Group 3.4.</p>
     *
     * <p>NEVER throws: a malformed entry is silently skipped (a warning is
     * logged at debug). Persistence of the spec row itself is never blocked.
     * </p>
     *
     * <p>Idempotent: invoking this on a row whose {@code missing_inputs_json}
     * has not changed produces the same {@code missing_input_keys_json}
     * (deterministic hash). Calls on rows with no
     * {@code missing_inputs_json} or whose status is not
     * {@code insufficient_context} clear the key list to {@code null} (no
     * v1-type missing inputs are present).</p>
     */
    private void populateMissingInputKeys(MigrationStorySpecGenerationEntity entity) {
        if (entity == null) return;
        List<Map<String, Object>> missingInputs = entity.getMissingInputsJson();
        if (missingInputs == null || missingInputs.isEmpty()) {
            // Status-aware clearing: a row that is no longer
            // insufficient_context (e.g. a successful regen) should not retain
            // stale keys. The persistOne path also writes the new status, so
            // ordering is fine.
            entity.setMissingInputKeysJson(null);
            return;
        }
        // Only insufficient_context rows can have keys; defensively skip
        // others so a transient row carrying both a status and a missing-
        // inputs blob does not produce keys that should not exist.
        if (!MigrationStorySpecGenerationStatus.INSUFFICIENT_CONTEXT.equals(entity.getStatus())) {
            entity.setMissingInputKeysJson(null);
            return;
        }
        // Use a LinkedHashSet to preserve first-seen order while de-duping a
        // repeated entry (two identical missing-input items hash to the same
        // key; storing it twice serves no purpose for the matcher).
        LinkedHashSet<String> keys = new LinkedHashSet<>();
        for (Map<String, Object> entry : missingInputs) {
            String key = hashSingleMissingInputEntry(entry);
            if (key != null) {
                keys.add(key);
            }
        }
        if (keys.isEmpty()) {
            entity.setMissingInputKeysJson(null);
            log.debug(
                "[diag-ams] spec_generation missing_input_keys_populate workItemId={} status={} keyCount=0 (no v1-type entries)",
                shortPrefix(entity.getWorkItemId()), entity.getStatus());
            return;
        }
        entity.setMissingInputKeysJson(new ArrayList<>(keys));
        log.debug(
            "[diag-ams] spec_generation missing_input_keys_populate workItemId={} status={} keyCount={}",
            shortPrefix(entity.getWorkItemId()), entity.getStatus(), keys.size());
    }

    /**
     * Hash a single missing-input entry. Returns null when the entry is null,
     * lacks a {@code type} field, has an out-of-v1 type, or is malformed in a
     * way that would yield a meaningless key.
     */
    private String hashSingleMissingInputEntry(Map<String, Object> entry) {
        if (entry == null) return null;
        Object typeObj = entry.get("type");
        if (!(typeObj instanceof String type) || type.isBlank()) return null;
        String normalizedType = type.toLowerCase().trim();

        if (MISSING_INPUT_TYPE_API_CONTRACT.equals(normalizedType)) {
            String service = asTrimmedString(entry.get("service"));
            if (service == null) {
                service = asTrimmedString(entry.get("serviceName"));
            }
            String operation = asTrimmedString(entry.get("operation"));
            if (operation == null) {
                operation = asTrimmedString(entry.get("operationName"));
            }
            if (service == null && operation == null) return null;
            String descriptor = missingInputKeyHasher
                .canonicalDescriptorForApiContract(service, operation);
            return missingInputKeyHasher.computeKey(normalizedType, descriptor);
        }
        if (MISSING_INPUT_TYPE_MAPPING.equals(normalizedType)) {
            String src = asTrimmedString(entry.get("sourceElementId"));
            if (src == null) {
                src = asTrimmedString(entry.get("source_element_id"));
            }
            String tgt = asTrimmedString(entry.get("targetElementId"));
            if (tgt == null) {
                tgt = asTrimmedString(entry.get("target_element_id"));
            }
            if (src == null && tgt == null) return null;
            String descriptor = missingInputKeyHasher
                .canonicalDescriptorForMapping(src, tgt);
            return missingInputKeyHasher.computeKey(normalizedType, descriptor);
        }
        if (MISSING_INPUT_TYPE_TARGET_ELEMENT.equals(normalizedType)) {
            String name = asTrimmedString(entry.get("logicalName"));
            if (name == null) {
                name = asTrimmedString(entry.get("targetElementLogicalName"));
            }
            if (name == null) {
                name = asTrimmedString(entry.get("logical_name"));
            }
            if (name == null) return null;
            String descriptor = missingInputKeyHasher
                .canonicalDescriptorForArchElement(name);
            return missingInputKeyHasher.computeKey(normalizedType, descriptor);
        }
        // Out-of-v1 type -- intentionally no key entry.
        return null;
    }

    private static String asTrimmedString(Object o) {
        if (!(o instanceof String s)) return null;
        String trimmed = s.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    /**
     * True when the row is a deterministic MANUAL-GATE spec — identified by the
     * {@code focused_context_refs_json.source == 'code_plan_manual_gate'} marker
     * the gateway code-carriage stamps. Manual-gate specs intentionally omit
     * the decisions/interfaces/assumptions sections (they are HUMAN/WIZARD
     * procedure + gate-condition text), so full-shape-spec heading warnings do
     * not apply to them.
     */
    private static boolean isManualGateSpec(MigrationStorySpecGenerationEntity entity) {
        Map<String, Object> refs = entity.getFocusedContextRefsJson();
        if (refs == null) return false;
        Object source = refs.get("source");
        return "code_plan_manual_gate".equals(source);
    }

    /**
     * Invoke {@link ShapeSpecHeadingParser} on the entity's current
     * {@code generated_spec_text} and apply the structured output.
     */
    private void applyShapeSpecParserOutput(MigrationStorySpecGenerationEntity entity) {
        if (entity == null) return;
        String specText = entity.getGeneratedSpecText();
        if (specText == null || specText.isBlank()) {
            return;
        }
        ParseResult result;
        try {
            result = shapeSpecHeadingParser.parse(specText);
        } catch (RuntimeException ex) {
            log.warn("[diag-ams] spec_generation parser_invocation_failed workItemId={} reason={}",
                shortPrefix(entity.getWorkItemId()), ex.getMessage());
            return;
        }
        entity.setDecisionsJson(result.decisions().isEmpty() ? null : new ArrayList<>(result.decisions()));
        entity.setInterfacesJson(result.interfaces().isEmpty() ? null : new ArrayList<>(result.interfaces()));
        entity.setAssumptionsJson(result.assumptions().isEmpty() ? null : new ArrayList<>(result.assumptions()));

        // Manual-gate exemption (Phase 0, 2026-07-20): manual-gate specs
        // (deterministic HUMAN/WIZARD procedure text, focused_context_refs
        // source 'code_plan_manual_gate') intentionally omit the
        // decisions/interfaces/assumptions sections — appending
        // parser_missing_heading warnings for them is spurious noise. Sections
        // are still parsed (correctly empty); only the warnings are skipped.
        if (isManualGateSpec(entity)) {
            log.debug(
                "[diag-ams] spec_generation parser_warnings_skipped_manual_gate workItemId={}",
                shortPrefix(entity.getWorkItemId()));
            return;
        }

        if (!result.warnings().isEmpty()) {
            List<Map<String, Object>> existing = entity.getWarningsJson();
            List<Map<String, Object>> merged = existing == null
                ? new ArrayList<>() : new ArrayList<>(existing);
            for (ShapeSpecHeadingParser.Warning w : result.warnings()) {
                Map<String, Object> entry = w.toMap();
                if (!containsWarning(merged, entry)) {
                    merged.add(entry);
                }
            }
            entity.setWarningsJson(merged);
        }
        log.debug(
            "[diag-ams] spec_generation parser_applied workItemId={} decisions={} interfaces={} assumptions={} warnings={}",
            shortPrefix(entity.getWorkItemId()),
            result.decisions().size(), result.interfaces().size(),
            result.assumptions().size(), result.warnings().size());
    }

    /**
     * Invoke {@link SpecQualityScorer} on the entity and apply the result to
     * the four quality columns. NEVER throws -- on exception, all four
     * columns are nulled and a {@code quality_scoring_error} warning is
     * appended to {@code warnings_json} so persistence of the spec text
     * itself is never blocked.
     *
     * <p>Skip rule: rows with {@code status='insufficient_context'} or
     * {@code status='failed'} are NEVER scored. Their {@code quality_score},
     * {@code quality_grade}, and {@code quality_dimensions_json} are forcibly
     * set to {@code null} (we do not want a zero-graded F entry falsely
     * lumping these rows in with F-graded specs that DO have content).
     * {@code previous_quality_score} is still set to the supplied
     * {@code priorScore} so the drawer has a historical anchor for delta-chip
     * rendering on the next successful regen.</p>
     *
     * <p>Spec: Spec Quality Scoring (2026-05-20) -- Task Group 3.</p>
     */
    private void applyQualityScoring(
            MigrationStorySpecGenerationEntity entity,
            String storyTitle,
            Integer priorScore) {
        if (entity == null) return;
        String status = entity.getStatus();
        // Skip scoring for insufficient_context / failed: NULL all four
        // columns but preserve previous_quality_score so the historical
        // anchor survives.
        if (MigrationStorySpecGenerationStatus.INSUFFICIENT_CONTEXT.equals(status)
                || MigrationStorySpecGenerationStatus.FAILED.equals(status)) {
            entity.setQualityScore(null);
            entity.setQualityGrade(null);
            entity.setQualityDimensionsJson(null);
            entity.setPreviousQualityScore(priorScore);
            return;
        }
        try {
            SpecQualityScorer.Input input = new SpecQualityScorer.Input(
                entity.getGeneratedSpecText(),
                entity.getDecisionsJson(),
                entity.getInterfacesJson(),
                entity.getAssumptionsJson(),
                entity.getWarningsJson(),
                storyTitle);
            SpecQualityScorer.Output output = specQualityScorer.score(input);
            entity.setPreviousQualityScore(priorScore);
            entity.setQualityScore(output.score());
            entity.setQualityGrade(output.grade());
            entity.setQualityDimensionsJson(output.dimensions());
            log.debug(
                "[diag-ams] spec_generation quality_scored workItemId={} score={} grade={} priorScore={}",
                shortPrefix(entity.getWorkItemId()), output.score(),
                output.grade(), priorScore);
        } catch (RuntimeException ex) {
            log.warn("[diag-ams] spec_generation quality_scoring_failed workItemId={} reason={}",
                shortPrefix(entity.getWorkItemId()), ex.getMessage());
            entity.setQualityScore(null);
            entity.setQualityGrade(null);
            entity.setQualityDimensionsJson(null);
            entity.setPreviousQualityScore(priorScore);
            appendQualityScoringErrorWarning(entity, ex.getMessage());
        }
    }

    private static void appendQualityScoringErrorWarning(
            MigrationStorySpecGenerationEntity entity, String message) {
        List<Map<String, Object>> existing = entity.getWarningsJson();
        List<Map<String, Object>> merged = existing == null
            ? new ArrayList<>() : new ArrayList<>(existing);
        Map<String, Object> entry = new LinkedHashMap<>();
        entry.put("kind", WARNING_KIND_QUALITY_SCORING_ERROR);
        if (message != null) entry.put("message", message);
        merged.add(entry);
        entity.setWarningsJson(merged);
    }

    private static boolean containsWarning(
        List<Map<String, Object>> warnings, Map<String, Object> candidate) {
        if (warnings == null || warnings.isEmpty() || candidate == null) return false;
        Object kind = candidate.get("kind");
        Object section = candidate.get("section");
        if (kind == null) return false;
        for (Map<String, Object> w : warnings) {
            if (w == null) continue;
            if (kind.equals(w.get("kind"))
                && java.util.Objects.equals(section, w.get("section"))) {
                return true;
            }
        }
        return false;
    }

    private GeneratedMigrationBookOfWorkEntity requireBookOfWork(UUID projectId, UUID bookId) {
        if (projectId == null || bookId == null) {
            throw new ResourceNotFoundException("Book of work not found: " + bookId);
        }
        Optional<GeneratedMigrationBookOfWorkEntity> opt = bookOfWorkRepository.findById(bookId);
        if (opt.isEmpty() || !projectId.equals(opt.get().getProjectId())) {
            throw new ResourceNotFoundException("Book of work not found: " + bookId);
        }
        return opt.get();
    }

    private static int countByStatus(List<MigrationStorySpecGenerationEntity> rows, String status) {
        int n = 0;
        for (MigrationStorySpecGenerationEntity r : rows) {
            if (status.equals(r.getStatus())) n++;
        }
        return n;
    }

    private boolean isManuallyEdited(MigrationStorySpecGenerationEntity entity) {
        if (entity == null) return false;
        String task = entity.getCreatedByTask();
        if (task == null) return false;
        return !GENERATOR_TASK_ID.equals(task);
    }

    @SuppressWarnings("unchecked")
    private static int countSavedStories(Map<String, Object> bookOfWorkJson) {
        if (bookOfWorkJson == null) return 0;
        Object items = bookOfWorkJson.get("items");
        if (!(items instanceof List<?> list)) return 0;
        int n = 0;
        for (Object o : list) {
            if (!(o instanceof Map<?, ?> m)) continue;
            Object type = m.get("type");
            Object saveState = m.get("saveState");
            Object workItemIdField = m.get("workItemId");
            boolean isStory = type instanceof String s
                && "story".equalsIgnoreCase(s);
            boolean isSaved = "saved".equals(saveState) || workItemIdField != null;
            if (isStory && isSaved) {
                n++;
            }
        }
        return n;
    }

    @SuppressWarnings("unchecked")
    private NextBatch computeNextBatch(
        Map<String, Object> bookOfWorkJson,
        List<MigrationStorySpecGenerationEntity> rows) {
        Set<UUID> attemptedWorkItemIds = new java.util.HashSet<>();
        for (MigrationStorySpecGenerationEntity e : rows) {
            if (e.getWorkItemId() != null) attemptedWorkItemIds.add(e.getWorkItemId());
        }
        if (bookOfWorkJson == null) {
            return new NextBatch(0, 0);
        }
        Object items = bookOfWorkJson.get("items");
        if (!(items instanceof List<?> list)) {
            return new NextBatch(0, 0);
        }
        int firstUnattemptedSeq = -1;
        int remainingUnattempted = 0;
        for (Object o : list) {
            if (!(o instanceof Map<?, ?> m)) continue;
            Object type = m.get("type");
            if (!(type instanceof String s) || !"story".equalsIgnoreCase(s)) continue;
            Object saveState = m.get("saveState");
            Object workItemIdField = m.get("workItemId");
            if (!"saved".equals(saveState) && workItemIdField == null) continue;
            UUID wid = null;
            if (workItemIdField instanceof String ws) {
                try {
                    wid = UUID.fromString(ws);
                } catch (IllegalArgumentException ignore) {
                    // ignore non-UUID legacy markers
                }
            }
            if (wid != null && attemptedWorkItemIds.contains(wid)) continue;
            remainingUnattempted++;
            Object seq = m.get("sequenceOrder");
            int seqVal = (seq instanceof Number n) ? n.intValue() : 0;
            if (firstUnattemptedSeq < 0 || seqVal < firstUnattemptedSeq) {
                firstUnattemptedSeq = seqVal;
            }
        }
        if (firstUnattemptedSeq < 0) firstUnattemptedSeq = 0;
        return new NextBatch(
            firstUnattemptedSeq,
            Math.min(DEFAULT_BATCH_SIZE, remainingUnattempted));
    }

    private static String shortPrefix(UUID id) {
        if (id == null) return "00000000";
        String s = id.toString();
        return s.substring(0, Math.min(8, s.length()));
    }

    private record NextBatch(int nextBatchStart, int nextBatchSize) {}

    // -----------------------------------------------------------------------
    // Public response shapes
    // -----------------------------------------------------------------------

    public record BatchPersistResult(
        int persistedCount,
        int resultsCouldNotPersist,
        List<MigrationStorySpecGenerationDto> perStoryResults,
        List<PerRowError> errors
    ) {
        public Map<String, Object> toResponseMap() {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("persistedCount", persistedCount);
            out.put("resultsCouldNotPersist", resultsCouldNotPersist);
            out.put("perStoryResults", perStoryResults);
            List<Map<String, Object>> errs = new ArrayList<>();
            for (PerRowError e : errors) {
                Map<String, Object> em = new LinkedHashMap<>();
                em.put("workItemId", e.workItemId());
                em.put("status", e.status());
                em.put("errorMessage", e.errorMessage());
                em.put("index", e.index());
                errs.add(em);
            }
            out.put("errors", errs);
            return out;
        }
    }

    public record PerRowError(
        String workItemId,
        String status,
        String errorMessage,
        int index
    ) {}

    // @CamelCaseWire: the sole consumer is the frontend spec-generation summary
    // header (frontend/src/api/specGenerationApi.ts SpecGenerationSummaryDto),
    // which reads camelCase keys and casts the response with no key coercion.
    // Without this, the AMS global SNAKE_CASE default emits saved_story_count /
    // total_stories / next_batch_size, every field deserialises to undefined on
    // the client, and the summary header renders blank counts + "no remaining
    // stories" regardless of how many stories are actually saved.
    @CamelCaseWire
    public record SpecGenerationSummary(
        int totalStories,
        int savedStoryCount,
        int attemptedCount,
        int generatedCount,
        int generatedWithWarningsCount,
        int insufficientContextCount,
        int failedCount,
        int skippedBlockedCount,
        int notAttemptedCount,
        int nextBatchStart,
        int nextBatchSize
    ) {}

    public record StaleSpecSummary(
        int staleCount,
        List<String> staleWorkItemIds
    ) {}

    public record UpdateRowRequest(
        MigrationStorySpecGenerationDto patch,
        Boolean confirmOverwrite
    ) {}

    public record RecomputeQualityResult(
        Integer qualityScore,
        String qualityGrade,
        List<Map<String, Object>> qualityDimensions,
        Integer previousQualityScore,
        String message
    ) {}

    public record BulkRecomputeQualityResult(
        int totalScored,
        int totalSkipped,
        Map<String, Integer> gradeBreakdown
    ) {}

    public static class ManualEditProtectedException extends RuntimeException {
        public ManualEditProtectedException(String message) {
            super(message);
        }
    }

    /**
     * Wire shape for the manually-edited-in-scope listing endpoint
     * (Task Group 3.4). Carries the four fields the frontend bulk-overwrite
     * picker labels rows with: stable spec id, work-item id (for the
     * regenerate request), story title, audit timestamp + author.
     *
     * <p>Spec: In-Product Spec Editor + Confirm-Overwrite (2026-05-20) --
     * Task Group 3.4.</p>
     */
    public record ManuallyEditedInScopeRow(
        UUID specId,
        UUID workItemId,
        String workItemTitle,
        String lastManuallyEditedAt,
        String lastManuallyEditedBy
    ) {}

    /**
     * Thrown by {@link #regenerateSingleStory} when the target row carries
     * {@code manuallyEdited == true} and the caller has NOT set
     * {@code overwriteManuallyEdited=true}. Translated by the controller into
     * HTTP 409 with a structured envelope ({@code { code:
     * 'manually_edited_skip_required', specId, lastManuallyEditedBy,
     * lastManuallyEditedAt }}) the frontend can branch on to surface the
     * confirm-overwrite modal.
     *
     * <p>Spec: In-Product Spec Editor + Confirm-Overwrite (2026-05-20) --
     * Task Group 3.3.</p>
     */
    public static class ManuallyEditedSkipRequiredException extends RuntimeException {
        private final UUID specId;
        private final String lastManuallyEditedBy;
        private final String lastManuallyEditedAt;

        public ManuallyEditedSkipRequiredException(
                UUID specId, String lastManuallyEditedBy, String lastManuallyEditedAt) {
            super("Refusing to regenerate manually-edited spec without overwriteManuallyEdited=true");
            this.specId = specId;
            this.lastManuallyEditedBy = lastManuallyEditedBy;
            this.lastManuallyEditedAt = lastManuallyEditedAt;
        }

        public UUID specId() { return specId; }
        public String lastManuallyEditedBy() { return lastManuallyEditedBy; }
        public String lastManuallyEditedAt() { return lastManuallyEditedAt; }
    }
}
