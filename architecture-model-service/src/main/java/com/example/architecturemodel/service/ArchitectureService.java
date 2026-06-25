package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ArchitectureNotFoundException;
import com.example.architecturemodel.exception.DuplicateArchitectureNameException;
import com.example.architecturemodel.exception.LastArchitectureException;
import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.ArchitectureMapper;
import com.example.architecturemodel.model.dto.ArchitectureDto;
import com.example.architecturemodel.model.dto.targetstate.ProceedCriticalOverrideDto;
import com.example.architecturemodel.model.dto.targetstate.UpsertProceedCriticalOverrideRequest;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.model.entity.ArchitectureTagEntity;
import com.example.architecturemodel.repository.ArchitectureRepository;
import com.example.architecturemodel.repository.ArchitectureTagRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * Service for reading and mutating project architectures.
 *
 * Spec #1 introduced the read operations (list-for-project, resolve-default).
 * Spec #3 adds the create / update / archive operations along with
 * last-architecture protection and case-insensitive name uniqueness.
 *
 * Validation rules (mirrored on the client):
 *   name        -- required, non-empty after trim, <= 100 chars,
 *                  unique within project case-insensitively.
 *   description -- optional, <= 500 chars.
 *   tags        -- each non-empty after trim, <= 50 chars,
 *                  unique within the payload (case-sensitive --
 *                  free-form strings).
 *
 * Spec: Multi-Architecture Plumbing (Spec #1)
 * Spec: Multi-Architecture CRUD UI + Tag Management (Spec #3)
 * Spec: Multi-Architecture Full Clone (Spec #6) -- validation helpers
 *       are package-private so {@link ArchitectureCloneService} can
 *       reuse them without re-implementation.
 */
@Service
@Slf4j
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
public class ArchitectureService {

    static final int NAME_MAX_LENGTH = 100;
    static final int DESCRIPTION_MAX_LENGTH = 500;
    static final int TAG_MAX_LENGTH = 50;

    private final ArchitectureRepository architectureRepository;
    private final ArchitectureTagRepository architectureTagRepository;
    private final ArchitectureMapper architectureMapper;

    public ArchitectureService(ArchitectureRepository architectureRepository,
                               ArchitectureTagRepository architectureTagRepository,
                               ArchitectureMapper architectureMapper) {
        this.architectureRepository = architectureRepository;
        this.architectureTagRepository = architectureTagRepository;
        this.architectureMapper = architectureMapper;
    }

    /**
     * Lists all architectures for a project, ordered by created_at ascending
     * (oldest first). The first non-archived row in this list is also the
     * project's "Default" architecture per the resolution rule documented on
     * {@link #resolveDefault(UUID)}.
     *
     * @param projectId the project UUID
     * @return ordered list of architectures (oldest first); empty if none.
     */
    @Transactional(readOnly = true)
    public List<ArchitectureDto> listForProject(UUID projectId) {
        log.debug("Listing architectures for project: {}", projectId);
        List<ArchitectureEntity> entities =
            architectureRepository.findByProjectIdOrderByCreatedAtAsc(projectId);
        return entities.stream()
            .map(entity -> architectureMapper.toDto(
                entity,
                architectureTagRepository.findByArchitectureId(entity.getId())))
            .toList();
    }

    /**
     * Resolves the "Default" architecture for a project: the oldest
     * non-archived architecture (lowest created_at). Survives renames and
     * survives the addition of new architectures (spec #2/#3).
     *
     * @param projectId the project UUID
     * @return the Default architecture DTO
     * @throws ResourceNotFoundException if the project has no non-archived
     *   architectures (e.g. all archived, or the migration never ran).
     */
    @Transactional(readOnly = true)
    public ArchitectureDto resolveDefault(UUID projectId) {
        log.debug("Resolving Default architecture for project: {}", projectId);
        ArchitectureEntity entity =
            architectureRepository
                .findFirstByProjectIdAndArchivedFalseOrderByCreatedAtAsc(projectId)
                .orElseThrow(() -> new ResourceNotFoundException(
                    "No non-archived architecture found for project: " + projectId));
        return architectureMapper.toDto(
            entity,
            architectureTagRepository.findByArchitectureId(entity.getId()));
    }

    /**
     * Creates a new architecture for a project.
     *
     * Spec: Multi-Architecture CRUD UI + Tag Management (Spec #3)
     *
     * @param projectId   project to attach the new architecture to
     * @param name        required, non-empty after trim, <= 100 chars,
     *                    unique within project (case-insensitive)
     * @param description optional, <= 500 chars (null allowed)
     * @param tags        optional list; each tag non-empty after trim,
     *                    <= 50 chars, no duplicates within payload
     * @return the created architecture DTO including all tags
     * @throws IllegalArgumentException             on validation failure (mapped to 400)
     * @throws DuplicateArchitectureNameException   on name collision (mapped to 409)
     */
    @Transactional
    public ArchitectureDto create(UUID projectId,
                                  String name,
                                  String description,
                                  List<String> tags) {
        log.info("Creating architecture in project {}: name='{}'", projectId, name);

        String trimmedName = validateAndTrimName(name);
        String trimmedDescription = validateAndTrimDescription(description);
        List<String> normalisedTags = validateAndNormaliseTags(tags);

        if (architectureRepository.existsByProjectIdAndNameIgnoreCase(projectId, trimmedName)) {
            log.warn("Duplicate architecture name '{}' in project {}", trimmedName, projectId);
            throw new DuplicateArchitectureNameException(trimmedName);
        }

        ArchitectureEntity entity = ArchitectureEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .name(trimmedName)
            .description(trimmedDescription)
            .archived(false)
            .build();
        ArchitectureEntity saved = architectureRepository.save(entity);

        for (String tag : normalisedTags) {
            architectureTagRepository.save(ArchitectureTagEntity.builder()
                .architectureId(saved.getId())
                .tagValue(tag)
                .build());
        }

        log.info("Created architecture {} (project={}, tags={})",
            saved.getId(), projectId, normalisedTags.size());

        return architectureMapper.toDto(
            saved,
            architectureTagRepository.findByArchitectureId(saved.getId()));
    }

    /**
     * Updates an existing architecture's name, description, and full tag set
     * atomically (within a single transaction). The tag set is REPLACED:
     * all existing tag rows for the architecture are deleted and re-inserted
     * from the payload.
     *
     * Spec: Multi-Architecture CRUD UI + Tag Management (Spec #3)
     *
     * @param projectId       project the architecture must belong to (for
     *                        cross-project safety)
     * @param architectureId  architecture id to update
     * @param name            new name (validated as for create)
     * @param description     new description (nullable; validated as for create)
     * @param tags            new full tag set (replaces existing)
     * @return the updated architecture DTO with the fresh tag list
     * @throws ArchitectureNotFoundException        if the architecture id does
     *           not exist OR belongs to a different project (mapped to 404)
     * @throws IllegalArgumentException             on validation failure
     *           (mapped to 400)
     * @throws DuplicateArchitectureNameException   if another architecture in
     *           the same project already uses this name (mapped to 409)
     */
    @Transactional
    public ArchitectureDto update(UUID projectId,
                                  UUID architectureId,
                                  String name,
                                  String description,
                                  List<String> tags) {
        log.info("Updating architecture {} in project {}", architectureId, projectId);

        ArchitectureEntity entity = loadInProject(projectId, architectureId);

        String trimmedName = validateAndTrimName(name);
        String trimmedDescription = validateAndTrimDescription(description);
        List<String> normalisedTags = validateAndNormaliseTags(tags);

        if (architectureRepository.existsByProjectIdAndNameIgnoreCaseAndIdNot(
                projectId, trimmedName, architectureId)) {
            log.warn("Duplicate architecture name '{}' in project {} (excluding id {})",
                trimmedName, projectId, architectureId);
            throw new DuplicateArchitectureNameException(trimmedName);
        }

        entity.setName(trimmedName);
        entity.setDescription(trimmedDescription);
        ArchitectureEntity saved = architectureRepository.save(entity);

        // Atomic full tag-set replacement: delete-all-for-arch then insert
        // from the payload. Both happen inside this @Transactional method
        // so a failure rolls the entire change back.
        List<ArchitectureTagEntity> existing =
            architectureTagRepository.findByArchitectureId(architectureId);
        if (!existing.isEmpty()) {
            architectureTagRepository.deleteAll(existing);
            architectureTagRepository.flush();
        }
        for (String tag : normalisedTags) {
            architectureTagRepository.save(ArchitectureTagEntity.builder()
                .architectureId(architectureId)
                .tagValue(tag)
                .build());
        }

        log.info("Updated architecture {} (project={}, tags={})",
            architectureId, projectId, normalisedTags.size());

        return architectureMapper.toDto(
            saved,
            architectureTagRepository.findByArchitectureId(architectureId));
    }

    /**
     * Soft-deletes (archives) an architecture by setting {@code archived=true}.
     *
     * Last-architecture protection: refuses to archive the only remaining
     * non-archived architecture in the project (every project must always
     * have at least one live architecture).
     *
     * Spec: Multi-Architecture CRUD UI + Tag Management (Spec #3)
     *
     * @param projectId       project the architecture must belong to
     * @param architectureId  architecture id to archive
     * @return the archived architecture DTO (with {@code archived=true})
     * @throws ArchitectureNotFoundException if the architecture id does not
     *           exist or belongs to a different project (mapped to 404)
     * @throws LastArchitectureException     if archiving would leave the
     *           project with zero non-archived architectures (mapped to 422)
     */
    @Transactional
    public ArchitectureDto archive(UUID projectId, UUID architectureId) {
        log.info("Archiving architecture {} in project {}", architectureId, projectId);

        ArchitectureEntity entity = loadInProject(projectId, architectureId);

        if (Boolean.TRUE.equals(entity.getArchived())) {
            // Already archived -- idempotent: return current state.
            log.debug("Architecture {} already archived; returning current state", architectureId);
            return architectureMapper.toDto(
                entity,
                architectureTagRepository.findByArchitectureId(architectureId));
        }

        long nonArchivedCount =
            architectureRepository.countByProjectIdAndArchivedFalse(projectId);
        if (nonArchivedCount <= 1) {
            log.warn("Refusing to archive last architecture {} in project {}",
                architectureId, projectId);
            throw new LastArchitectureException();
        }

        entity.setArchived(true);
        ArchitectureEntity saved = architectureRepository.save(entity);

        log.info("Archived architecture {} in project {}", architectureId, projectId);

        return architectureMapper.toDto(
            saved,
            architectureTagRepository.findByArchitectureId(architectureId));
    }

    // ========================================================================
    // Proceed-with-remaining-criticals override (Spec 4 Task Group 4)
    //
    // The architect-conversation "proceed" step hard-gates on any REMAINING
    // CRITICAL CVE (Spec 4 steering). Overriding the gate records a once-per-
    // target-architecture audit trio on the architecture row, mirroring the
    // capture-session coverage-override trio. Read + write are null-guarded so a
    // PATCH-style omitted field never wipes a column.
    // ========================================================================

    /**
     * Reads the persisted "proceed with remaining criticals" override audit trio
     * for an architecture (for the later read-only override banner). Returns a
     * not-overridden default ({@code overridden=false}, all audit fields null)
     * when no override has been recorded.
     *
     * @param projectId      project the architecture must belong to
     * @param architectureId architecture id
     * @return the override read DTO (never null)
     * @throws ArchitectureNotFoundException if the architecture id does not exist
     *           or belongs to a different project (mapped to 404)
     */
    @Transactional(readOnly = true)
    public ProceedCriticalOverrideDto getProceedCriticalOverride(
            UUID projectId, UUID architectureId) {
        ArchitectureEntity entity = loadInProject(projectId, architectureId);
        return ProceedCriticalOverrideDto.of(
            entity.getProceedCriticalOverrideJustification(),
            entity.getProceedRemainingCriticalCount(),
            entity.getProceedCriticalOverrideAt());
    }

    /**
     * Persists (upserts) the "proceed with remaining criticals" override audit
     * trio on the target architecture. Null-guarded per
     * {@code project_primitive_double_dto_overwrite.md}: a request that omits a
     * field leaves the existing column untouched.
     *
     * <p>The justification is REQUIRED for a real override: a null/blank
     * justification is rejected with {@link IllegalArgumentException} (mapped to
     * 400) so the gate is never bypassed without a recorded reason -- mirroring
     * the coverage-override contract. The timestamp defaults to {@code now()}
     * when the request omits it.</p>
     *
     * @param projectId      project the architecture must belong to
     * @param architectureId target architecture id
     * @param request        the override trio (justification required)
     * @return the persisted override read DTO
     * @throws ArchitectureNotFoundException if the architecture id does not exist
     *           or belongs to a different project (mapped to 404)
     * @throws IllegalArgumentException      if the justification is null/blank
     *           (mapped to 400) -- an override must always carry a reason
     */
    @Transactional
    public ProceedCriticalOverrideDto upsertProceedCriticalOverride(
            UUID projectId, UUID architectureId,
            UpsertProceedCriticalOverrideRequest request) {
        ArchitectureEntity entity = loadInProject(projectId, architectureId);

        if (request == null
                || request.proceedCriticalOverrideJustification() == null
                || request.proceedCriticalOverrideJustification().isBlank()) {
            throw new IllegalArgumentException(
                "A proceed-with-remaining-criticals override requires a justification");
        }

        entity.setProceedCriticalOverrideJustification(
            request.proceedCriticalOverrideJustification().trim());
        // Boxed Integer: a null count leaves the prior audit count untouched
        // (the count is informational; the justification is the gate record).
        if (request.remainingCriticalCount() != null) {
            entity.setProceedRemainingCriticalCount(request.remainingCriticalCount());
        }
        entity.setProceedCriticalOverrideAt(
            request.proceedCriticalOverrideAt() != null
                ? request.proceedCriticalOverrideAt()
                : java.time.Instant.now());

        ArchitectureEntity saved = architectureRepository.save(entity);
        log.info("Recorded proceed-critical override for architecture {} in project {} "
            + "(remainingCritical={})", architectureId, projectId,
            saved.getProceedRemainingCriticalCount());

        return ProceedCriticalOverrideDto.of(
            saved.getProceedCriticalOverrideJustification(),
            saved.getProceedRemainingCriticalCount(),
            saved.getProceedCriticalOverrideAt());
    }

    // ========================================================================
    // Internal helpers
    // ========================================================================

    /**
     * Loads an architecture by id, ensuring it belongs to the specified
     * project. Throws {@link ArchitectureNotFoundException} (mapped to 404)
     * when the architecture is missing or owned by a different project --
     * cross-project access is treated as "not found" to avoid leaking
     * the existence of architectures the caller cannot see.
     */
    private ArchitectureEntity loadInProject(UUID projectId, UUID architectureId) {
        ArchitectureEntity entity = architectureRepository.findById(architectureId)
            .orElseThrow(() -> new ArchitectureNotFoundException(
                "Architecture not found: " + architectureId));
        if (!projectId.equals(entity.getProjectId())) {
            throw new ArchitectureNotFoundException(
                "Architecture " + architectureId + " not found in project " + projectId);
        }
        return entity;
    }

    /**
     * Package-private so {@link ArchitectureCloneService} can reuse it
     * without re-implementation (spec #6 decision #11).
     */
    String validateAndTrimName(String name) {
        if (name == null) {
            throw new IllegalArgumentException("Architecture name is required");
        }
        String trimmed = name.trim();
        if (trimmed.isEmpty()) {
            throw new IllegalArgumentException("Architecture name is required");
        }
        if (trimmed.length() > NAME_MAX_LENGTH) {
            throw new IllegalArgumentException(
                "Architecture name must be " + NAME_MAX_LENGTH + " characters or fewer");
        }
        return trimmed;
    }

    /**
     * Package-private so {@link ArchitectureCloneService} can reuse it
     * without re-implementation (spec #6 decision #11).
     */
    String validateAndTrimDescription(String description) {
        if (description == null) {
            return null;
        }
        String trimmed = description.trim();
        if (trimmed.length() > DESCRIPTION_MAX_LENGTH) {
            throw new IllegalArgumentException(
                "Architecture description must be " + DESCRIPTION_MAX_LENGTH + " characters or fewer");
        }
        // Treat blank descriptions as null so the column stays clean.
        return trimmed.isEmpty() ? null : trimmed;
    }

    /**
     * Package-private so {@link ArchitectureCloneService} can reuse it
     * without re-implementation (spec #6 decision #11).
     */
    List<String> validateAndNormaliseTags(List<String> tags) {
        if (tags == null || tags.isEmpty()) {
            return List.of();
        }
        Set<String> seen = new HashSet<>();
        java.util.List<String> result = new java.util.ArrayList<>();
        for (String raw : tags) {
            if (raw == null) {
                throw new IllegalArgumentException("Tag values must not be null");
            }
            String trimmed = raw.trim();
            if (trimmed.isEmpty()) {
                throw new IllegalArgumentException("Tag values must not be empty");
            }
            if (trimmed.length() > TAG_MAX_LENGTH) {
                throw new IllegalArgumentException(
                    "Tag values must be " + TAG_MAX_LENGTH + " characters or fewer");
            }
            // Case-sensitive duplicate check -- tags are free-form strings.
            if (!seen.add(trimmed)) {
                throw new IllegalArgumentException(
                    "Duplicate tag value: '" + trimmed + "'");
            }
            result.add(trimmed);
        }
        return result;
    }
}
