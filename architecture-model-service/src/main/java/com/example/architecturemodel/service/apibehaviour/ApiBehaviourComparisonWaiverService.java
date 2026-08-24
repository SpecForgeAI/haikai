package com.example.architecturemodel.service.apibehaviour;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourComparisonWaiverDto;
import com.example.architecturemodel.model.dto.apibehaviour.CreateApiBehaviourComparisonWaiverRequest;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourComparisonWaiverEntity;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourComparisonWaiverRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * CRUD for comparison waivers (Spec 2026-07-06-j, changeset 206).
 *
 * <p>List returns the project's EFFECTIVE set: its own rows plus the global
 * seed rows. Create always writes {@code scope='project'} for the path
 * project. Delete removes any row by id (including a seed row — the seeds are
 * deliberately editable data; deleting one makes the comparator strict for
 * that header everywhere).</p>
 */
@Service
@RequiredArgsConstructor
// No-db mode (app.features.include-database=false) runs without JPA
// repositories; every repository-backed bean carries this guard (2026-08-24
// sweep — unguarded beans broke the no-db ApplicationContext).
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
public class ApiBehaviourComparisonWaiverService {

    private static final Set<String> ALLOWED_DIMENSIONS = Set.of(
        "header", "body_path", "xml_xpath", "ordering_path", "break_fingerprint");

    private final ApiBehaviourComparisonWaiverRepository repository;

    @Transactional(readOnly = true)
    public List<ApiBehaviourComparisonWaiverDto> listEffective(UUID projectId) {
        return repository.findByProjectIdOrProjectIdIsNull(projectId).stream()
            .map(this::toDto)
            .toList();
    }

    @Transactional
    public ApiBehaviourComparisonWaiverDto create(
            UUID projectId, CreateApiBehaviourComparisonWaiverRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("Waiver body is required");
        }
        if (request.dimension() == null || !ALLOWED_DIMENSIONS.contains(request.dimension())) {
            throw new IllegalArgumentException(
                "dimension must be one of " + ALLOWED_DIMENSIONS + " (got: "
                    + request.dimension() + ")");
        }
        if (request.target() == null || request.target().isBlank()) {
            throw new IllegalArgumentException("target is required");
        }
        if (request.reason() == null || request.reason().isBlank()) {
            throw new IllegalArgumentException(
                "reason is required — a waiver without a reason is a silent tolerance");
        }
        // Header waivers are matched case-insensitively; store lowercase like
        // the seeds so reads need no normalisation.
        String target = "header".equals(request.dimension())
            ? request.target().trim().toLowerCase()
            : request.target().trim();

        ApiBehaviourComparisonWaiverEntity entity = ApiBehaviourComparisonWaiverEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .scope("project")
            .dimension(request.dimension())
            .target(target)
            .reason(request.reason())
            .author(request.author())
            .provenance(request.provenance())
            .build();
        return toDto(repository.saveAndFlush(entity));
    }

    @Transactional
    public void delete(UUID id) {
        ApiBehaviourComparisonWaiverEntity entity = repository.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException(
                "Comparison waiver not found: " + id));
        repository.delete(entity);
    }

    private ApiBehaviourComparisonWaiverDto toDto(ApiBehaviourComparisonWaiverEntity entity) {
        return new ApiBehaviourComparisonWaiverDto(
            entity.getId(),
            entity.getProjectId(),
            entity.getScope(),
            entity.getDimension(),
            entity.getTarget(),
            entity.getReason(),
            entity.getAuthor(),
            entity.getProvenance(),
            entity.getCreatedAt()
        );
    }
}
