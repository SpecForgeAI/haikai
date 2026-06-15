package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ArchitectureNotFoundException;
import com.example.architecturemodel.exception.DuplicateArchitectureElementMappingException;
import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.exception.SameArchitectureCopyException;
import com.example.architecturemodel.model.dto.ArchitectureElementMappingDto;
import com.example.architecturemodel.model.dto.CreateArchitectureElementMappingRequest;
import com.example.architecturemodel.model.dto.UpdateArchitectureElementMappingRequest;
import com.example.architecturemodel.model.entity.ArchitectureElementMappingEntity;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.repository.ArchitectureRepository;
import com.example.architecturemodel.repository.entity.ArchitectureElementMappingRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * CRUD service for architecture-element mappings.
 *
 * <p>Mirrors the
 * {@link DiscoveryCandidateEntityMappingService} shape (lombok
 * {@code @Service / @RequiredArgsConstructor / @Slf4j},
 * {@code @Transactional} for writes, {@code @Transactional(readOnly = true)}
 * for reads). Supports the four CRUD HTTP shapes the controller exposes
 * plus the in-memory create-from-auto-map path used by
 * {@link ArchitectureSelectiveCopyService}.</p>
 *
 * <h2>Validation rules (v1)</h2>
 * <ul>
 *   <li>Required: both architecture ids, both element type+id, mapping_type,
 *       status.</li>
 *   <li>{@code source_architecture_id != target_architecture_id}.</li>
 *   <li>Both architectures must belong to the path {@code projectId}.</li>
 *   <li>{@code mapping_type} must be in {@link #ALLOWED_MAPPING_TYPES}.</li>
 *   <li>{@code status} must be in {@link #ALLOWED_STATUSES}.</li>
 *   <li>Update path (PATCH semantics): only the four mutable fields are
 *       considered ({@code mappingType}, {@code status}, {@code notes},
 *       {@code confidence}); {@code created_by_task} is set server-side to
 *       {@code "mapping-review-modal-edit"}.</li>
 *   <li>Manual-add path does NOT default {@code confidence} to 1.0
 *       (1.0 is reserved for the auto-mapped path on selective copy).</li>
 * </ul>
 *
 * <p>Spec: Create Target Baseline from Current State (2026-05-15) -- Task Group 2</p>
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class ArchitectureElementMappingService {

    /** Allowed v1 mapping types. */
    public static final Set<String> ALLOWED_MAPPING_TYPES = Set.of(
        "equivalent",
        "renamed",
        "replaced_by",
        "split",
        "merged",
        "manual_review_required"
    );

    /** Allowed v1 statuses. */
    public static final Set<String> ALLOWED_STATUSES = Set.of(
        "confirmed",
        "proposed",
        "needs_review",
        "rejected"
    );

    /** {@code created_by_task} value for manual-add via the Mapping Review modal. */
    public static final String CREATED_BY_TASK_MANUAL_ADD = "mapping-review-modal-add";

    /** {@code created_by_task} value set by the service on every PATCH. */
    public static final String CREATED_BY_TASK_MANUAL_EDIT = "mapping-review-modal-edit";

    /** {@code created_by_task} value set by the auto-map path on selective copy. */
    public static final String CREATED_BY_TASK_AUTO_MAP = "selective-copy-with-auto-map";

    private final ArchitectureElementMappingRepository repository;
    private final ArchitectureRepository architectureRepository;

    // =========================================================================
    // PUBLIC API
    // =========================================================================

    /**
     * Filtered list. All filter parameters except {@code projectId} are
     * optional; {@code null} values are ignored.
     */
    @Transactional(readOnly = true)
    public List<ArchitectureElementMappingDto> list(
            UUID projectId,
            UUID sourceArchitectureId,
            UUID targetArchitectureId,
            String sourceElementType,
            String targetElementType,
            String mappingType,
            String status,
            String q) {
        log.debug("list mappings: project={}, source={}, target={}, srcType={}, tgtType={}, mappingType={}, status={}, q={}",
            projectId, sourceArchitectureId, targetArchitectureId,
            sourceElementType, targetElementType, mappingType, status, q);

        return repository.search(
                projectId,
                sourceArchitectureId,
                targetArchitectureId,
                blankToNull(sourceElementType),
                blankToNull(targetElementType),
                blankToNull(mappingType),
                blankToNull(status),
                blankToNull(q))
            .stream()
            .map(this::toDto)
            .toList();
    }

    /**
     * Manual create from the Mapping Review modal. Defaults
     * {@code created_by_task} to {@code "mapping-review-modal-add"} and does
     * NOT default {@code confidence} to {@code 1.0} — the request value is
     * honoured verbatim (which may be {@code null}).
     */
    @Transactional
    public ArchitectureElementMappingDto create(
            UUID projectId,
            CreateArchitectureElementMappingRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("Architecture-element mapping request body is required");
        }
        log.info("create mapping: project={}, source={}, target={}, srcType={}, srcId={}, tgtType={}, tgtId={}, mappingType={}, status={}",
            projectId,
            request.sourceArchitectureId(),
            request.targetArchitectureId(),
            request.sourceElementType(),
            request.sourceElementId(),
            request.targetElementType(),
            request.targetElementId(),
            request.mappingType(),
            request.status());

        validateBody(
            request.sourceArchitectureId(),
            request.targetArchitectureId(),
            request.sourceElementType(),
            request.sourceElementId(),
            request.targetElementType(),
            request.targetElementId(),
            request.mappingType(),
            request.status());
        validateArchitectures(projectId, request.sourceArchitectureId(), request.targetArchitectureId());

        ArchitectureElementMappingEntity entity = ArchitectureElementMappingEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .sourceArchitectureId(request.sourceArchitectureId())
            .targetArchitectureId(request.targetArchitectureId())
            .sourceElementType(request.sourceElementType())
            .sourceElementId(request.sourceElementId())
            .targetElementType(request.targetElementType())
            .targetElementId(request.targetElementId())
            .mappingType(request.mappingType())
            .status(request.status())
            .createdByTask(CREATED_BY_TASK_MANUAL_ADD)
            .notes(request.notes())
            // Manual-add path: honour the supplied value verbatim (may be null).
            // Service does NOT default confidence to 1.0 -- 1.0 is reserved
            // for the auto-map path on selective copy.
            .confidence(request.confidence())
            .build();

        return persistOrThrow(entity);
    }

    /**
     * PATCH update from the Mapping Review modal. Only the four mutable
     * fields are touched; {@code created_by_task} is overwritten server-side
     * to {@code "mapping-review-modal-edit"}; {@code updated_at} is bumped
     * via {@code @PreUpdate}.
     *
     * <p>Boxed {@link Double} {@code confidence} on the request preserves
     * {@code null} when the client omits the field — primitive numerics
     * silently default to {@code 0.0} which would corrupt the column
     * (see {@code project_primitive_double_dto_overwrite.md}).</p>
     */
    @Transactional
    public ArchitectureElementMappingDto update(
            UUID projectId,
            UUID mappingId,
            UpdateArchitectureElementMappingRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("Architecture-element mapping update body is required");
        }
        ArchitectureElementMappingEntity entity = repository.findById(mappingId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "Architecture-element mapping not found: " + mappingId));
        if (!projectId.equals(entity.getProjectId())) {
            throw new ResourceNotFoundException(
                "Architecture-element mapping " + mappingId + " not found in project " + projectId);
        }

        // PATCH semantics for all four mutable fields: an absent JSON key
        // (which Jackson binds to null on the boxed/reference DTO field)
        // means "preserve the existing value, do not touch". This is true
        // PATCH (RFC 5789), not PUT-like replacement -- the wizard's
        // edit-just-the-notes flow must not silently wipe confidence.
        // To clear notes the client sends an empty string (persisted as "");
        // confidence cannot be cleared via PATCH in v1 (delete + recreate).
        if (request.mappingType() != null) {
            requireAllowedMappingType(request.mappingType());
            entity.setMappingType(request.mappingType());
        }
        if (request.status() != null) {
            requireAllowedStatus(request.status());
            entity.setStatus(request.status());
        }
        if (request.notes() != null) {
            entity.setNotes(request.notes());
        }
        if (request.confidence() != null) {
            entity.setConfidence(request.confidence());
        }
        entity.setCreatedByTask(CREATED_BY_TASK_MANUAL_EDIT);

        return persistOrThrow(entity);
    }

    /**
     * Hard delete. v1 chooses hard-delete to keep the unique constraint
     * simple — if a soft-delete pattern is added later, the unique constraint
     * will need to be partial (active rows only).
     */
    @Transactional
    public void delete(UUID projectId, UUID mappingId) {
        ArchitectureElementMappingEntity entity = repository.findById(mappingId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "Architecture-element mapping not found: " + mappingId));
        if (!projectId.equals(entity.getProjectId())) {
            throw new ResourceNotFoundException(
                "Architecture-element mapping " + mappingId + " not found in project " + projectId);
        }
        repository.delete(entity);
    }

    // =========================================================================
    // INTERNAL HELPERS
    // =========================================================================

    private ArchitectureElementMappingDto persistOrThrow(ArchitectureElementMappingEntity entity) {
        // Pre-check the unique constraint so the happy duplicate-add case
        // surfaces as our typed exception instead of a wrapped
        // DataIntegrityViolationException. The DB still has the constraint
        // as a race-safety net.
        boolean exists = repository
            .existsByProjectIdAndSourceArchitectureIdAndTargetArchitectureIdAndSourceElementTypeAndSourceElementIdAndTargetElementTypeAndTargetElementIdAndMappingType(
                entity.getProjectId(),
                entity.getSourceArchitectureId(),
                entity.getTargetArchitectureId(),
                entity.getSourceElementType(),
                entity.getSourceElementId(),
                entity.getTargetElementType(),
                entity.getTargetElementId(),
                entity.getMappingType());
        // For the update path the entity itself is what already exists -
        // existsBy... will return true if and only if no other row collides.
        // We rely on JPA's identity-based behaviour: saveAndFlush will not
        // double-insert; the unique constraint only fires on a *different*
        // row sharing the same compound key. So we only short-circuit when
        // the colliding row has a different id from the one we're saving.
        if (exists) {
            // Re-fetch the matching row by compound key to see if it's the
            // same id (update path) or a different one (duplicate path).
            // Use the search method as a single-arch-pair lookup with the
            // compound key narrowed by element ids; pick the one whose
            // mapping_type matches.
            for (ArchitectureElementMappingEntity existing : repository
                .findByProjectIdAndSourceArchitectureIdAndTargetArchitectureId(
                    entity.getProjectId(),
                    entity.getSourceArchitectureId(),
                    entity.getTargetArchitectureId())) {
                if (existing.getMappingType().equals(entity.getMappingType())
                    && existing.getSourceElementType().equals(entity.getSourceElementType())
                    && existing.getSourceElementId().equals(entity.getSourceElementId())
                    && existing.getTargetElementType().equals(entity.getTargetElementType())
                    && existing.getTargetElementId().equals(entity.getTargetElementId())
                    && !existing.getId().equals(entity.getId())) {
                    throw new DuplicateArchitectureElementMappingException();
                }
            }
        }

        try {
            ArchitectureElementMappingEntity saved = repository.saveAndFlush(entity);
            return toDto(saved);
        } catch (DataIntegrityViolationException ex) {
            // Race-safety net for the unique constraint at the DB level.
            log.warn("Duplicate architecture-element mapping caught at DB level: {}",
                ex.getMessage());
            throw new DuplicateArchitectureElementMappingException();
        }
    }

    private void validateBody(UUID sourceArchitectureId,
                              UUID targetArchitectureId,
                              String sourceElementType,
                              String sourceElementId,
                              String targetElementType,
                              String targetElementId,
                              String mappingType,
                              String status) {
        if (sourceArchitectureId == null) {
            throw new IllegalArgumentException("sourceArchitectureId is required");
        }
        if (targetArchitectureId == null) {
            throw new IllegalArgumentException("targetArchitectureId is required");
        }
        if (sourceElementType == null || sourceElementType.isBlank()) {
            throw new IllegalArgumentException("sourceElementType is required");
        }
        if (sourceElementId == null || sourceElementId.isBlank()) {
            throw new IllegalArgumentException("sourceElementId is required");
        }
        if (targetElementType == null || targetElementType.isBlank()) {
            throw new IllegalArgumentException("targetElementType is required");
        }
        if (targetElementId == null || targetElementId.isBlank()) {
            throw new IllegalArgumentException("targetElementId is required");
        }
        if (mappingType == null || mappingType.isBlank()) {
            throw new IllegalArgumentException("mappingType is required");
        }
        if (status == null || status.isBlank()) {
            throw new IllegalArgumentException("status is required");
        }
        requireAllowedMappingType(mappingType);
        requireAllowedStatus(status);
    }

    private void requireAllowedMappingType(String mappingType) {
        if (!ALLOWED_MAPPING_TYPES.contains(mappingType)) {
            throw new IllegalArgumentException(
                "mappingType '" + mappingType + "' is not in the v1 allowed list "
                    + ALLOWED_MAPPING_TYPES);
        }
    }

    private void requireAllowedStatus(String status) {
        if (!ALLOWED_STATUSES.contains(status)) {
            throw new IllegalArgumentException(
                "status '" + status + "' is not in the v1 allowed list "
                    + ALLOWED_STATUSES);
        }
    }

    private void validateArchitectures(UUID projectId,
                                       UUID sourceArchitectureId,
                                       UUID targetArchitectureId) {
        if (sourceArchitectureId.equals(targetArchitectureId)) {
            throw new SameArchitectureCopyException(
                "source_architecture_id and target_architecture_id must differ");
        }
        ArchitectureEntity source = architectureRepository.findById(sourceArchitectureId)
            .orElseThrow(() -> new ArchitectureNotFoundException(
                "Architecture not found: " + sourceArchitectureId));
        if (!projectId.equals(source.getProjectId())) {
            throw new ArchitectureNotFoundException(
                "Architecture " + sourceArchitectureId + " not found in project " + projectId);
        }
        ArchitectureEntity target = architectureRepository.findById(targetArchitectureId)
            .orElseThrow(() -> new ArchitectureNotFoundException(
                "Architecture not found: " + targetArchitectureId));
        if (!projectId.equals(target.getProjectId())) {
            throw new ArchitectureNotFoundException(
                "Architecture " + targetArchitectureId + " not found in project " + projectId);
        }
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s;
    }

    private ArchitectureElementMappingDto toDto(ArchitectureElementMappingEntity entity) {
        return new ArchitectureElementMappingDto(
            entity.getId(),
            entity.getProjectId(),
            entity.getSourceArchitectureId(),
            entity.getTargetArchitectureId(),
            entity.getSourceElementType(),
            entity.getSourceElementId(),
            entity.getTargetElementType(),
            entity.getTargetElementId(),
            entity.getMappingType(),
            entity.getStatus(),
            entity.getCreatedByTask(),
            entity.getCreatedAt(),
            entity.getUpdatedAt(),
            entity.getNotes(),
            entity.getConfidence()
        );
    }
}
