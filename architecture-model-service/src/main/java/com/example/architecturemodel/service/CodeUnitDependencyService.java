package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.EntityMapper;
import com.example.architecturemodel.model.dto.library.CodeUnitDependencyFindOrCreateResponse;
import com.example.architecturemodel.model.dto.relationship.CodeUnitDependencyDto;
import com.example.architecturemodel.model.entity.CodeUnitDependencyEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.relationship.CodeUnitDependencyRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;
import java.util.UUID;

/**
 * Service implementing find-or-create semantics for
 * {@link CodeUnitDependencyEntity} edges.
 *
 * <p>Spec: 2026-05-06-library-discovery-integration -- Task Group 1.</p>
 *
 * <p>Backs the new {@code POST .../code-unit-dependencies} endpoint:
 * deterministic find-or-create on the identity composite
 * {@code (source_application_point_id, target_application_point_id,
 * declared_name, declared_version)} with NULL-tolerance for
 * {@code declared_version}.</p>
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class CodeUnitDependencyService {

    private final ModelFileRepository modelFileRepository;
    private final CodeUnitDependencyRepository codeUnitDependencyRepository;
    private final EntityMapper entityMapper;

    /**
     * Find-or-create a CodeUnitDependency edge scoped to the (project,
     * architecture) pair.
     *
     * <p>Identity is {@code (source_application_point_id,
     * target_application_point_id, declared_name, declared_version)} with
     * NULL-tolerance on {@code declared_version} (a null input matches a
     * NULL stored value).</p>
     *
     * @param projectId      the owning project UUID
     * @param architectureId the owning architecture UUID
     * @param dto            the edge payload (id is ignored on insert; server
     *                       allocates the id)
     * @return the find-or-create response carrying the resolved id, the
     *         {@code is_new} flag, and the round-trip
     *         {@link CodeUnitDependencyDto}.
     * @throws ResourceNotFoundException if no model file exists for
     *                                   {@code (projectId, architectureId)}
     */
    @Transactional
    public CodeUnitDependencyFindOrCreateResponse findOrCreate(UUID projectId,
                                                               UUID architectureId,
                                                               CodeUnitDependencyDto dto) {
        if (dto == null) {
            throw new IllegalArgumentException("CodeUnitDependency payload is required");
        }
        if (dto.sourceApplicationPointId() == null || dto.sourceApplicationPointId().isBlank()) {
            throw new IllegalArgumentException("source_application_point_id is required");
        }
        if (dto.targetApplicationPointId() == null || dto.targetApplicationPointId().isBlank()) {
            throw new IllegalArgumentException("target_application_point_id is required");
        }
        if (dto.declaredName() == null || dto.declaredName().isBlank()) {
            throw new IllegalArgumentException("declared_name is required");
        }

        String modelFileId = resolveModelFileId(projectId, architectureId);

        Optional<CodeUnitDependencyEntity> existing = codeUnitDependencyRepository
            .findOneBySourceTargetDeclared(
                dto.sourceApplicationPointId(),
                dto.targetApplicationPointId(),
                dto.declaredName(),
                dto.declaredVersion());

        if (existing.isPresent()) {
            CodeUnitDependencyEntity row = existing.get();
            log.debug("CodeUnitDependency find branch: id={}, srcAp={}, tgtAp={}, declared={}@{}",
                row.getId(), row.getSourceApplicationPointId(), row.getTargetApplicationPointId(),
                row.getDeclaredName(), row.getDeclaredVersion());
            return new CodeUnitDependencyFindOrCreateResponse(
                row.getId(),
                false,
                entityMapper.toDto(row));
        }

        CodeUnitDependencyEntity newRow = entityMapper.toEntity(dto, modelFileId);
        if (newRow.getId() == null || newRow.getId().isBlank()) {
            newRow.setId(UUID.randomUUID().toString());
        }
        CodeUnitDependencyEntity saved = codeUnitDependencyRepository.save(newRow);

        log.info("CodeUnitDependency create branch: id={}, modelFileId={}, srcAp={}, tgtAp={}, declared={}@{}",
            saved.getId(), modelFileId, saved.getSourceApplicationPointId(),
            saved.getTargetApplicationPointId(), saved.getDeclaredName(), saved.getDeclaredVersion());

        return new CodeUnitDependencyFindOrCreateResponse(
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
}
