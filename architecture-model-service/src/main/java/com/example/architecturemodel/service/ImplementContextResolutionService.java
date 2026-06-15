package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.ResolvedImplementContextDto;
import com.example.architecturemodel.model.dto.diagram.ResolvedDiagramSummary;
import com.example.architecturemodel.model.dto.entity.ResolvedEntitySummary;
import com.example.architecturemodel.model.entity.*;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.diagram.DiagramNodeRepository;
import com.example.architecturemodel.repository.diagram.DiagramRepository;
import com.example.architecturemodel.repository.entity.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;
import java.util.stream.Collectors;

/**
 * Service for resolving implement context entity and diagram IDs into detailed summaries.
 *
 * This service takes raw entity IDs (in format "entityType::entityId") and diagram IDs,
 * then resolves them into structured summaries containing entity names, types, categories,
 * and relevant fields for LLM context enrichment.
 *
 * Spec: Implement Context Resolution - Iteration 3
 * Spec 2026-01-14: Implement Assistant Stage 4 - Feature-Specific Context Highlighting
 *   - Added resolveEntityName() helper for populating referencedEntityNames in diagrams
 *   - Updated resolveDiagram() to include human-readable entity names
 * Spec 2026-01-16: Fix Implement Context Resolution Entity Type Canonicalization
 *   - Added canonicalizeEntityType() for defense-in-depth alias handling
 * Spec 2026-01-17: Ensure Physical Data Entity Attributes Reach Planner LLM
 *   - Injected PhysicalDataAttributeRepository to query PDE attributes
 *   - Updated resolvePhysicalDataEntity() to include attributes in relevant_fields
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class ImplementContextResolutionService {

    private final ModelFileRepository modelFileRepository;

    // Entity repositories
    private final ServiceRepository serviceRepository;
    private final ClassRepository classRepository;
    private final MethodRepository methodRepository;
    private final InterfaceRepository interfaceRepository;
    private final ApplicationRepository applicationRepository;
    private final ApplicationComponentRepository applicationComponentRepository;
    private final EndpointRepository endpointRepository;
    private final BusinessProcessRepository businessProcessRepository;
    private final BusinessPointRepository businessPointRepository;
    private final LogicalDataEntityRepository logicalDataEntityRepository;
    private final PhysicalDataEntityRepository physicalDataEntityRepository;
    private final UIScreenRepository uiScreenRepository;

    // Attribute repository for PDE attributes
    // Spec 2026-01-17: Ensure Physical Data Entity Attributes Reach Planner LLM
    private final PhysicalDataAttributeRepository physicalDataAttributeRepository;

    // Diagram repositories
    private final DiagramRepository diagramRepository;
    private final DiagramNodeRepository diagramNodeRepository;

    /**
     * Inner record for holding parsed entity ID parts.
     */
    record EntityIdParts(String entityType, String entityId) {}

    /**
     * Canonicalizes an entity type string by converting snake_case aliases to camelCase.
     *
     * This provides defense-in-depth alongside Gateway normalization, ensuring that
     * even if snake_case entity types reach the resolver, they are handled correctly.
     *
     * Spec: 2026-01-16 Fix Implement Context Resolution Entity Type Canonicalization
     *
     * @param entityType the entity type string (may be snake_case or camelCase)
     * @return the canonical camelCase entity type
     */
    private String canonicalizeEntityType(String entityType) {
        if (entityType == null) {
            return null;
        }

        return switch (entityType) {
            // snake_case aliases -> canonical camelCase
            case "physical_data_entities" -> "physicalDataEntities";
            case "logical_data_entities" -> "logicalDataEntities";
            case "app_components" -> "appComponents";
            case "business_processes" -> "businessProcesses";
            case "business_points" -> "businessPoints";
            case "process_activities" -> "businessPoints"; // Special mapping
            case "ui_screens" -> "uiScreens";
            // Pass through canonical types and unknown types unchanged
            default -> entityType;
        };
    }

    /**
     * Resolves entity and diagram IDs into detailed summaries.
     *
     * @param projectId the project ID (filename)
     * @param selectedEntityIds list of entity IDs in format "entityType::entityId"
     * @param selectedDiagramIds list of diagram IDs
     * @return ResolvedImplementContextDto with resolved entities and diagrams
     * @throws ResourceNotFoundException if project/model file not found
     */
    @Transactional(readOnly = true)
    public ResolvedImplementContextDto resolveContext(
            UUID projectId,
            List<String> selectedEntityIds,
            List<String> selectedDiagramIds) {

        log.debug("Resolving implement context for project: {}, entities: {}, diagrams: {}",
            projectId,
            selectedEntityIds != null ? selectedEntityIds.size() : 0,
            selectedDiagramIds != null ? selectedDiagramIds.size() : 0);

        // Look up model file by project UUID
        ModelFileEntity modelFile = modelFileRepository.findByProjectId(projectId)
            .orElseThrow(() -> new ResourceNotFoundException("Model file not found for project: " + projectId));

        String modelFileId = modelFile.getId();

        // Resolve entities
        List<ResolvedEntitySummary> resolvedEntities = new ArrayList<>();
        if (selectedEntityIds != null) {
            for (String compositeId : selectedEntityIds) {
                ResolvedEntitySummary resolved = resolveEntity(compositeId, modelFileId);
                if (resolved != null) {
                    resolvedEntities.add(resolved);
                }
            }
        }

        // Resolve diagrams
        List<ResolvedDiagramSummary> resolvedDiagrams = new ArrayList<>();
        if (selectedDiagramIds != null) {
            for (String diagramId : selectedDiagramIds) {
                ResolvedDiagramSummary resolved = resolveDiagram(diagramId, modelFileId);
                if (resolved != null) {
                    resolvedDiagrams.add(resolved);
                }
            }
        }

        log.debug("Resolved {} entities and {} diagrams",
            resolvedEntities.size(), resolvedDiagrams.size());

        return new ResolvedImplementContextDto(resolvedEntities, resolvedDiagrams);
    }

    /**
     * Parses a composite entity ID into its component parts.
     *
     * @param compositeId the composite ID in format "entityType::entityId"
     * @return EntityIdParts or null if malformed
     */
    EntityIdParts parseEntityId(String compositeId) {
        if (compositeId == null || compositeId.isBlank()) {
            return null;
        }

        int delimiterIndex = compositeId.indexOf("::");
        if (delimiterIndex <= 0 || delimiterIndex >= compositeId.length() - 2) {
            log.debug("Malformed entity ID (no valid '::' delimiter): {}", compositeId);
            return null;
        }

        String entityType = compositeId.substring(0, delimiterIndex);
        String entityId = compositeId.substring(delimiterIndex + 2);

        if (entityType.isBlank() || entityId.isBlank()) {
            log.debug("Malformed entity ID (empty parts): {}", compositeId);
            return null;
        }

        return new EntityIdParts(entityType, entityId);
    }

    /**
     * Resolves a single entity by its composite ID.
     *
     * @param compositeId the composite ID in format "entityType::entityId"
     * @param modelFileId the model file ID for scoping queries
     * @return ResolvedEntitySummary or null if not found
     */
    ResolvedEntitySummary resolveEntity(String compositeId, String modelFileId) {
        EntityIdParts parts = parseEntityId(compositeId);
        if (parts == null) {
            return null;
        }

        // Canonicalize the entity type before switch dispatch
        // Spec: 2026-01-16 Fix Implement Context Resolution Entity Type Canonicalization
        String entityType = canonicalizeEntityType(parts.entityType());
        String entityId = parts.entityId();

        return switch (entityType) {
            case "services" -> resolveService(entityId, modelFileId);
            case "classes" -> resolveClass(entityId, modelFileId);
            case "methods" -> resolveMethod(entityId, modelFileId);
            case "interfaces" -> resolveInterface(entityId, modelFileId);
            case "applications" -> resolveApplication(entityId, modelFileId);
            case "appComponents" -> resolveApplicationComponent(entityId, modelFileId);
            case "endpoints" -> resolveEndpoint(entityId, modelFileId);
            case "businessProcesses" -> resolveBusinessProcess(entityId, modelFileId);
            case "businessPoints" -> resolveBusinessPoint(entityId, modelFileId);
            case "logicalDataEntities" -> resolveLogicalDataEntity(entityId, modelFileId);
            case "physicalDataEntities" -> resolvePhysicalDataEntity(entityId, modelFileId);
            case "uiScreens" -> resolveUIScreen(entityId, modelFileId);
            default -> {
                log.debug("Unknown entity type '{}' for ID: {}", entityType, compositeId);
                yield null;
            }
        };
    }

    /**
     * Resolves a diagram by its ID.
     *
     * @param diagramId the diagram ID
     * @param modelFileId the model file ID for scoping queries
     * @return ResolvedDiagramSummary or null if not found
     */
    ResolvedDiagramSummary resolveDiagram(String diagramId, String modelFileId) {
        if (diagramId == null || diagramId.isBlank()) {
            return null;
        }

        Optional<DiagramEntity> diagramOpt = diagramRepository.findById(diagramId);
        if (diagramOpt.isEmpty()) {
            log.debug("Diagram not found: {}", diagramId);
            return null;
        }

        DiagramEntity diagram = diagramOpt.get();

        // Verify it belongs to the correct model file
        if (!modelFileId.equals(diagram.getModelFileId())) {
            log.debug("Diagram {} does not belong to model file {}", diagramId, modelFileId);
            return null;
        }

        // Collect referenced entity IDs from diagram nodes
        List<DiagramNodeEntity> nodes = diagramNodeRepository.findByDiagramId(diagramId);
        List<String> referencedEntityIds = nodes.stream()
            .map(DiagramNodeEntity::getEntityId)
            .filter(Objects::nonNull)
            .filter(id -> !id.isBlank())
            .distinct()
            .collect(Collectors.toList());

        return new ResolvedDiagramSummary(
            diagram.getId(),
            diagram.getName(),
            diagram.getDiagramType(),
            referencedEntityIds
        );
    }

    // ============================================================================
    // Entity Resolution Methods
    // ============================================================================

    private ResolvedEntitySummary resolveService(String entityId, String modelFileId) {
        return serviceRepository.findById(entityId)
            .filter(e -> modelFileId.equals(e.getModelFileId()))
            .map(entity -> {
                Map<String, Object> relevantFields = new LinkedHashMap<>();
                if (entity.getApplicationId() != null) {
                    relevantFields.put("applicationId", entity.getApplicationId());
                }
                if (entity.getServiceType() != null) {
                    relevantFields.put("serviceType", entity.getServiceType());
                }
                return new ResolvedEntitySummary(
                    entity.getId(),
                    entity.getName(),
                    "services",
                    "application",
                    relevantFields
                );
            })
            .orElseGet(() -> {
                log.debug("Service not found: {}", entityId);
                return null;
            });
    }

    private ResolvedEntitySummary resolveClass(String entityId, String modelFileId) {
        return classRepository.findById(entityId)
            .filter(e -> modelFileId.equals(e.getModelFileId()))
            .map(entity -> {
                Map<String, Object> relevantFields = new LinkedHashMap<>();
                if (entity.getNamespace() != null) {
                    relevantFields.put("namespace", entity.getNamespace());
                }
                if (entity.getServiceId() != null) {
                    relevantFields.put("serviceId", entity.getServiceId());
                }
                return new ResolvedEntitySummary(
                    entity.getId(),
                    entity.getName(),
                    "classes",
                    "application",
                    relevantFields
                );
            })
            .orElseGet(() -> {
                log.debug("Class not found: {}", entityId);
                return null;
            });
    }

    private ResolvedEntitySummary resolveMethod(String entityId, String modelFileId) {
        return methodRepository.findById(entityId)
            .filter(e -> modelFileId.equals(e.getModelFileId()))
            .map(entity -> {
                Map<String, Object> relevantFields = new LinkedHashMap<>();
                if (entity.getClassId() != null) {
                    relevantFields.put("classId", entity.getClassId());
                }
                return new ResolvedEntitySummary(
                    entity.getId(),
                    entity.getName(),
                    "methods",
                    "application",
                    relevantFields
                );
            })
            .orElseGet(() -> {
                log.debug("Method not found: {}", entityId);
                return null;
            });
    }

    private ResolvedEntitySummary resolveInterface(String entityId, String modelFileId) {
        return interfaceRepository.findById(entityId)
            .filter(e -> modelFileId.equals(e.getModelFileId()))
            .map(entity -> {
                Map<String, Object> relevantFields = new LinkedHashMap<>();
                if (entity.getServiceId() != null) {
                    relevantFields.put("serviceId", entity.getServiceId());
                }
                if (entity.getInterfaceType() != null) {
                    relevantFields.put("interfaceType", entity.getInterfaceType());
                }
                return new ResolvedEntitySummary(
                    entity.getId(),
                    entity.getName(),
                    "interfaces",
                    "application",
                    relevantFields
                );
            })
            .orElseGet(() -> {
                log.debug("Interface not found: {}", entityId);
                return null;
            });
    }

    private ResolvedEntitySummary resolveApplication(String entityId, String modelFileId) {
        return applicationRepository.findById(entityId)
            .filter(e -> modelFileId.equals(e.getModelFileId()))
            .map(entity -> {
                Map<String, Object> relevantFields = new LinkedHashMap<>();
                if (entity.getAppType() != null) {
                    relevantFields.put("appType", entity.getAppType());
                }
                if (entity.getStatus() != null) {
                    relevantFields.put("status", entity.getStatus());
                }
                return new ResolvedEntitySummary(
                    entity.getId(),
                    entity.getName(),
                    "applications",
                    "application",
                    relevantFields
                );
            })
            .orElseGet(() -> {
                log.debug("Application not found: {}", entityId);
                return null;
            });
    }

    private ResolvedEntitySummary resolveApplicationComponent(String entityId, String modelFileId) {
        return applicationComponentRepository.findById(entityId)
            .filter(e -> modelFileId.equals(e.getModelFileId()))
            .map(entity -> {
                Map<String, Object> relevantFields = new LinkedHashMap<>();
                if (entity.getApplicationId() != null) {
                    relevantFields.put("applicationId", entity.getApplicationId());
                }
                return new ResolvedEntitySummary(
                    entity.getId(),
                    entity.getName(),
                    "appComponents",
                    "application",
                    relevantFields
                );
            })
            .orElseGet(() -> {
                log.debug("ApplicationComponent not found: {}", entityId);
                return null;
            });
    }

    private ResolvedEntitySummary resolveEndpoint(String entityId, String modelFileId) {
        return endpointRepository.findById(entityId)
            .filter(e -> modelFileId.equals(e.getModelFileId()))
            .map(entity -> {
                Map<String, Object> relevantFields = new LinkedHashMap<>();
                if (entity.getInterfaceId() != null) {
                    relevantFields.put("interfaceId", entity.getInterfaceId());
                }
                if (entity.getOperationVerb() != null) {
                    relevantFields.put("httpMethod", entity.getOperationVerb());
                }
                if (entity.getPathOrAddress() != null) {
                    relevantFields.put("path", entity.getPathOrAddress());
                }
                return new ResolvedEntitySummary(
                    entity.getId(),
                    entity.getName(),
                    "endpoints",
                    "application",
                    relevantFields
                );
            })
            .orElseGet(() -> {
                log.debug("Endpoint not found: {}", entityId);
                return null;
            });
    }

    private ResolvedEntitySummary resolveBusinessProcess(String entityId, String modelFileId) {
        return businessProcessRepository.findById(entityId)
            .filter(e -> modelFileId.equals(e.getModelFileId()))
            .map(entity -> {
                Map<String, Object> relevantFields = new LinkedHashMap<>();
                // BusinessProcess doesn't have a domain field, but we include tags if present
                if (entity.getTags() != null && !entity.getTags().isBlank()) {
                    relevantFields.put("tags", entity.getTags());
                }
                return new ResolvedEntitySummary(
                    entity.getId(),
                    entity.getName(),
                    "businessProcesses",
                    "business",
                    relevantFields
                );
            })
            .orElseGet(() -> {
                log.debug("BusinessProcess not found: {}", entityId);
                return null;
            });
    }

    private ResolvedEntitySummary resolveBusinessPoint(String entityId, String modelFileId) {
        return businessPointRepository.findById(entityId)
            .filter(e -> modelFileId.equals(e.getModelFileId()))
            .map(entity -> {
                Map<String, Object> relevantFields = new LinkedHashMap<>();
                if (entity.getBusinessProcessId() != null) {
                    relevantFields.put("processId", entity.getBusinessProcessId());
                }
                if (entity.getKind() != null) {
                    relevantFields.put("kind", entity.getKind());
                }
                return new ResolvedEntitySummary(
                    entity.getId(),
                    entity.getName(),
                    "businessPoints",
                    "business",
                    relevantFields
                );
            })
            .orElseGet(() -> {
                log.debug("BusinessPoint not found: {}", entityId);
                return null;
            });
    }

    private ResolvedEntitySummary resolveLogicalDataEntity(String entityId, String modelFileId) {
        return logicalDataEntityRepository.findById(entityId)
            .filter(e -> modelFileId.equals(e.getModelFileId()))
            .map(entity -> {
                Map<String, Object> relevantFields = new LinkedHashMap<>();
                // LogicalDataEntity doesn't have domain field, include tags if present
                if (entity.getTags() != null && !entity.getTags().isBlank()) {
                    relevantFields.put("tags", entity.getTags());
                }
                return new ResolvedEntitySummary(
                    entity.getId(),
                    entity.getName(),
                    "logicalDataEntities",
                    "data",
                    relevantFields
                );
            })
            .orElseGet(() -> {
                log.debug("LogicalDataEntity not found: {}", entityId);
                return null;
            });
    }

    /**
     * Resolves a physical data entity including its attributes.
     *
     * Spec 2026-01-17: Ensure Physical Data Entity Attributes Reach Planner LLM
     * - Queries PhysicalDataAttributeRepository for entity attributes
     * - Includes attributes array in relevant_fields with name, type, pk, nullable
     *
     * @param entityId the entity ID
     * @param modelFileId the model file ID for scoping queries
     * @return ResolvedEntitySummary with attributes in relevant_fields, or null if not found
     */
    private ResolvedEntitySummary resolvePhysicalDataEntity(String entityId, String modelFileId) {
        return physicalDataEntityRepository.findById(entityId)
            .filter(e -> modelFileId.equals(e.getModelFileId()))
            .map(entity -> {
                Map<String, Object> relevantFields = new LinkedHashMap<>();
                if (entity.getDatabaseName() != null) {
                    relevantFields.put("database", entity.getDatabaseName());
                }
                if (entity.getPhysicalType() != null) {
                    relevantFields.put("physicalType", entity.getPhysicalType());
                }

                // Spec 2026-01-17: Query and include attributes in relevant_fields
                List<PhysicalDataAttributeEntity> attributes = physicalDataAttributeRepository
                    .findByPhysicalEntityId(entityId);

                if (attributes != null && !attributes.isEmpty()) {
                    List<Map<String, Object>> attributesList = new ArrayList<>();
                    for (PhysicalDataAttributeEntity attr : attributes) {
                        Map<String, Object> attrMap = new LinkedHashMap<>();
                        attrMap.put("name", attr.getName() != null ? attr.getName() : "");
                        attrMap.put("type", attr.getDataType() != null ? attr.getDataType() : "unknown");
                        attrMap.put("pk", attr.getIsPrimaryKey() != null && attr.getIsPrimaryKey());
                        attrMap.put("nullable", attr.getIsNullable() != null && attr.getIsNullable());
                        attributesList.add(attrMap);
                    }
                    relevantFields.put("attributes", attributesList);
                    log.debug("Physical data entity {} has {} attributes", entityId, attributesList.size());
                } else {
                    // Log warning if PDE has no attributes (may indicate data issue or depth=0)
                    log.warn("Physical data entity {} has no attributes found", entityId);
                    relevantFields.put("attributes", new ArrayList<>());
                }

                return new ResolvedEntitySummary(
                    entity.getId(),
                    entity.getName(),
                    "physicalDataEntities",
                    "data",
                    relevantFields
                );
            })
            .orElseGet(() -> {
                log.debug("PhysicalDataEntity not found: {}", entityId);
                return null;
            });
    }

    private ResolvedEntitySummary resolveUIScreen(String entityId, String modelFileId) {
        return uiScreenRepository.findById(entityId)
            .filter(e -> modelFileId.equals(e.getModelFileId()))
            .map(entity -> {
                Map<String, Object> relevantFields = new LinkedHashMap<>();
                if (entity.getRoute() != null) {
                    relevantFields.put("route", entity.getRoute());
                }
                return new ResolvedEntitySummary(
                    entity.getId(),
                    entity.getName(),
                    "uiScreens",
                    "ui",
                    relevantFields
                );
            })
            .orElseGet(() -> {
                log.debug("UIScreen not found: {}", entityId);
                return null;
            });
    }
}
