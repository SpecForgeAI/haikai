package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.EntityMapper;
import com.example.architecturemodel.model.dto.entity.ApplicationPointDto;
import com.example.architecturemodel.model.dto.library.ApplicationPointFindOrCreateResponse;
import com.example.architecturemodel.model.entity.ApplicationEntity;
import com.example.architecturemodel.model.entity.ApplicationPointEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.entity.ApplicationPointRepository;
import com.example.architecturemodel.repository.entity.ApplicationRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;
import java.util.UUID;

/**
 * Service implementing find-by-target and find-or-create semantics for
 * {@link ApplicationPointEntity} keyed by the canonical tuple
 * {@code (model_file_id, target_type, target_ref_id)}.
 *
 * <p>Fix #5 (synthetic-placeholder removal): backs the 2 new endpoints used
 * by the discovery-service to resolve a real AP UUID for a Service or
 * Library root, with a self-heal create branch that satisfies the FK
 * constraint on {@code application_points.application_id} via the same
 * sentinel pattern used by {@link LibraryService}: pick the first
 * Application registered for the model file.</p>
 *
 * <p>Endpoints backed:</p>
 * <ul>
 *   <li>{@code GET .../application-points/by-target?targetType=&targetRefId=}
 *       -- {@link #findByTarget(UUID, UUID, String, String)}.</li>
 *   <li>{@code POST .../application-points} -- {@link #findOrCreate(UUID, UUID, ApplicationPointDto)}.</li>
 * </ul>
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class ApplicationPointService {

    private final ModelFileRepository modelFileRepository;
    private final ApplicationPointRepository applicationPointRepository;
    private final ApplicationRepository applicationRepository;
    private final EntityMapper entityMapper;

    /**
     * Look up an ApplicationPoint by its targeting tuple. Returns empty if
     * the model file does not exist for the (project, architecture) pair or
     * no AP matches the (target_type, target_ref_id) within that scope.
     */
    @Transactional(readOnly = true)
    public Optional<ApplicationPointDto> findByTarget(UUID projectId,
                                                      UUID architectureId,
                                                      String targetType,
                                                      String targetRefId) {
        if (targetType == null || targetType.isBlank()) {
            return Optional.empty();
        }
        if (targetRefId == null || targetRefId.isBlank()) {
            return Optional.empty();
        }
        Optional<ModelFileEntity> modelFile = modelFileRepository
            .findByProjectIdAndArchitectureId(projectId, architectureId);
        if (modelFile.isEmpty()) {
            return Optional.empty();
        }
        return applicationPointRepository
            .findByModelFileIdAndTargetTypeAndTargetRefId(
                modelFile.get().getId(), targetType, targetRefId)
            .map(entityMapper::toDto);
    }

    /**
     * Find-or-create an ApplicationPoint scoped to the (project,
     * architecture) pair, keyed by {@code (model_file_id, target_type,
     * target_ref_id)}. On miss, persists a new row with the sentinel
     * {@code application_id} resolved from the first Application of the
     * model file (mirrors the Library-side pattern from Fix #4).
     *
     * @throws ResourceNotFoundException if the model file does not exist.
     * @throws IllegalArgumentException  if {@code target_type} or
     *                                   {@code target_ref_id} is missing.
     * @throws IllegalStateException     if the model file has no
     *                                   Applications (cannot honour the
     *                                   {@code application_id} FK).
     */
    @Transactional
    public ApplicationPointFindOrCreateResponse findOrCreate(UUID projectId,
                                                             UUID architectureId,
                                                             ApplicationPointDto dto) {
        if (dto == null) {
            throw new IllegalArgumentException("ApplicationPoint payload is required");
        }
        if (dto.targetType() == null || dto.targetType().isBlank()) {
            throw new IllegalArgumentException("target_type is required");
        }
        if (dto.targetRefId() == null || dto.targetRefId().isBlank()) {
            throw new IllegalArgumentException("target_ref_id is required");
        }

        String modelFileId = resolveModelFileId(projectId, architectureId);

        Optional<ApplicationPointEntity> existing = applicationPointRepository
            .findByModelFileIdAndTargetTypeAndTargetRefId(
                modelFileId, dto.targetType(), dto.targetRefId());

        if (existing.isPresent()) {
            ApplicationPointEntity row = existing.get();
            log.debug("ApplicationPoint find branch: id={}, modelFileId={}, targetType={}, targetRefId={}",
                row.getId(), modelFileId, row.getTargetType(), row.getTargetRefId());
            return new ApplicationPointFindOrCreateResponse(
                row.getId(),
                false,
                entityMapper.toDto(row));
        }

        // Insert branch: allocate fresh id, resolve sentinel application_id
        // (FK to applications.id), persist.
        String newId = (dto.id() == null || dto.id().isBlank())
            ? UUID.randomUUID().toString()
            : dto.id();
        String resolvedApplicationId = (dto.applicationId() != null && !dto.applicationId().isBlank())
            ? dto.applicationId()
            : resolveApplicationId(modelFileId);

        ApplicationPointEntity newAp = ApplicationPointEntity.builder()
            .id(newId)
            .modelFileId(modelFileId)
            .name(dto.name() != null ? dto.name() : dto.targetRefId())
            .description(dto.description())
            .kind(dto.kind() != null ? dto.kind() : dto.targetType())
            .applicationId(resolvedApplicationId)
            .applicationComponentId(dto.applicationComponentId())
            .serviceId(dto.serviceId())
            .interfaceId(dto.interfaceId())
            .targetType(dto.targetType())
            .targetRefId(dto.targetRefId())
            .pointType(dto.pointType())
            .tags(dto.tags())
            .validFrom(dto.validFrom())
            .validTo(dto.validTo())
            .build();
        ApplicationPointEntity saved = applicationPointRepository.save(newAp);

        log.info("ApplicationPoint create branch: id={}, modelFileId={}, targetType={}, targetRefId={}, applicationId={}",
            saved.getId(), modelFileId, saved.getTargetType(), saved.getTargetRefId(), saved.getApplicationId());

        return new ApplicationPointFindOrCreateResponse(
            saved.getId(),
            true,
            entityMapper.toDto(saved));
    }

    private String resolveModelFileId(UUID projectId, UUID architectureId) {
        ModelFileEntity modelFile = modelFileRepository
            .findByProjectIdAndArchitectureId(projectId, architectureId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "No model file found for project: " + projectId
                    + " architecture: " + architectureId));
        return modelFile.getId();
    }

    /**
     * Resolve a sentinel {@code application_id} (FK to {@code applications.id})
     * for an ApplicationPoint that does not naturally belong to a specific
     * Application -- e.g. a SERVICE / LIBRARY root self-healed by the
     * discovery-service. Picks the first Application registered for the
     * model file. The canonical pointer is always
     * {@code target_type + target_ref_id}; {@code application_id} is
     * structural plumbing only.
     */
    private String resolveApplicationId(String modelFileId) {
        return applicationRepository.findByModelFileId(modelFileId).stream()
            .findFirst()
            .map(ApplicationEntity::getId)
            .orElseThrow(() -> new IllegalStateException(
                "Cannot create ApplicationPoint: model file has no Applications."));
    }
}
