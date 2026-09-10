package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.DbMigrationPackMapper;
import com.example.architecturemodel.model.dto.DbMigrationPackTranslationDto;
import com.example.architecturemodel.model.dto.UpdateDbMigrationPackTranslationRequest;
import com.example.architecturemodel.model.dto.UpsertDbMigrationPackTranslationsRequest;
import com.example.architecturemodel.model.entity.DbMigrationPackEntity;
import com.example.architecturemodel.model.entity.DbMigrationPackTranslationEntity;
import com.example.architecturemodel.repository.entity.DbMigrationPackRepository;
import com.example.architecturemodel.repository.entity.DbMigrationPackTranslationRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Service for the per-object DB translation rows
 * ({@code db_migration_pack_translations}, changeset 176) -- the AMS half of
 * the Spec-2 translation pipeline. The gateway orchestrates (seeding,
 * re-link policy, LLM translate/judge, emission); AMS persists only.
 *
 * <p><b>Operations:</b></p>
 * <ul>
 *   <li>{@link #upsertTranslations(UUID, UUID, UpsertDbMigrationPackTranslationsRequest)}
 *       -- bulk upsert by {@code translation_key} (seeding / regeneration
 *       re-link). Existing rows receive a SPARSE merge: only non-null
 *       caller-supplied fields are applied, so an unchanged row's draft /
 *       verdict / disposition / review lifecycle is preserved verbatim when
 *       the caller omits those fields (the demote-on-source-change policy is
 *       computed by the gateway and arrives as explicit field values).
 *       Unknown keys insert with the entity defaults; with
 *       {@code delete_absent} the pack's rows missing from the batch are
 *       deleted (manifest-dropped objects).</li>
 *   <li>{@link #listTranslations(UUID, UUID)} / {@link #getTranslation(UUID, UUID, UUID)}
 *       -- the read surface (all lifecycle fields ride the DTO so the
 *       gateway computes the coverage summary deterministically).</li>
 *   <li>{@link #updateTranslation(UUID, UUID, UUID, UpdateDbMigrationPackTranslationRequest)}
 *       -- sparse PATCH, null-guarded per
 *       {@code project_primitive_double_dto_overwrite.md}: pipeline state,
 *       draft + verdict together ({@code translated_at} stamped with the
 *       draft), disposition + drop_reason (drop REQUIRES a reason), review
 *       status + notes ({@code reviewed_at} stamped; {@code unreviewed}
 *       clears it). Generator-owned fields (source body / hash / fidelity
 *       flags / identity) are not on the PATCH surface at all.</li>
 * </ul>
 *
 * <p>Modeled structurally on {@link DbMigrationPackService}; identical
 * {@code @ConditionalOnProperty} guard for the no-database profile.
 * Structured diagnostic log lines use the
 * {@code [diag-ams] db_migration_pack_translation} prefix.</p>
 *
 * <p>Spec: LLM-Assisted DB Object Translation Drafts (2026-06-11) --
 * {@code agent-os/specs/2026-06-11-db-object-translation-drafts/spec.md},
 * Task Group 2.</p>
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class DbMigrationPackTranslationService {

    private final DbMigrationPackRepository packRepository;
    private final DbMigrationPackTranslationRepository translationRepository;

    // -----------------------------------------------------------------
    // Bulk upsert by translation_key (seeding / regeneration re-link)
    // -----------------------------------------------------------------

    /**
     * Bulk upsert by {@code translation_key}. Returns the upserted rows in
     * batch order.
     *
     * @throws ResourceNotFoundException unknown pack (404)
     * @throws IllegalArgumentException missing body/translations, blank or
     *     duplicate keys, missing kind on insert, invalid enum values, or
     *     {@code drop} without a reason (400)
     */
    @Transactional
    public List<DbMigrationPackTranslationDto> upsertTranslations(
        UUID projectId, UUID packId, UpsertDbMigrationPackTranslationsRequest request) {
        DbMigrationPackEntity pack = requirePack(projectId, packId);
        if (request == null || request.translations() == null) {
            throw new IllegalArgumentException("translations is required");
        }
        validateBatch(request.translations());

        Instant now = Instant.now();
        int linked = 0;
        int created = 0;
        List<DbMigrationPackTranslationDto> out = new ArrayList<>(request.translations().size());
        for (DbMigrationPackTranslationDto dto : request.translations()) {
            Optional<DbMigrationPackTranslationEntity> prior =
                translationRepository.findByPackIdAndTranslationKey(
                    pack.getId(), dto.translationKey());
            DbMigrationPackTranslationEntity entity;
            if (prior.isPresent()) {
                // RE-LINK: sparse merge -- only non-null supplied fields are
                // applied; omitted draft/verdict/disposition/review fields
                // survive verbatim.
                entity = prior.get();
                applySparseFields(entity, dto);
                linked++;
            } else {
                if (dto.kind() == null) {
                    throw new IllegalArgumentException(
                        "kind is required for new translation '" + dto.translationKey()
                            + "'; allowed values: "
                            + DbMigrationPackTranslationEntity.ALL_KINDS);
                }
                entity = DbMigrationPackTranslationEntity.builder()
                    .id(UUID.randomUUID())
                    .packId(pack.getId())
                    .translationKey(dto.translationKey())
                    .createdAt(now)
                    .build();
                applySparseFields(entity, dto);
                created++;
            }
            requireDropReason(entity);
            out.add(DbMigrationPackMapper.toDto(translationRepository.save(entity)));
        }

        int deleted = 0;
        if (Boolean.TRUE.equals(request.deleteAbsent())) {
            Set<String> keptKeys = new LinkedHashSet<>();
            for (DbMigrationPackTranslationDto dto : request.translations()) {
                keptKeys.add(dto.translationKey());
            }
            List<DbMigrationPackTranslationEntity> existing =
                translationRepository.findByPackIdOrderByCreatedAtAsc(pack.getId());
            for (DbMigrationPackTranslationEntity row : existing) {
                if (!keptKeys.contains(row.getTranslationKey())) {
                    translationRepository.delete(row);
                    deleted++;
                }
            }
        }

        log.info(
            "[diag-ams] db_migration_pack_translation stage=upsert packId={} batch={} "
                + "linked={} created={} deleted={}",
            pack.getId(), request.translations().size(), linked, created, deleted);
        return out;
    }

    // -----------------------------------------------------------------
    // Read surface
    // -----------------------------------------------------------------

    /** All translation rows for a pack, oldest first (stable list order). */
    @Transactional(readOnly = true)
    public List<DbMigrationPackTranslationDto> listTranslations(UUID projectId, UUID packId) {
        DbMigrationPackEntity pack = requirePack(projectId, packId);
        return translationRepository.findByPackIdOrderByCreatedAtAsc(pack.getId()).stream()
            .map(DbMigrationPackMapper::toDto)
            .toList();
    }

    /**
     * Single-translation fetch scoped to the project + pack.
     *
     * @throws ResourceNotFoundException unknown pack/translation (or a
     *     translation belonging to a different pack) -- 404
     */
    @Transactional(readOnly = true)
    public DbMigrationPackTranslationDto getTranslation(
        UUID projectId, UUID packId, UUID translationId) {
        DbMigrationPackEntity pack = requirePack(projectId, packId);
        return DbMigrationPackMapper.toDto(requireTranslation(pack.getId(), translationId));
    }

    // -----------------------------------------------------------------
    // Sparse PATCH
    // -----------------------------------------------------------------

    /**
     * Sparse PATCH: null-guarded -- an omitted field leaves the column
     * untouched, so a review-only PATCH never wipes the pipeline state, the
     * draft, the verdict or the fidelity flags.
     *
     * @throws ResourceNotFoundException unknown pack/translation (404)
     * @throws IllegalArgumentException invalid enum value or {@code drop}
     *     without a reason (400)
     */
    @Transactional
    public DbMigrationPackTranslationDto updateTranslation(
        UUID projectId, UUID packId, UUID translationId,
        UpdateDbMigrationPackTranslationRequest patch) {
        DbMigrationPackEntity pack = requirePack(projectId, packId);
        if (patch == null) {
            throw new IllegalArgumentException("request body is required");
        }
        DbMigrationPackTranslationEntity entity =
            requireTranslation(pack.getId(), translationId);

        if (patch.pipelineState() != null) {
            validateValue("pipeline_state", patch.pipelineState(),
                DbMigrationPackTranslationEntity.ALL_PIPELINE_STATES);
            entity.setPipelineState(patch.pipelineState());
        }
        if (patch.draftContent() != null) {
            entity.setDraftContent(patch.draftContent());
            entity.setTranslatedAt(Instant.now());
        }
        if (patch.judgeVerdictJson() != null) {
            entity.setJudgeVerdictJson(patch.judgeVerdictJson());
        }
        if (patch.disposition() != null) {
            validateValue("disposition", patch.disposition(),
                DbMigrationPackTranslationEntity.ALL_DISPOSITIONS);
            entity.setDisposition(patch.disposition());
        }
        if (patch.dropReason() != null) {
            entity.setDropReason(blankToNull(patch.dropReason()));
        }
        if (patch.reviewStatus() != null) {
            validateValue("review_status", patch.reviewStatus(),
                DbMigrationPackTranslationEntity.ALL_REVIEW_STATUSES);
            entity.setReviewStatus(patch.reviewStatus());
            // A review action stamps reviewed_at; returning to `unreviewed`
            // (re-translate reset) clears it.
            entity.setReviewedAt(
                DbMigrationPackTranslationEntity.REVIEW_UNREVIEWED.equals(patch.reviewStatus())
                    ? null
                    : Instant.now());
        }
        if (patch.reviewerNotes() != null) {
            entity.setReviewerNotes(blankToNull(patch.reviewerNotes()));
        }
        // Workbench loop (changeset 231, Spec 4, 2026-09-09) -- same
        // null-guarded discipline: the loop PATCHes its own axis without ever
        // touching pipeline_state / review_status / disposition.
        if (patch.loopStatus() != null) {
            validateValue("loop_status", patch.loopStatus(),
                DbMigrationPackTranslationEntity.ALL_LOOP_STATUSES);
            entity.setLoopStatus(patch.loopStatus());
        }
        if (patch.currentAttemptNo() != null) {
            entity.setCurrentAttemptNo(patch.currentAttemptNo());
        }
        if (patch.bestAttemptNo() != null) {
            entity.setBestAttemptNo(patch.bestAttemptNo());
        }
        if (patch.verdictJson() != null) {
            entity.setVerdictJson(patch.verdictJson());
        }
        if (patch.parityReportId() != null) {
            entity.setParityReportId(patch.parityReportId());
        }
        if (patch.staleReason() != null) {
            entity.setStaleReason(blankToNull(patch.staleReason()));
        }
        requireDropReason(entity);

        DbMigrationPackTranslationEntity saved = translationRepository.save(entity);
        log.info(
            "[diag-ams] db_migration_pack_translation stage=patch packId={} translationId={} "
                + "key={} pipelineState={} disposition={} reviewStatus={}",
            pack.getId(), translationId, saved.getTranslationKey(),
            saved.getPipelineState(), saved.getDisposition(), saved.getReviewStatus());
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

    private DbMigrationPackTranslationEntity requireTranslation(UUID packId, UUID translationId) {
        if (translationId == null) {
            throw new ResourceNotFoundException(
                "DB migration pack translation not found: " + null);
        }
        return translationRepository.findById(translationId)
            .filter(t -> packId.equals(t.getPackId()))
            .orElseThrow(() -> new ResourceNotFoundException(
                "DB migration pack translation not found: " + translationId));
    }

    /**
     * Sparse merge of caller-supplied DTO fields onto the entity: ONLY
     * non-null fields are applied (boxed-type/null-guard discipline). Server
     * timestamps are NOT touched here -- the bulk upsert is a pure merge; the
     * PATCH surface owns {@code translated_at} / {@code reviewed_at}.
     */
    private static void applySparseFields(
        DbMigrationPackTranslationEntity entity, DbMigrationPackTranslationDto dto) {
        if (dto.objectRef() != null) {
            entity.setObjectRef(dto.objectRef());
        }
        if (dto.kind() != null) {
            validateValue("kind", dto.kind(), DbMigrationPackTranslationEntity.ALL_KINDS);
            entity.setKind(dto.kind());
        }
        if (dto.disposition() != null) {
            validateValue("disposition", dto.disposition(),
                DbMigrationPackTranslationEntity.ALL_DISPOSITIONS);
            entity.setDisposition(dto.disposition());
        }
        if (dto.dropReason() != null) {
            entity.setDropReason(blankToNull(dto.dropReason()));
        }
        if (dto.pipelineState() != null) {
            validateValue("pipeline_state", dto.pipelineState(),
                DbMigrationPackTranslationEntity.ALL_PIPELINE_STATES);
            entity.setPipelineState(dto.pipelineState());
        }
        if (dto.sourceBody() != null) {
            entity.setSourceBody(dto.sourceBody());
        }
        if (dto.sourceBodyHash() != null) {
            entity.setSourceBodyHash(dto.sourceBodyHash());
        }
        if (dto.truncated() != null) {
            entity.setTruncated(dto.truncated());
        }
        if (dto.legacyRedacted() != null) {
            entity.setLegacyRedacted(dto.legacyRedacted());
        }
        if (dto.routineId() != null) {
            entity.setRoutineId(dto.routineId());
        }
        if (dto.draftContent() != null) {
            entity.setDraftContent(dto.draftContent());
        }
        if (dto.judgeVerdictJson() != null) {
            entity.setJudgeVerdictJson(dto.judgeVerdictJson());
        }
        if (dto.reviewStatus() != null) {
            validateValue("review_status", dto.reviewStatus(),
                DbMigrationPackTranslationEntity.ALL_REVIEW_STATUSES);
            entity.setReviewStatus(dto.reviewStatus());
        }
        if (dto.reviewerNotes() != null) {
            entity.setReviewerNotes(blankToNull(dto.reviewerNotes()));
        }
        // Workbench loop (changeset 231, Spec 4, 2026-09-09): copy-when-non-null
        // so a regeneration re-link never resets a routine's loop progress.
        if (dto.loopStatus() != null) {
            validateValue("loop_status", dto.loopStatus(),
                DbMigrationPackTranslationEntity.ALL_LOOP_STATUSES);
            entity.setLoopStatus(dto.loopStatus());
        }
        if (dto.currentAttemptNo() != null) {
            entity.setCurrentAttemptNo(dto.currentAttemptNo());
        }
        if (dto.bestAttemptNo() != null) {
            entity.setBestAttemptNo(dto.bestAttemptNo());
        }
        if (dto.verdictJson() != null) {
            entity.setVerdictJson(dto.verdictJson());
        }
        if (dto.parityReportId() != null) {
            entity.setParityReportId(dto.parityReportId());
        }
        if (dto.staleReason() != null) {
            entity.setStaleReason(blankToNull(dto.staleReason()));
        }
    }

    private static void validateBatch(List<DbMigrationPackTranslationDto> translations) {
        Set<String> seenKeys = new LinkedHashSet<>();
        for (DbMigrationPackTranslationDto dto : translations) {
            if (dto == null || dto.translationKey() == null || dto.translationKey().isBlank()) {
                throw new IllegalArgumentException(
                    "every translation requires a non-blank translation_key");
            }
            if (!seenKeys.add(dto.translationKey())) {
                throw new IllegalArgumentException(
                    "duplicate translation_key '" + dto.translationKey() + "' in upsert batch");
            }
        }
    }

    /** {@code drop} without a reason is invalid (settled spec: drop+reason). */
    private static void requireDropReason(DbMigrationPackTranslationEntity entity) {
        if (DbMigrationPackTranslationEntity.DISPOSITION_DROP.equals(entity.getDisposition())
            && (entity.getDropReason() == null || entity.getDropReason().isBlank())) {
            throw new IllegalArgumentException(
                "drop_reason is required when disposition is 'drop' (translation '"
                    + entity.getTranslationKey() + "')");
        }
    }

    private static void validateValue(String field, String value, Set<String> allowed) {
        if (!allowed.contains(value)) {
            throw new IllegalArgumentException(
                "Invalid " + field + " '" + value + "'; allowed values: " + allowed);
        }
    }

    private static String blankToNull(String value) {
        return (value == null || value.isBlank()) ? null : value;
    }
}
