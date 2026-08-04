package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.DbStructuralFindingDispositionMapper;
import com.example.architecturemodel.model.dto.DbStructuralFindingDispositionDto;
import com.example.architecturemodel.model.dto.UpsertDbStructuralFindingDispositionRequest;
import com.example.architecturemodel.model.entity.DbStructuralFindingDispositionEntity;
import com.example.architecturemodel.repository.entity.DbStructuralFindingDispositionRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Service for the per-project DB structural-finding disposition rows
 * ({@code db_structural_finding_dispositions}, changeset 215) -- the AMS half
 * of Spec 2 (Structural findings dispositions). The gateway/frontend own
 * finding derivation and display; AMS persists dispositions only.
 *
 * <p>Rows are keyed by {@code project_id} + the stable {@code finding_key}
 * identity ({@code kind:subject}) -- NOT by pack -- so dispositions survive
 * pack regeneration.</p>
 *
 * <p><b>Operations:</b></p>
 * <ul>
 *   <li>{@link #listByProject(UUID)} -- the read surface, oldest first.</li>
 *   <li>{@link #upsert(UUID, String, UpsertDbStructuralFindingDispositionRequest)}
 *       -- upsert by {@code finding_key}. CREATE requires disposition + kind +
 *       subject; UPDATE is a SPARSE merge (omitted fields untouched, per
 *       {@code project_primitive_double_dto_overwrite.md}) and stamps
 *       {@code updated_at}. The note rule is evaluated against the EFFECTIVE
 *       (post-merge) state: {@code accepted} / {@code known_gap} require a
 *       non-blank note (the {@code drop_reason} analogue from
 *       {@link DbMigrationPackTranslationService}).</li>
 *   <li>{@link #delete(UUID, String)} -- un-disposition a finding
 *       (404 when absent).</li>
 * </ul>
 *
 * <p>Modeled structurally on {@link DbMigrationPackTranslationService};
 * identical {@code @ConditionalOnProperty} guard for the no-database profile.
 * Structured diagnostic log lines use the
 * {@code [diag-ams] db_structural_finding_disposition} prefix.</p>
 *
 * <p>Spec: Structural findings dispositions (2026-08-04) -- Spec 2.</p>
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class DbStructuralFindingDispositionService {

    private final DbStructuralFindingDispositionRepository repository;

    // -----------------------------------------------------------------
    // Read surface
    // -----------------------------------------------------------------

    /** All disposition rows for a project, oldest first (stable list order). */
    @Transactional(readOnly = true)
    public List<DbStructuralFindingDispositionDto> listByProject(UUID projectId) {
        if (projectId == null) {
            throw new IllegalArgumentException("project_id is required");
        }
        return repository.findByProjectIdOrderByCreatedAtAsc(projectId).stream()
            .map(DbStructuralFindingDispositionMapper::toDto)
            .toList();
    }

    // -----------------------------------------------------------------
    // Upsert by finding_key (survives pack regeneration)
    // -----------------------------------------------------------------

    /**
     * Upsert by {@code finding_key}. CREATE requires {@code disposition},
     * {@code kind} and {@code subject}; UPDATE is a sparse merge (omitted
     * fields untouched) and stamps {@code updated_at}.
     *
     * @throws IllegalArgumentException blank finding key, missing/invalid
     *     disposition, missing kind/subject on create, or a missing note when
     *     the effective disposition is {@code accepted} / {@code known_gap}
     *     (400)
     */
    @Transactional
    public DbStructuralFindingDispositionDto upsert(
        UUID projectId, String findingKey,
        UpsertDbStructuralFindingDispositionRequest request) {
        if (projectId == null) {
            throw new IllegalArgumentException("project_id is required");
        }
        if (findingKey == null || findingKey.isBlank()) {
            throw new IllegalArgumentException("finding_key is required");
        }
        if (request == null) {
            throw new IllegalArgumentException("request body is required");
        }

        Optional<DbStructuralFindingDispositionEntity> prior =
            repository.findByProjectIdAndFindingKey(projectId, findingKey);
        DbStructuralFindingDispositionEntity entity;
        boolean created;
        if (prior.isPresent()) {
            // SPARSE merge -- only non-null supplied fields are applied;
            // omitted fields survive verbatim. Every update stamps updated_at.
            entity = prior.get();
            applySparseFields(entity, request);
            entity.setUpdatedAt(Instant.now());
            created = false;
        } else {
            if (request.disposition() == null) {
                throw new IllegalArgumentException(
                    "disposition is required for new finding disposition '" + findingKey
                        + "'; allowed values: "
                        + DbStructuralFindingDispositionEntity.ALL_DISPOSITIONS);
            }
            if (request.kind() == null || request.kind().isBlank()) {
                throw new IllegalArgumentException(
                    "kind is required for new finding disposition '" + findingKey + "'");
            }
            if (request.subject() == null || request.subject().isBlank()) {
                throw new IllegalArgumentException(
                    "subject is required for new finding disposition '" + findingKey + "'");
            }
            entity = DbStructuralFindingDispositionEntity.builder()
                .id(UUID.randomUUID())
                .projectId(projectId)
                .findingKey(findingKey)
                .createdAt(Instant.now())
                .build();
            applySparseFields(entity, request);
            created = true;
        }
        requireNoteForDisposition(entity);

        DbStructuralFindingDispositionEntity saved = repository.save(entity);
        log.info(
            "[diag-ams] db_structural_finding_disposition stage=upsert projectId={} "
                + "findingKey={} disposition={} created={}",
            projectId, findingKey, saved.getDisposition(), created);
        return DbStructuralFindingDispositionMapper.toDto(saved);
    }

    // -----------------------------------------------------------------
    // Delete (un-disposition)
    // -----------------------------------------------------------------

    /**
     * Remove a disposition row (un-disposition the finding).
     *
     * @throws ResourceNotFoundException unknown project/finding_key pair (404)
     */
    @Transactional
    public void delete(UUID projectId, String findingKey) {
        DbStructuralFindingDispositionEntity entity =
            repository.findByProjectIdAndFindingKey(projectId, findingKey)
                .orElseThrow(() -> new ResourceNotFoundException(
                    "DB structural finding disposition not found: " + findingKey));
        repository.delete(entity);
        log.info(
            "[diag-ams] db_structural_finding_disposition stage=delete projectId={} findingKey={}",
            projectId, findingKey);
    }

    // -----------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------

    /**
     * Sparse merge of caller-supplied request fields onto the entity: ONLY
     * non-null fields are applied (null-guard discipline). Timestamps are
     * owned by the caller ({@code upsert}).
     */
    private static void applySparseFields(
        DbStructuralFindingDispositionEntity entity,
        UpsertDbStructuralFindingDispositionRequest request) {
        if (request.disposition() != null) {
            validateValue("disposition", request.disposition(),
                DbStructuralFindingDispositionEntity.ALL_DISPOSITIONS);
            entity.setDisposition(request.disposition());
        }
        if (request.note() != null) {
            entity.setNote(blankToNull(request.note()));
        }
        if (request.kind() != null) {
            entity.setKind(request.kind());
        }
        if (request.subject() != null) {
            entity.setSubject(request.subject());
        }
    }

    /**
     * {@code accepted} / {@code known_gap} without a note is invalid --
     * evaluated against the EFFECTIVE (post-merge) entity state, mirroring
     * the {@code drop_reason} rule on the translation rows.
     */
    private static void requireNoteForDisposition(
        DbStructuralFindingDispositionEntity entity) {
        boolean noteRequired =
            DbStructuralFindingDispositionEntity.DISPOSITION_ACCEPTED
                .equals(entity.getDisposition())
            || DbStructuralFindingDispositionEntity.DISPOSITION_KNOWN_GAP
                .equals(entity.getDisposition());
        if (noteRequired
            && (entity.getNote() == null || entity.getNote().isBlank())) {
            throw new IllegalArgumentException(
                "note is required when disposition is '" + entity.getDisposition()
                    + "' (finding '" + entity.getFindingKey() + "')");
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
