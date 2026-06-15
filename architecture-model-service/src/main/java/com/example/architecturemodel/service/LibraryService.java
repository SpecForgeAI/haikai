package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.EntityMapper;
import com.example.architecturemodel.model.dto.entity.LibraryDto;
import com.example.architecturemodel.model.dto.library.LibraryFindOrCreateResponse;
import com.example.architecturemodel.model.entity.ApplicationEntity;
import com.example.architecturemodel.model.entity.ApplicationPointEntity;
import com.example.architecturemodel.model.entity.LibraryEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.entity.ApplicationPointRepository;
import com.example.architecturemodel.repository.entity.ApplicationRepository;
import com.example.architecturemodel.repository.entity.LibraryRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Service implementing find-or-create + scoped find-by-id semantics for
 * {@link LibraryEntity}.
 *
 * <p>Spec: 2026-05-06-library-discovery-integration -- Task Group 1.</p>
 *
 * <p>Backs the 2 new {@code LibraryController} endpoints:</p>
 * <ul>
 *   <li>{@code POST /api/model/projects/{p}/architectures/{a}/libraries} --
 *       deterministic find-or-create on {@code (model_file_id, name,
 *       ecosystem)}; on insert, the SAME transaction inserts a derived
 *       {@link ApplicationPointEntity} with {@code target_type='LIBRARY'},
 *       {@code target_ref_id=<new library id>}, {@code kind='LIBRARY'}.</li>
 *   <li>{@code GET /api/model/projects/{p}/architectures/{a}/libraries/{id}}
 *       -- scoped lookup; returns empty Optional on miss / scoping mismatch
 *       (controller maps to 404).</li>
 * </ul>
 *
 * <p>{@code last_verified_at} is touched on every find-or-create call
 * (whether the find branch or the create branch hit) so the discovery-touch
 * timestamp tracks freshness; this matches the locked contract from the
 * spec's "source provenance" rules.</p>
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class LibraryService {

    private final ModelFileRepository modelFileRepository;
    private final LibraryRepository libraryRepository;
    private final ApplicationPointRepository applicationPointRepository;
    private final ApplicationRepository applicationRepository;
    private final EntityMapper entityMapper;

    /**
     * Find-or-create a Library row scoped to the (project, architecture) pair.
     *
     * <p>Identity is {@code (model_file_id, name, ecosystem)}. On match, the
     * existing row is returned with {@code is_new=false} and
     * {@code last_verified_at} is touched. On miss, a new row is inserted AND
     * a derived {@link ApplicationPointEntity} with
     * {@code target_type='LIBRARY'} is inserted in the SAME transaction --
     * mirrors the Service-side derived-AP creation pattern referenced by the
     * spec.</p>
     *
     * @param projectId      the owning project UUID
     * @param architectureId the owning architecture UUID
     * @param dto            the library payload (id is ignored; server
     *                       allocates the id on insert)
     * @return the find-or-create response carrying the resolved Library id,
     *         the derived AP id, the {@code is_new} flag, and the round-trip
     *         {@link LibraryDto}.
     * @throws ResourceNotFoundException if no model file exists for
     *                                   {@code (projectId, architectureId)}
     */
    @Transactional
    public LibraryFindOrCreateResponse findOrCreate(UUID projectId,
                                                    UUID architectureId,
                                                    LibraryDto dto) {
        if (dto == null) {
            throw new IllegalArgumentException("Library payload is required");
        }
        if (dto.name() == null || dto.name().isBlank()) {
            throw new IllegalArgumentException("Library name is required");
        }
        if (dto.ecosystem() == null || dto.ecosystem().isBlank()) {
            throw new IllegalArgumentException("Library ecosystem is required");
        }

        String modelFileId = resolveModelFileId(projectId, architectureId);

        Optional<LibraryEntity> existing = libraryRepository
            .findByModelFileIdAndNameAndEcosystem(modelFileId, dto.name(), dto.ecosystem());

        if (existing.isPresent()) {
            LibraryEntity row = existing.get();
            // Touch last_verified_at on every find-or-create call so the
            // discovery-touch timestamp tracks freshness (locked contract).
            row.setLastVerifiedAt(Instant.now().toString());
            LibraryEntity saved = libraryRepository.save(row);

            String derivedApId = findDerivedApplicationPointId(modelFileId, saved.getId());
            log.debug("Library find branch: id={}, modelFileId={}, name={}, ecosystem={}",
                saved.getId(), modelFileId, saved.getName(), saved.getEcosystem());

            return new LibraryFindOrCreateResponse(
                saved.getId(),
                derivedApId,
                false,
                entityMapper.toDto(saved));
        }

        // Insert branch: allocate a fresh id and persist the Library row, then
        // insert the derived ApplicationPoint in the same transaction.
        LibraryEntity newLib = entityMapper.toEntity(dto, modelFileId);
        if (newLib.getId() == null || newLib.getId().isBlank()) {
            newLib.setId(UUID.randomUUID().toString());
        }
        // Always stamp last_verified_at on insert.
        newLib.setLastVerifiedAt(Instant.now().toString());
        LibraryEntity savedLib = libraryRepository.save(newLib);

        ApplicationPointEntity derivedAp = ApplicationPointEntity.builder()
            .id(UUID.randomUUID().toString())
            .modelFileId(modelFileId)
            .name(savedLib.getName())
            .kind("LIBRARY")
            // application_id is NOT NULL on the underlying column AND is a
            // FK to applications(id) (schema.sql:146 -- enforced by PostgreSQL
            // in production). A Library does not naturally belong to a
            // specific Application, so we use the first Application of the
            // model file as a sentinel value satisfying the FK constraint.
            // The canonical pointer for Library targeting is target_type +
            // target_ref_id below; application_id is structural plumbing only.
            .applicationId(resolveApplicationId(modelFileId))
            .targetType("LIBRARY")
            .targetRefId(savedLib.getId())
            .build();
        ApplicationPointEntity savedAp = applicationPointRepository.save(derivedAp);

        log.info("Library create branch: id={}, modelFileId={}, name={}, ecosystem={}, derivedApId={}",
            savedLib.getId(), modelFileId, savedLib.getName(), savedLib.getEcosystem(), savedAp.getId());

        return new LibraryFindOrCreateResponse(
            savedLib.getId(),
            savedAp.getId(),
            true,
            entityMapper.toDto(savedLib));
    }

    /**
     * Look up a single Library by id, scoped to {@code (projectId,
     * architectureId)}. Returns empty Optional if no model file exists for
     * the pair, the Library does not exist, or the Library does not belong
     * to the resolved model file (controller maps any of these to 404).
     */
    @Transactional(readOnly = true)
    public Optional<LibraryDto> findById(UUID projectId,
                                         UUID architectureId,
                                         String libraryId) {
        if (libraryId == null || libraryId.isBlank()) {
            return Optional.empty();
        }
        Optional<ModelFileEntity> modelFile = modelFileRepository
            .findByProjectIdAndArchitectureId(projectId, architectureId);
        if (modelFile.isEmpty()) {
            return Optional.empty();
        }
        return libraryRepository.findById(libraryId)
            .filter(row -> modelFile.get().getId().equals(row.getModelFileId()))
            .map(entityMapper::toDto);
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
     * Resolve a sentinel {@code application_id} for a derived Library
     * ApplicationPoint. The {@code application_points.application_id} column
     * is NOT NULL and FK-references {@code applications(id)} in production
     * (schema.sql:146); a Library is not naturally owned by a specific
     * Application, so we pick the first Application registered for the model
     * file as a structural sentinel. The canonical Library pointer remains
     * {@code target_type='LIBRARY'} + {@code target_ref_id=<library id>}.
     *
     * @throws IllegalStateException if the model file has no Applications --
     *         the caller cannot honour the FK and discovery integration
     *         requires the parent model to declare at least one Application
     *         before Libraries can be discovered.
     */
    private String resolveApplicationId(String modelFileId) {
        return applicationRepository.findByModelFileId(modelFileId).stream()
            .findFirst()
            .map(ApplicationEntity::getId)
            .orElseThrow(() -> new IllegalStateException(
                "Cannot create derived ApplicationPoint for Library: model file has no Applications."));
    }

    /**
     * Best-effort lookup of the existing derived ApplicationPoint for a
     * Library row in a given model file. Returns {@code null} if the find
     * branch hits a Library row but no derived AP was found (e.g. legacy
     * data created before this find-or-create flow was wired in). Discovery
     * callers that require a non-null AP id should treat this as a
     * data-quality signal and surface the case rather than silently
     * fabricating an AP.
     */
    private String findDerivedApplicationPointId(String modelFileId, String libraryId) {
        List<ApplicationPointEntity> aps = applicationPointRepository.findByModelFileId(modelFileId);
        return aps.stream()
            .filter(ap -> "LIBRARY".equals(ap.getTargetType())
                && libraryId.equals(ap.getTargetRefId()))
            .map(ApplicationPointEntity::getId)
            .findFirst()
            .orElse(null);
    }
}
