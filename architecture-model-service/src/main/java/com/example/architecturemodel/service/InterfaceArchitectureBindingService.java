package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.InterfaceArchitectureBindingResponse;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.model.entity.InterfaceEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.repository.ArchitectureRepository;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.entity.InterfaceRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;
import java.util.UUID;

/**
 * Service for resolving an interface's owning architecture.
 *
 * Underpins the gateway's {@code derivedBindingResolver} (spec #5 Group 2),
 * which is what the chatV2 handler calls when the LLM emits a
 * {@code contextBinding} block identifying the interface a derived-mode
 * conversation should bind to.
 *
 * Lookup chain:
 *   interfaceId -> InterfaceEntity -> modelFileId -> ModelFileEntity ->
 *   (projectId + architectureId) -> ArchitectureEntity (name + archived).
 *
 * The lookup is intentionally project-scoped: the caller passes the URL's
 * {@code projectId} and the service refuses to leak interfaces from a
 * different project (returns 404 just as if the interface did not exist).
 *
 * Spec: Multi-Architecture Save-Target Resolution (Spec #5) -- Task Group 1.
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class InterfaceArchitectureBindingService {

    private final InterfaceRepository interfaceRepository;
    private final ModelFileRepository modelFileRepository;
    private final ArchitectureRepository architectureRepository;

    /**
     * Resolves the architecture binding for the given interface within the
     * given project.
     *
     * @param projectId   the project UUID from the URL
     * @param interfaceId the interface id from the URL
     * @return the binding payload (architectureId, architectureName, archived)
     * @throws ResourceNotFoundException if the interface does not exist, the
     *   interface's owning model file is missing, the model file belongs to a
     *   different project, or the architecture row is missing. All of these
     *   collapse into a single 404 so cross-project access cannot be inferred
     *   from the response shape.
     */
    @Transactional(readOnly = true)
    public InterfaceArchitectureBindingResponse getArchitectureBinding(
            UUID projectId, String interfaceId) {
        log.debug("Resolving architecture binding for project={} interface={}",
            projectId, interfaceId);

        // 1. Load the interface row.
        InterfaceEntity interfaceEntity = interfaceRepository.findById(interfaceId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "Interface not found: " + interfaceId));

        // 2. Load the owning model file (carries projectId + architectureId).
        Optional<ModelFileEntity> modelFileOpt =
            modelFileRepository.findById(interfaceEntity.getModelFileId());
        if (modelFileOpt.isEmpty()) {
            // Orphaned interface row -- treat as not found from the caller's
            // perspective.
            throw new ResourceNotFoundException(
                "Interface not found: " + interfaceId);
        }
        ModelFileEntity modelFile = modelFileOpt.get();

        // 3. Project-scope guard: foreign-project interfaces look like 404s.
        if (modelFile.getProjectId() == null
                || !modelFile.getProjectId().equals(projectId)) {
            throw new ResourceNotFoundException(
                "Interface not found: " + interfaceId);
        }

        // 4. Resolve the architecture row for name + archived flag.
        UUID architectureId = modelFile.getArchitectureId();
        if (architectureId == null) {
            throw new ResourceNotFoundException(
                "Interface not found: " + interfaceId);
        }
        ArchitectureEntity architecture = architectureRepository.findById(architectureId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "Interface not found: " + interfaceId));

        // 5. Build the response. The archived flag is hydrated directly so
        //    callers can short-circuit on archived architectures without a
        //    second round-trip.
        return new InterfaceArchitectureBindingResponse(
            architecture.getId(),
            architecture.getName(),
            Boolean.TRUE.equals(architecture.getArchived())
        );
    }
}
