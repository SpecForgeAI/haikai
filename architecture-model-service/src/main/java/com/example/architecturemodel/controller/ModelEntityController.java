package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.EntityMapper;
import com.example.architecturemodel.model.dto.entity.ApplicationComponentDto;
import com.example.architecturemodel.model.dto.entity.ApplicationDto;
import com.example.architecturemodel.model.dto.entity.ServiceDto;
import com.example.architecturemodel.model.entity.ApplicationComponentEntity;
import com.example.architecturemodel.model.entity.ApplicationEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.model.entity.ServiceEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.entity.ApplicationComponentRepository;
import com.example.architecturemodel.repository.entity.ApplicationRepository;
import com.example.architecturemodel.repository.entity.ServiceRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/**
 * REST Controller for retrieving individual meta-model entities by ID.
 *
 * Provides GET endpoints for services, applications, and application components
 * scoped to a (project, architecture) pair. Used by the discovery-service to
 * fetch entity details for service-scoped discovery runs.
 *
 * Spec: Service-Scoped Discovery
 * Task Group 5: archModelClient getService Method and Updated DTOs
 *
 * Spec: Multi-Architecture Plumbing (Spec #1)
 *   Added {architectureId} path variable. Forgetting it produces a 404
 *   at the route layer (no controller-side default-resolution).
 *
 * Base path: /api/model/projects/{projectId}/architectures/{architectureId}/entities
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/model/projects/{projectId}/architectures/{architectureId}/entities")
@RequiredArgsConstructor
@Slf4j
public class ModelEntityController {

    private final ModelFileRepository modelFileRepository;
    private final ServiceRepository serviceRepository;
    private final ApplicationRepository applicationRepository;
    private final ApplicationComponentRepository applicationComponentRepository;
    private final EntityMapper entityMapper;

    /**
     * GET /api/model/projects/{projectId}/architectures/{architectureId}/entities/services/{serviceId}
     *
     * Retrieve a single service entity by ID, scoped to a (project, architecture) pair.
     * Returns 404 if no model file exists for that pair, or if the service does not
     * exist, or if the service does not belong to that model file.
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID
     * @param serviceId the service entity ID
     * @return the ServiceDto
     */
    @GetMapping("/services/{serviceId}")
    public ResponseEntity<ServiceDto> getService(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable String serviceId) {
        log.debug("GET /api/model/projects/{}/architectures/{}/entities/services/{}",
            projectId, architectureId, serviceId);

        ModelFileEntity modelFile = modelFileRepository
            .findByProjectIdAndArchitectureId(projectId, architectureId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "No model file found for project: " + projectId
                    + " architecture: " + architectureId));

        ServiceEntity entity = serviceRepository.findById(serviceId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "Service not found: " + serviceId));

        if (!modelFile.getId().equals(entity.getModelFileId())) {
            throw new ResourceNotFoundException(
                "Service " + serviceId + " does not belong to project " + projectId
                    + " architecture " + architectureId);
        }

        return ResponseEntity.ok(entityMapper.toDto(entity));
    }

    /**
     * GET /api/model/projects/{projectId}/architectures/{architectureId}/entities/applications/{applicationId}
     *
     * Retrieve a single application entity by ID, scoped to a (project, architecture)
     * pair.
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID
     * @param applicationId the application entity ID
     * @return the ApplicationDto
     */
    @GetMapping("/applications/{applicationId}")
    public ResponseEntity<ApplicationDto> getApplication(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable String applicationId) {
        log.debug("GET /api/model/projects/{}/architectures/{}/entities/applications/{}",
            projectId, architectureId, applicationId);

        ModelFileEntity modelFile = modelFileRepository
            .findByProjectIdAndArchitectureId(projectId, architectureId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "No model file found for project: " + projectId
                    + " architecture: " + architectureId));

        ApplicationEntity entity = applicationRepository.findById(applicationId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "Application not found: " + applicationId));

        if (!modelFile.getId().equals(entity.getModelFileId())) {
            throw new ResourceNotFoundException(
                "Application " + applicationId + " does not belong to project " + projectId
                    + " architecture " + architectureId);
        }

        return ResponseEntity.ok(entityMapper.toDto(entity));
    }

    /**
     * GET /api/model/projects/{projectId}/architectures/{architectureId}/entities/app_components/{appComponentId}
     *
     * Retrieve a single application component entity by ID, scoped to a (project,
     * architecture) pair.
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID
     * @param appComponentId the application component entity ID
     * @return the ApplicationComponentDto
     */
    @GetMapping("/app_components/{appComponentId}")
    public ResponseEntity<ApplicationComponentDto> getAppComponent(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable String appComponentId) {
        log.debug("GET /api/model/projects/{}/architectures/{}/entities/app_components/{}",
            projectId, architectureId, appComponentId);

        ModelFileEntity modelFile = modelFileRepository
            .findByProjectIdAndArchitectureId(projectId, architectureId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "No model file found for project: " + projectId
                    + " architecture: " + architectureId));

        ApplicationComponentEntity entity = applicationComponentRepository.findById(appComponentId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "Application component not found: " + appComponentId));

        if (!modelFile.getId().equals(entity.getModelFileId())) {
            throw new ResourceNotFoundException(
                "Application component " + appComponentId + " does not belong to project "
                    + projectId + " architecture " + architectureId);
        }

        return ResponseEntity.ok(entityMapper.toDto(entity));
    }
}
