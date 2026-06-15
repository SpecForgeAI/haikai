package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.DbMigrationPackMapper;
import com.example.architecturemodel.model.dto.BulkResolveDbMigrationPackDecisionsRequest;
import com.example.architecturemodel.model.dto.DbMigrationPackDecisionDto;
import com.example.architecturemodel.model.dto.DbMigrationPackDriftReportDto;
import com.example.architecturemodel.model.dto.DbMigrationPackDto;
import com.example.architecturemodel.model.dto.DbMigrationPackFileDto;
import com.example.architecturemodel.model.dto.ResolveDbMigrationPackDecisionRequest;
import com.example.architecturemodel.model.dto.UpdateDbMigrationPackRequest;
import com.example.architecturemodel.model.dto.UpsertDbMigrationPackRequest;
import com.example.architecturemodel.model.entity.DbMigrationPackDecisionEntity;
import com.example.architecturemodel.model.entity.DbMigrationPackDriftReportEntity;
import com.example.architecturemodel.model.entity.DbMigrationPackEntity;
import com.example.architecturemodel.model.entity.DbMigrationPackFileEntity;
import com.example.architecturemodel.model.entity.DbMigrationPackStatus;
import com.example.architecturemodel.repository.entity.DbMigrationPackDecisionRepository;
import com.example.architecturemodel.repository.entity.DbMigrationPackDriftReportRepository;
import com.example.architecturemodel.repository.entity.DbMigrationPackFileRepository;
import com.example.architecturemodel.repository.entity.DbMigrationPackRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Service for the DB schema + data migration pack persistence stack -- the
 * AMS half of the deterministic Sybase ASE to PostgreSQL migration pack flow.
 * The gateway generator orchestrates; AMS persists only.
 *
 * <p><b>Operations:</b></p>
 * <ul>
 *   <li>{@link #upsertPack(UUID, UpsertDbMigrationPackRequest)} -- ONE
 *       logical persist per generation run (spec stage 6): pack upsert keyed
 *       by {@code (projectId, architectureId)} -&gt; files replaced wholesale
 *       -&gt; decisions upserted by {@code decision_key}. Regeneration updates
 *       the pack row IN PLACE (same id) so decisions and drift history
 *       survive; resolved decisions RE-LINK instead of duplicating.</li>
 *   <li>{@link #getPack(UUID, UUID)} / {@link #listPacks(UUID, UUID)} /
 *       {@link #listFiles(UUID, UUID)} -- read surface (manifest rides on the
 *       pack DTO).</li>
 *   <li>{@link #listDecisions(UUID, UUID, String, String)} +
 *       {@link #resolveDecision(UUID, UUID, UUID, ResolveDbMigrationPackDecisionRequest)}
 *       + {@link #resolveDecisionsBulk(UUID, UUID, BulkResolveDbMigrationPackDecisionsRequest)}
 *       -- the decision queue. Resolving flips {@code open -> resolved},
 *       persists {@code resolution_json}, and marks the owning pack
 *       {@code stale} (the resolution only takes effect after an EXPLICIT
 *       regenerate -- never auto-triggered).</li>
 *   <li>{@link #appendDriftReport(UUID, UUID, DbMigrationPackDriftReportDto)}
 *       + {@link #listDriftReports(UUID, UUID)} -- append-only verification
 *       history (rows never updated; settled Q6).</li>
 *   <li>{@link #updatePack(UUID, UUID, UpdateDbMigrationPackRequest)} --
 *       sparse PATCH of {@code work_item_id} (DB-epic attachment) and the
 *       staleness pair, null-guarded per
 *       {@code project_primitive_double_dto_overwrite.md} so generation
 *       output (counts, seed_margin, manifest) is untouchable from PATCH.</li>
 * </ul>
 *
 * <p>Modeled structurally on {@link GeneratedMigrationBookOfWorkService};
 * identical {@code @ConditionalOnProperty} guard for the no-database profile.
 * Structured diagnostic log lines use the {@code [diag-ams] db_migration_pack}
 * prefix.</p>
 *
 * <p>Spec: Source-Grade DB Schema + Data Migration Pack (2026-06-11) --
 * {@code agent-os/specs/2026-06-11-db-schema-and-data-migration-pack/spec.md},
 * Task Group 1.</p>
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class DbMigrationPackService {

    /** Stale reason stamped when a pack decision is resolved. */
    static final String STALE_REASON_DECISION_RESOLVED =
        "decision resolved since generation";

    private final DbMigrationPackRepository packRepository;
    private final DbMigrationPackFileRepository fileRepository;
    private final DbMigrationPackDecisionRepository decisionRepository;
    private final DbMigrationPackDriftReportRepository driftReportRepository;

    // -----------------------------------------------------------------
    // Pack upsert (create / regenerate-in-place)
    // -----------------------------------------------------------------

    /**
     * Create or regenerate-in-place the pack for
     * {@code (projectId, request.architectureId)}.
     *
     * <p>Pack-level generator fields are FULL-WRITE (each generation provides
     * the complete row); {@code work_item_id} is preserved unless explicitly
     * provided (the DB-epic attachment is user state, not generator output);
     * {@code generated_at} is stamped server-side. When {@code files} is
     * non-null the file set is replaced wholesale; {@code decisions} are
     * upserted by {@code decision_key} -- existing rows re-link (object_ref /
     * category / question / options refreshed, status / resolution /
     * resolved_at PRESERVED), unknown keys insert as {@code open}. Decisions
     * and drift reports are never deleted here -- they survive regeneration
     * by pack id.</p>
     *
     * @throws IllegalArgumentException on missing body/architecture_id,
     *     invalid status/file_kind/category, or duplicate inline keys (400)
     */
    @Transactional
    public DbMigrationPackDto upsertPack(UUID projectId, UpsertDbMigrationPackRequest request) {
        if (projectId == null) {
            throw new IllegalArgumentException("projectId is required");
        }
        if (request == null) {
            throw new IllegalArgumentException("request body is required");
        }
        if (request.architectureId() == null) {
            throw new IllegalArgumentException("architecture_id is required");
        }
        if (request.status() != null && !DbMigrationPackStatus.ALL.contains(request.status())) {
            throw new IllegalArgumentException(
                "Invalid status '" + request.status() + "'; allowed values: "
                    + DbMigrationPackStatus.ALL);
        }
        validateFiles(request.files());
        validateDecisions(request.decisions());

        Optional<DbMigrationPackEntity> existing =
            packRepository.findByProjectIdAndArchitectureId(projectId, request.architectureId());
        boolean created = existing.isEmpty();
        DbMigrationPackEntity pack = existing.orElseGet(() -> DbMigrationPackEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .architectureId(request.architectureId())
            .build());

        Instant now = Instant.now();
        // FULL-WRITE generator fields -- each generation provides the complete
        // row, so nulls are assigned verbatim (this is NOT the PATCH surface).
        pack.setStatus(request.status() != null ? request.status() : DbMigrationPackStatus.GENERATED);
        pack.setStaleReason(request.staleReason());
        pack.setInputSnapshotHash(request.inputSnapshotHash());
        pack.setGeneratedAt(now);
        pack.setTranslatedCount(request.translatedCount());
        pack.setSkippedCount(request.skippedCount());
        pack.setFlaggedCount(request.flaggedCount());
        pack.setSeedMargin(request.seedMargin());
        pack.setManifestJson(request.manifestJson());
        // PRESERVE the DB-epic attachment across regeneration unless the
        // caller explicitly provided one (blank clears).
        if (request.workItemId() != null) {
            pack.setWorkItemId(blankToNull(request.workItemId()));
        }
        pack.setUpdatedAt(now);
        DbMigrationPackEntity saved = packRepository.save(pack);

        int fileCount = 0;
        if (request.files() != null) {
            fileRepository.deleteByPackId(saved.getId());
            List<DbMigrationPackFileEntity> newFiles = new ArrayList<>(request.files().size());
            int index = 0;
            for (DbMigrationPackFileDto file : request.files()) {
                newFiles.add(DbMigrationPackFileEntity.builder()
                    .id(UUID.randomUUID())
                    .packId(saved.getId())
                    .filePath(file.filePath())
                    .fileKind(file.fileKind())
                    .content(file.content())
                    .sortOrder(file.sortOrder() != null ? file.sortOrder() : index)
                    .createdAt(now)
                    .build());
                index++;
            }
            fileRepository.saveAll(newFiles);
            fileCount = newFiles.size();
        }

        int decisionsLinked = 0;
        int decisionsCreated = 0;
        if (request.decisions() != null) {
            for (DbMigrationPackDecisionDto decision : request.decisions()) {
                Optional<DbMigrationPackDecisionEntity> prior =
                    decisionRepository.findByPackIdAndDecisionKey(
                        saved.getId(), decision.decisionKey());
                if (prior.isPresent()) {
                    // RE-LINK: refresh the question surface, preserve the
                    // resolution lifecycle (status / resolution_json /
                    // resolved_at) so an answered decision never re-opens or
                    // duplicates on regeneration.
                    DbMigrationPackDecisionEntity entity = prior.get();
                    entity.setObjectRef(decision.objectRef());
                    entity.setCategory(decision.category());
                    entity.setQuestion(decision.question());
                    entity.setOptionsJson(decision.optionsJson());
                    entity.setUpdatedAt(now);
                    decisionRepository.save(entity);
                    decisionsLinked++;
                } else {
                    decisionRepository.save(DbMigrationPackDecisionEntity.builder()
                        .id(UUID.randomUUID())
                        .packId(saved.getId())
                        .decisionKey(decision.decisionKey())
                        .objectRef(decision.objectRef())
                        .category(decision.category())
                        .question(decision.question())
                        .optionsJson(decision.optionsJson())
                        .status(DbMigrationPackDecisionEntity.STATUS_OPEN)
                        .createdAt(now)
                        .updatedAt(now)
                        .build());
                    decisionsCreated++;
                }
            }
        }

        log.info(
            "[diag-ams] db_migration_pack stage=upsert projectId={} architectureId={} packId={} "
                + "created={} files={} decisionsLinked={} decisionsCreated={}",
            projectId, request.architectureId(), saved.getId(),
            created, fileCount, decisionsLinked, decisionsCreated);
        return DbMigrationPackMapper.toDto(saved);
    }

    // -----------------------------------------------------------------
    // Read surface
    // -----------------------------------------------------------------

    /**
     * List packs for a project (at most one per architecture), newest first;
     * optionally filtered to a single architecture.
     */
    @Transactional(readOnly = true)
    public List<DbMigrationPackDto> listPacks(UUID projectId, UUID architectureId) {
        if (projectId == null) {
            throw new IllegalArgumentException("projectId is required");
        }
        if (architectureId != null) {
            return packRepository.findByProjectIdAndArchitectureId(projectId, architectureId)
                .map(DbMigrationPackMapper::toDto)
                .map(List::of)
                .orElseGet(List::of);
        }
        return packRepository.findByProjectIdOrderByCreatedAtDesc(projectId).stream()
            .map(DbMigrationPackMapper::toDto)
            .toList();
    }

    /**
     * Single-pack fetch scoped to the project (manifest included on the DTO).
     *
     * @throws ResourceNotFoundException if the pack does not exist or belongs
     *     to a different project (cross-project leakage collapses into 404)
     */
    @Transactional(readOnly = true)
    public DbMigrationPackDto getPack(UUID projectId, UUID packId) {
        return DbMigrationPackMapper.toDto(requirePack(projectId, packId));
    }

    /** All files for a pack in deterministic pack order. */
    @Transactional(readOnly = true)
    public List<DbMigrationPackFileDto> listFiles(UUID projectId, UUID packId) {
        DbMigrationPackEntity pack = requirePack(projectId, packId);
        return fileRepository.findByPackIdOrderBySortOrderAsc(pack.getId()).stream()
            .map(DbMigrationPackMapper::toDto)
            .toList();
    }

    // -----------------------------------------------------------------
    // Decision queue
    // -----------------------------------------------------------------

    /**
     * List a pack's decisions, optionally filtered by status and/or category.
     */
    @Transactional(readOnly = true)
    public List<DbMigrationPackDecisionDto> listDecisions(
        UUID projectId, UUID packId, String status, String category) {
        DbMigrationPackEntity pack = requirePack(projectId, packId);
        if (status != null && !DbMigrationPackDecisionEntity.ALL_STATUSES.contains(status)) {
            throw new IllegalArgumentException(
                "Invalid decision status filter '" + status + "'; allowed values: "
                    + DbMigrationPackDecisionEntity.ALL_STATUSES);
        }
        if (category != null && !DbMigrationPackDecisionEntity.ALL_CATEGORIES.contains(category)) {
            throw new IllegalArgumentException(
                "Invalid decision category filter '" + category + "'; allowed values: "
                    + DbMigrationPackDecisionEntity.ALL_CATEGORIES);
        }
        return decisionRepository.findByPackIdOrderByCreatedAtAsc(pack.getId()).stream()
            .filter(d -> status == null || status.equals(d.getStatus()))
            .filter(d -> category == null || category.equals(d.getCategory()))
            .map(DbMigrationPackMapper::toDto)
            .toList();
    }

    /**
     * Resolve ONE decision: flip {@code open -> resolved}, stamp
     * {@code resolved_at}, persist {@code resolution_json}, and mark the
     * owning pack stale (re-resolving an already-resolved decision updates
     * its resolution -- the queue's "resolve again with a different option"
     * path).
     *
     * @throws ResourceNotFoundException unknown pack/decision (or a decision
     *     belonging to a different pack)
     * @throws IllegalArgumentException missing/empty resolution_json (400)
     */
    @Transactional
    public DbMigrationPackDecisionDto resolveDecision(
        UUID projectId, UUID packId, UUID decisionId,
        ResolveDbMigrationPackDecisionRequest request) {
        DbMigrationPackEntity pack = requirePack(projectId, packId);
        if (request == null || request.resolutionJson() == null || request.resolutionJson().isEmpty()) {
            throw new IllegalArgumentException("resolution_json is required to resolve a decision");
        }
        DbMigrationPackDecisionEntity decision = requireDecision(pack.getId(), decisionId);
        applyResolution(decision, request.resolutionJson());
        markPackStale(pack, STALE_REASON_DECISION_RESOLVED);
        log.info(
            "[diag-ams] db_migration_pack stage=resolve_decision packId={} decisionId={} decisionKey={}",
            pack.getId(), decisionId, decision.getDecisionKey());
        return DbMigrationPackMapper.toDto(decision);
    }

    /**
     * Bulk-resolve decisions with the SAME resolution payload. Atomic: every
     * id must belong to the pack or the whole bulk is rejected with 400 (no
     * partial resolution). The pack is marked stale once.
     *
     * @throws IllegalArgumentException empty ids, missing resolution_json, or
     *     any id not belonging to the pack (400)
     */
    @Transactional
    public List<DbMigrationPackDecisionDto> resolveDecisionsBulk(
        UUID projectId, UUID packId, BulkResolveDbMigrationPackDecisionsRequest request) {
        DbMigrationPackEntity pack = requirePack(projectId, packId);
        if (request == null || request.decisionIds() == null || request.decisionIds().isEmpty()) {
            throw new IllegalArgumentException("decision_ids is required and must be non-empty");
        }
        if (request.resolutionJson() == null || request.resolutionJson().isEmpty()) {
            throw new IllegalArgumentException("resolution_json is required to resolve decisions");
        }
        // Validate the FULL batch before mutating anything (atomic reject).
        Set<UUID> uniqueIds = new LinkedHashSet<>(request.decisionIds());
        List<DbMigrationPackDecisionEntity> decisions = new ArrayList<>(uniqueIds.size());
        for (UUID decisionId : uniqueIds) {
            DbMigrationPackDecisionEntity decision = decisionRepository.findById(decisionId)
                .filter(d -> pack.getId().equals(d.getPackId()))
                .orElseThrow(() -> new IllegalArgumentException(
                    "decision '" + decisionId + "' does not belong to pack '" + packId + "'"));
            decisions.add(decision);
        }
        List<DbMigrationPackDecisionDto> resolved = new ArrayList<>(decisions.size());
        for (DbMigrationPackDecisionEntity decision : decisions) {
            applyResolution(decision, request.resolutionJson());
            resolved.add(DbMigrationPackMapper.toDto(decision));
        }
        markPackStale(pack, STALE_REASON_DECISION_RESOLVED);
        log.info(
            "[diag-ams] db_migration_pack stage=resolve_decisions_bulk packId={} count={}",
            pack.getId(), resolved.size());
        return resolved;
    }

    // -----------------------------------------------------------------
    // Drift reports (append-only)
    // -----------------------------------------------------------------

    /**
     * Append ONE verification run to the pack's drift history. {@code id} /
     * {@code created_at} are server-generated; {@code source} defaults to
     * {@code in_tool}. Rows are never updated -- the history is an audit
     * trail (settled Q6).
     */
    @Transactional
    public DbMigrationPackDriftReportDto appendDriftReport(
        UUID projectId, UUID packId, DbMigrationPackDriftReportDto request) {
        DbMigrationPackEntity pack = requirePack(projectId, packId);
        if (request == null) {
            throw new IllegalArgumentException("request body is required");
        }
        DbMigrationPackDriftReportEntity entity = DbMigrationPackDriftReportEntity.builder()
            .id(UUID.randomUUID())
            .packId(pack.getId())
            .scanScopeJson(request.scanScopeJson())
            .matchCount(request.matchCount())
            .missingCount(request.missingCount())
            .mismatchCount(request.mismatchCount())
            .reportJson(request.reportJson())
            .source(request.source() != null
                ? request.source()
                : DbMigrationPackDriftReportEntity.SOURCE_IN_TOOL)
            .createdAt(Instant.now())
            .build();
        DbMigrationPackDriftReportEntity saved = driftReportRepository.save(entity);
        log.info(
            "[diag-ams] db_migration_pack stage=append_drift_report packId={} reportId={} "
                + "match={} missing={} mismatch={} source={}",
            pack.getId(), saved.getId(), saved.getMatchCount(), saved.getMissingCount(),
            saved.getMismatchCount(), saved.getSource());
        return DbMigrationPackMapper.toDto(saved);
    }

    /** Run history for a pack, newest first. */
    @Transactional(readOnly = true)
    public List<DbMigrationPackDriftReportDto> listDriftReports(UUID projectId, UUID packId) {
        DbMigrationPackEntity pack = requirePack(projectId, packId);
        return driftReportRepository.findByPackIdOrderByCreatedAtDesc(pack.getId()).stream()
            .map(DbMigrationPackMapper::toDto)
            .toList();
    }

    // -----------------------------------------------------------------
    // Sparse PATCH (work_item_id attachment + staleness pair)
    // -----------------------------------------------------------------

    /**
     * Sparse PATCH: null-guarded per
     * {@code project_primitive_double_dto_overwrite.md} -- an omitted field
     * leaves the column untouched. Only {@code work_item_id} (blank clears),
     * {@code status} (validated) and {@code stale_reason} are reachable;
     * generation output (coverage counts, seed_margin, manifest) is not on
     * this surface at all, so it can never be wiped by a sparse PATCH.
     *
     * @throws ResourceNotFoundException unknown pack (404)
     * @throws IllegalArgumentException invalid status (400)
     */
    @Transactional
    public DbMigrationPackDto updatePack(
        UUID projectId, UUID packId, UpdateDbMigrationPackRequest patch) {
        if (patch == null) {
            throw new IllegalArgumentException("request body is required");
        }
        if (patch.status() != null && !DbMigrationPackStatus.ALL.contains(patch.status())) {
            throw new IllegalArgumentException(
                "Invalid status '" + patch.status() + "'; allowed values: "
                    + DbMigrationPackStatus.ALL);
        }
        DbMigrationPackEntity pack = requirePack(projectId, packId);
        if (patch.workItemId() != null) {
            pack.setWorkItemId(blankToNull(patch.workItemId()));
        }
        if (patch.status() != null) {
            pack.setStatus(patch.status());
        }
        if (patch.staleReason() != null) {
            pack.setStaleReason(blankToNull(patch.staleReason()));
        }
        pack.setUpdatedAt(Instant.now());
        DbMigrationPackEntity saved = packRepository.save(pack);
        log.info(
            "[diag-ams] db_migration_pack stage=patch packId={} workItemId={} status={}",
            packId, saved.getWorkItemId(), saved.getStatus());
        return DbMigrationPackMapper.toDto(saved);
    }

    // -----------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------

    private DbMigrationPackEntity requirePack(UUID projectId, UUID packId) {
        if (projectId == null || packId == null) {
            throw new ResourceNotFoundException("DB migration pack not found: " + packId);
        }
        Optional<DbMigrationPackEntity> opt = packRepository.findById(packId);
        if (opt.isEmpty() || !projectId.equals(opt.get().getProjectId())) {
            throw new ResourceNotFoundException("DB migration pack not found: " + packId);
        }
        return opt.get();
    }

    private DbMigrationPackDecisionEntity requireDecision(UUID packId, UUID decisionId) {
        if (decisionId == null) {
            throw new ResourceNotFoundException("DB migration pack decision not found: " + null);
        }
        return decisionRepository.findById(decisionId)
            .filter(d -> packId.equals(d.getPackId()))
            .orElseThrow(() -> new ResourceNotFoundException(
                "DB migration pack decision not found: " + decisionId));
    }

    private void applyResolution(
        DbMigrationPackDecisionEntity decision, Map<String, Object> resolutionJson) {
        Instant now = Instant.now();
        decision.setStatus(DbMigrationPackDecisionEntity.STATUS_RESOLVED);
        decision.setResolutionJson(resolutionJson);
        decision.setResolvedAt(now);
        decision.setUpdatedAt(now);
        decisionRepository.save(decision);
    }

    private void markPackStale(DbMigrationPackEntity pack, String reason) {
        pack.setStatus(DbMigrationPackStatus.STALE);
        pack.setStaleReason(reason);
        pack.setUpdatedAt(Instant.now());
        packRepository.save(pack);
    }

    private static void validateFiles(List<DbMigrationPackFileDto> files) {
        if (files == null) {
            return;
        }
        for (DbMigrationPackFileDto file : files) {
            if (file == null || file.filePath() == null || file.filePath().isBlank()) {
                throw new IllegalArgumentException("every file requires a non-blank file_path");
            }
            if (file.fileKind() == null
                || !DbMigrationPackFileEntity.ALL_KINDS.contains(file.fileKind())) {
                throw new IllegalArgumentException(
                    "Invalid file_kind '" + (file == null ? null : file.fileKind())
                        + "' for file '" + file.filePath() + "'; allowed values: "
                        + DbMigrationPackFileEntity.ALL_KINDS);
            }
        }
    }

    private static void validateDecisions(List<DbMigrationPackDecisionDto> decisions) {
        if (decisions == null) {
            return;
        }
        Set<String> seenKeys = new LinkedHashSet<>();
        for (DbMigrationPackDecisionDto decision : decisions) {
            if (decision == null || decision.decisionKey() == null
                || decision.decisionKey().isBlank()) {
                throw new IllegalArgumentException(
                    "every decision requires a non-blank decision_key");
            }
            if (!seenKeys.add(decision.decisionKey())) {
                throw new IllegalArgumentException(
                    "duplicate decision_key '" + decision.decisionKey() + "' in upsert batch");
            }
            if (decision.category() == null
                || !DbMigrationPackDecisionEntity.ALL_CATEGORIES.contains(decision.category())) {
                throw new IllegalArgumentException(
                    "Invalid category '" + decision.category() + "' for decision '"
                        + decision.decisionKey() + "'; allowed values: "
                        + DbMigrationPackDecisionEntity.ALL_CATEGORIES);
            }
        }
    }

    private static String blankToNull(String value) {
        return (value == null || value.isBlank()) ? null : value;
    }
}
