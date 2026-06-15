package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.interface_discovery.*;
import com.example.architecturemodel.model.entity.*;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.entity.*;
import com.example.architecturemodel.repository.relationship.InterfaceLogicalEntityRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;
import java.util.stream.Collectors;

/**
 * Service for interface discovery operations.
 * Provides methods to list interfaces for a model file and retrieve
 * OAS-ready context for a specific interface.
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class InterfaceDiscoveryService {

    private final ModelFileRepository modelFileRepository;
    private final InterfaceRepository interfaceRepository;
    private final ServiceRepository serviceRepository;
    private final ApplicationRepository applicationRepository;
    private final EndpointRepository endpointRepository;
    private final InterfaceLogicalEntityRepository interfaceLogicalEntityRepository;
    private final LogicalDataEntityRepository logicalDataEntityRepository;
    private final LogicalDataAttributeRepository logicalDataAttributeRepository;

    /**
     * Lists all interfaces for a given model file.
     *
     * @param filename the name of the model file
     * @return list of interface summaries sorted by interfaceId
     * @throws ResourceNotFoundException if the filename is not found
     */
    @Transactional(readOnly = true)
    public List<InterfaceSummaryDto> listInterfaces(String filename) {
        log.debug("Listing interfaces for filename: {}", filename);

        // Look up modelFileId by filename
        ModelFileEntity modelFile = modelFileRepository.findByFilename(filename)
                .orElseThrow(() -> new ResourceNotFoundException("Model file not found: " + filename));

        String modelFileId = modelFile.getId();

        // Query all interfaces for this model file
        List<InterfaceEntity> interfaces = interfaceRepository.findByModelFileId(modelFileId);

        // Build lookup maps for services and applications
        Map<String, ServiceEntity> serviceMap = serviceRepository.findByModelFileId(modelFileId)
                .stream()
                .collect(Collectors.toMap(ServiceEntity::getId, s -> s));

        Map<String, ApplicationEntity> applicationMap = applicationRepository.findByModelFileId(modelFileId)
                .stream()
                .collect(Collectors.toMap(ApplicationEntity::getId, a -> a));

        // Build endpoint count map
        Map<String, Long> endpointCountMap = endpointRepository.findByModelFileId(modelFileId)
                .stream()
                .collect(Collectors.groupingBy(EndpointEntity::getInterfaceId, Collectors.counting()));

        // Build the summary DTOs
        List<InterfaceSummaryDto> summaries = interfaces.stream()
                .map(ifc -> {
                    ServiceEntity service = serviceMap.get(ifc.getServiceId());
                    ApplicationEntity application = null;
                    if (service != null) {
                        application = applicationMap.get(service.getApplicationId());
                    }

                    int endpointCount = endpointCountMap.getOrDefault(ifc.getId(), 0L).intValue();

                    return new InterfaceSummaryDto(
                            ifc.getId(),
                            ifc.getName(),
                            ifc.getInterfaceType(),
                            service != null ? service.getId() : null,
                            service != null ? service.getName() : null,
                            application != null ? application.getId() : null,
                            application != null ? application.getName() : null,
                            endpointCount
                    );
                })
                .sorted(Comparator.comparing(InterfaceSummaryDto::interfaceId,
                        Comparator.nullsLast(Comparator.naturalOrder())))
                .collect(Collectors.toList());

        log.debug("Found {} interfaces for filename: {}", summaries.size(), filename);
        return summaries;
    }

    /**
     * Gets the full OAS-ready context for an interface by its globally unique ID.
     *
     * @param interfaceId the interface ID
     * @return the full OAS context including interface, service, application, endpoints, and logical entities
     * @throws ResourceNotFoundException if the interface ID is not found
     */
    @Transactional(readOnly = true)
    public InterfaceOasContextDto getInterfaceOasContext(String interfaceId) {
        log.debug("Getting OAS context for interfaceId: {}", interfaceId);

        // Query interface by ID globally
        InterfaceEntity interfaceEntity = interfaceRepository.findById(interfaceId)
                .orElseThrow(() -> new ResourceNotFoundException("Interface not found: " + interfaceId));

        // Build interface detail DTO
        InterfaceDetailDto interfaceDetail = new InterfaceDetailDto(
                interfaceEntity.getId(),
                interfaceEntity.getName(),
                interfaceEntity.getDescription(),
                interfaceEntity.getInterfaceType(),
                interfaceEntity.getSpecLink(),
                interfaceEntity.getTags(),
                interfaceEntity.getValidFrom(),
                interfaceEntity.getValidTo()
        );

        // Load service by serviceId (nullable)
        ServiceDetailDto serviceDetail = null;
        ApplicationDetailDto applicationDetail = null;

        if (interfaceEntity.getServiceId() != null) {
            Optional<ServiceEntity> serviceOpt = serviceRepository.findById(interfaceEntity.getServiceId());
            if (serviceOpt.isPresent()) {
                ServiceEntity service = serviceOpt.get();
                serviceDetail = new ServiceDetailDto(
                        service.getId(),
                        service.getName(),
                        service.getDescription(),
                        service.getServiceType(),
                        service.getTags()
                );

                // Load application by service.applicationId (nullable)
                if (service.getApplicationId() != null) {
                    Optional<ApplicationEntity> appOpt = applicationRepository.findById(service.getApplicationId());
                    if (appOpt.isPresent()) {
                        ApplicationEntity app = appOpt.get();
                        applicationDetail = new ApplicationDetailDto(
                                app.getId(),
                                app.getName(),
                                app.getDescription(),
                                app.getAppType(),
                                app.getStatus(),
                                app.getTags()
                        );
                    }
                }
            }
        }

        // Load endpoints by interfaceId, sorted by (operationVerb, pathOrAddress, name, id)
        List<InterfaceEndpointDto> endpoints = endpointRepository.findByInterfaceId(interfaceId)
                .stream()
                .map(ep -> new InterfaceEndpointDto(
                        ep.getId(),
                        ep.getName(),
                        ep.getDescription(),
                        ep.getEndpointType(),
                        ep.getPathOrAddress(),
                        ep.getProtocol(),
                        ep.getOperationVerb(),
                        ep.getDirection(),
                        ep.getValidFrom(),
                        ep.getValidTo(),
                        ep.getRequestDataEntityPointId(),
                        ep.getResponseDataEntityPointId()
                ))
                .sorted(Comparator
                        .comparing(InterfaceEndpointDto::operationVerb,
                                Comparator.nullsLast(Comparator.naturalOrder()))
                        .thenComparing(InterfaceEndpointDto::pathOrAddress,
                                Comparator.nullsLast(Comparator.naturalOrder()))
                        .thenComparing(InterfaceEndpointDto::name,
                                Comparator.nullsLast(Comparator.naturalOrder()))
                        .thenComparing(InterfaceEndpointDto::id,
                                Comparator.nullsLast(Comparator.naturalOrder())))
                .collect(Collectors.toList());

        // Load linked logical entities via InterfaceLogicalEntity join table
        List<InterfaceLogicalEntityEntity> interfaceLogicalEntities =
                interfaceLogicalEntityRepository.findByInterfaceId(interfaceId);

        List<LogicalEntitySchemaDto> logicalEntities = interfaceLogicalEntities.stream()
                .map(ile -> {
                    // Load the logical entity using dataEntityPointId with prefix parsing
                    String dataEntityPointId = ile.getDataEntityPointId();
                    Optional<LogicalDataEntityEntity> entityOpt;

                    if (dataEntityPointId != null && dataEntityPointId.startsWith("dep_log_")) {
                        String rawId = dataEntityPointId.substring("dep_log_".length());
                        entityOpt = logicalDataEntityRepository.findById(rawId);
                    } else if (dataEntityPointId != null && dataEntityPointId.startsWith("dep_phy_")) {
                        // Physical entity support not yet implemented in OAS context
                        log.debug("Skipping physical entity reference: {}", dataEntityPointId);
                        entityOpt = Optional.empty();
                    } else {
                        log.warn("Unknown dataEntityPointId format: {}", dataEntityPointId);
                        entityOpt = Optional.empty();
                    }

                    if (entityOpt.isEmpty()) {
                        return null;
                    }

                    LogicalDataEntityEntity entity = entityOpt.get();

                    // Load attributes for this logical entity, sorted by (name, id)
                    List<LogicalAttributeDto> attributes = logicalDataAttributeRepository
                            .findByLogicalEntityId(entity.getId())
                            .stream()
                            .map(attr -> new LogicalAttributeDto(
                                    attr.getId(),
                                    attr.getName(),
                                    attr.getDescription(),
                                    attr.getDataType(),
                                    attr.getIsPrimaryKey(),
                                    attr.getIsNullable(),
                                    attr.getTags()
                            ))
                            .sorted(Comparator
                                    .comparing(LogicalAttributeDto::name,
                                            Comparator.nullsLast(Comparator.naturalOrder()))
                                    .thenComparing(LogicalAttributeDto::id,
                                            Comparator.nullsLast(Comparator.naturalOrder())))
                            .collect(Collectors.toList());

                    return new LogicalEntitySchemaDto(
                            entity.getId(),
                            entity.getName(),
                            entity.getDescription(),
                            entity.getTags(),
                            entity.getValidFrom(),
                            entity.getValidTo(),
                            attributes
                    );
                })
                .filter(Objects::nonNull)
                // Sort logical entities by (name, id)
                .sorted(Comparator
                        .comparing(LogicalEntitySchemaDto::name,
                                Comparator.nullsLast(Comparator.naturalOrder()))
                        .thenComparing(LogicalEntitySchemaDto::id,
                                Comparator.nullsLast(Comparator.naturalOrder())))
                .collect(Collectors.toList());

        log.debug("Loaded OAS context for interfaceId: {} with {} endpoints and {} logical entities",
                interfaceId, endpoints.size(), logicalEntities.size());

        // Return InterfaceOasContextDto with notes = null (v1)
        return new InterfaceOasContextDto(
                interfaceDetail,
                serviceDetail,
                applicationDetail,
                endpoints,
                logicalEntities,
                null  // notes is null for v1
        );
    }
}
