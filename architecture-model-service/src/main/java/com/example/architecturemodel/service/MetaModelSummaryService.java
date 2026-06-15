package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.MetaModelSummaryDto;
import com.example.architecturemodel.model.dto.MetaModelSummaryDto.EntitySummary;
import com.example.architecturemodel.model.dto.MetaModelSummaryDto.RelationshipSummary;
import com.example.architecturemodel.model.entity.*;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.entity.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Service for generating meta-model summary for the Bootstrap phase.
 *
 * Builds a comprehensive summary of the architecture meta-model including
 * services, data entities, interfaces, and their relationships.
 *
 * All entities are resolved to human-readable names and scoped to the
 * active project.
 *
 * Spec: Implement Assistant Stage 3 - Bootstrap Phase
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class MetaModelSummaryService {

    private final ModelFileRepository modelFileRepository;
    private final ApplicationRepository applicationRepository;
    private final ApplicationComponentRepository applicationComponentRepository;
    private final ServiceRepository serviceRepository;
    private final InterfaceRepository interfaceRepository;
    private final LogicalDataEntityRepository logicalDataEntityRepository;
    private final PhysicalDataEntityRepository physicalDataEntityRepository;
    private final BusinessUserRepository businessUserRepository;
    private final ProcessActivityRepository processActivityRepository;
    private final UIScreenRepository uiScreenRepository;
    // User Journey Meta-Model Foundation
    private final UserJourneyRepository userJourneyRepository;

    /**
     * Get the meta-model summary for a project + architecture pair.
     *
     * Spec: Multi-Architecture Plumbing (Spec #1).
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID (must belong to the project)
     * @return MetaModelSummaryDto with all entities and relationships
     * @throws ResourceNotFoundException if no model file exists for the
     *   (projectId, architectureId) pair
     */
    @Transactional(readOnly = true)
    public MetaModelSummaryDto getMetaModelSummary(UUID projectId, UUID architectureId) {
        log.debug("Getting meta-model summary for project: {} architecture: {}", projectId, architectureId);

        // Look up model file by project UUID + architecture UUID (architecture-scoped)
        ModelFileEntity modelFile = modelFileRepository.findByProjectIdAndArchitectureId(projectId, architectureId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "Model file not found for project: " + projectId + " architecture: " + architectureId));

        String modelFileId = modelFile.getId();

        // Fetch all entity types
        List<EntitySummary> applications = fetchApplications(modelFileId);
        List<EntitySummary> services = fetchServices(modelFileId);
        List<EntitySummary> dataEntities = fetchDataEntities(modelFileId);
        List<EntitySummary> interfaces = fetchInterfaces(modelFileId);
        List<EntitySummary> businessUsers = fetchBusinessUsers(modelFileId);
        List<EntitySummary> processActivities = fetchProcessActivities(modelFileId);
        List<EntitySummary> uiScreens = fetchUIScreens(modelFileId);
        List<EntitySummary> userJourneys = fetchUserJourneys(modelFileId);
        int dataStoreCount = countDataStores(modelFileId);

        // Build relationships from service-interface and interface-data connections
        List<RelationshipSummary> relationships = buildRelationships(
            modelFileId, services, dataEntities, interfaces);

        log.debug("Built meta-model summary with {} applications, {} services, {} data entities, {} interfaces, {} relationships, {} business users, {} process activities, {} UI screens, {} user journeys, {} data stores",
            applications.size(), services.size(), dataEntities.size(), interfaces.size(), relationships.size(),
            businessUsers.size(), processActivities.size(), uiScreens.size(), userJourneys.size(), dataStoreCount);

        return new MetaModelSummaryDto(applications, services, dataEntities, interfaces, relationships,
            businessUsers, processActivities, uiScreens, userJourneys, dataStoreCount);
    }

    /**
     * Fetch all applications for a model file.
     */
    private List<EntitySummary> fetchApplications(String modelFileId) {
        return applicationRepository.findByModelFileId(modelFileId).stream()
            .map(entity -> new EntitySummary(
                entity.getId(),
                entity.getName(),
                "applications"
            ))
            .collect(Collectors.toList());
    }

    /**
     * Count data stores: services whose parent application component has
     * tech_type = 'Persistence Tier'.
     */
    private int countDataStores(String modelFileId) {
        var allComponents = applicationComponentRepository.findByModelFileId(modelFileId);
        log.debug("countDataStores: found {} app components for modelFileId={}",
            allComponents.size(), modelFileId);
        allComponents.forEach(ac -> log.debug("  AppComponent id={} name='{}' techType='{}'",
            ac.getId(), ac.getName(), ac.getTechType()));

        Set<String> persistenceComponentIds = allComponents.stream()
            .filter(ac -> "Persistence Tier".equals(ac.getTechType()))
            .map(ApplicationComponentEntity::getId)
            .collect(Collectors.toSet());

        log.debug("countDataStores: {} persistence tier components: {}",
            persistenceComponentIds.size(), persistenceComponentIds);

        if (persistenceComponentIds.isEmpty()) {
            return 0;
        }

        var allServices = serviceRepository.findByModelFileId(modelFileId);
        allServices.forEach(s -> log.debug("  Service id={} name='{}' appComponentId='{}'",
            s.getId(), s.getName(), s.getApplicationComponentId()));

        int count = (int) allServices.stream()
            .filter(s -> s.getApplicationComponentId() != null
                && persistenceComponentIds.contains(s.getApplicationComponentId()))
            .count();
        log.debug("countDataStores: matched {} services", count);
        return count;
    }

    /**
     * Fetch all services for a model file.
     *
     * @param modelFileId the model file ID
     * @return list of service summaries
     */
    private List<EntitySummary> fetchServices(String modelFileId) {
        return serviceRepository.findByModelFileId(modelFileId).stream()
            .map(entity -> new EntitySummary(
                entity.getId(),
                entity.getName(),
                "services"
            ))
            .collect(Collectors.toList());
    }

    /**
     * Fetch all data entities (both logical and physical) for a model file.
     *
     * @param modelFileId the model file ID
     * @return list of data entity summaries
     */
    private List<EntitySummary> fetchDataEntities(String modelFileId) {
        List<EntitySummary> dataEntities = new ArrayList<>();

        // Add logical data entities
        logicalDataEntityRepository.findByModelFileId(modelFileId).stream()
            .map(entity -> new EntitySummary(
                entity.getId(),
                entity.getName(),
                "logicalDataEntities"
            ))
            .forEach(dataEntities::add);

        // Add physical data entities
        physicalDataEntityRepository.findByModelFileId(modelFileId).stream()
            .map(entity -> new EntitySummary(
                entity.getId(),
                entity.getName(),
                "physicalDataEntities"
            ))
            .forEach(dataEntities::add);

        return dataEntities;
    }

    /**
     * Fetch all interfaces for a model file.
     *
     * @param modelFileId the model file ID
     * @return list of interface summaries
     */
    private List<EntitySummary> fetchInterfaces(String modelFileId) {
        return interfaceRepository.findByModelFileId(modelFileId).stream()
            .map(entity -> new EntitySummary(
                entity.getId(),
                entity.getName(),
                "interfaces"
            ))
            .collect(Collectors.toList());
    }

    /**
     * Fetch all business users for a model file.
     */
    private List<EntitySummary> fetchBusinessUsers(String modelFileId) {
        return businessUserRepository.findByModelFileId(modelFileId).stream()
            .map(entity -> new EntitySummary(
                entity.getId(),
                entity.getName(),
                "businessUsers"
            ))
            .collect(Collectors.toList());
    }

    /**
     * Fetch all process activities for a model file.
     */
    private List<EntitySummary> fetchProcessActivities(String modelFileId) {
        return processActivityRepository.findByModelFileId(modelFileId).stream()
            .map(entity -> new EntitySummary(
                entity.getId(),
                entity.getName(),
                "processActivities"
            ))
            .collect(Collectors.toList());
    }

    /**
     * Fetch all UI screens for a model file.
     */
    private List<EntitySummary> fetchUIScreens(String modelFileId) {
        return uiScreenRepository.findByModelFileId(modelFileId).stream()
            .map(entity -> new EntitySummary(
                entity.getId(),
                entity.getName(),
                "uiScreens"
            ))
            .collect(Collectors.toList());
    }

    /**
     * Fetch all user journeys for a model file.
     *
     * Spec: User Journey Meta-Model Foundation
     */
    private List<EntitySummary> fetchUserJourneys(String modelFileId) {
        return userJourneyRepository.findByModelFileId(modelFileId).stream()
            .map(entity -> new EntitySummary(
                entity.getId(),
                entity.getName(),
                "userJourneys"
            ))
            .collect(Collectors.toList());
    }

    /**
     * Build relationships between entities.
     *
     * Relationships are derived from:
     * - Services to Interfaces (service owns interface)
     * - Interfaces to Data Entities (interface uses data)
     *
     * @param modelFileId the model file ID
     * @param services list of service summaries
     * @param dataEntities list of data entity summaries
     * @param interfaces list of interface summaries
     * @return list of relationship summaries
     */
    private List<RelationshipSummary> buildRelationships(
            String modelFileId,
            List<EntitySummary> services,
            List<EntitySummary> dataEntities,
            List<EntitySummary> interfaces) {

        List<RelationshipSummary> relationships = new ArrayList<>();

        // Build lookup maps by ID for name resolution
        Map<String, String> serviceNameById = services.stream()
            .collect(Collectors.toMap(EntitySummary::id, EntitySummary::name));
        Map<String, String> dataEntityNameById = dataEntities.stream()
            .collect(Collectors.toMap(EntitySummary::id, EntitySummary::name));
        Map<String, String> interfaceNameById = interfaces.stream()
            .collect(Collectors.toMap(EntitySummary::id, EntitySummary::name));

        // Add service-to-interface relationships
        interfaceRepository.findByModelFileId(modelFileId).stream()
            .filter(iface -> iface.getServiceId() != null)
            .forEach(iface -> {
                String serviceName = serviceNameById.get(iface.getServiceId());
                if (serviceName != null) {
                    relationships.add(new RelationshipSummary(
                        serviceName,
                        iface.getName(),
                        "exposes"
                    ));
                }
            });

        // Add interface-to-data relationships if any data entity references exist
        // (This would need more specific data modeling to implement fully)

        return relationships;
    }
}
