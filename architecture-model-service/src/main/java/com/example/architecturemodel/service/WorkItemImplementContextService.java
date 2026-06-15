package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.DiagramSelection;
import com.example.architecturemodel.model.dto.EntitySelection;
import com.example.architecturemodel.model.dto.ImplementContextDto;
import com.example.architecturemodel.model.dto.RelationshipSelection;
import com.example.architecturemodel.model.entity.WorkItemImplementContextEntity;
import com.example.architecturemodel.repository.entity.WorkItemImplementContextRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Service for managing work item implement context.
 *
 * Provides methods to get and save the selected architecture entities and diagrams
 * for a work item's Implement context.
 *
 * Spec: Ensure Physical Data Entity Attributes Reach Planner LLM
 * - Added support for structured entity/diagram selections with bundle_type and depth.
 * - Implements backward compatibility inference logic for legacy contexts.
 *
 * Spec: Implement Context Include Relationships and Propagate to Planner Payload
 * - Added support for relationship selections.
 * - Relationships are persisted alongside entities and diagrams.
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class WorkItemImplementContextService {

    private final WorkItemImplementContextRepository repository;

    /**
     * Default bundle type for interfaces.
     */
    private static final String INTERFACE_DEFAULT_BUNDLE = "interface_with_endpoints_and_schemas";

    /**
     * Default bundle type for services.
     */
    private static final String SERVICE_DEFAULT_BUNDLE = "service_with_parents_and_children";

    /**
     * Default bundle type for data entities (logical and physical).
     */
    private static final String DATA_ENTITY_DEFAULT_BUNDLE = "entity_with_attributes_and_relationships";

    /**
     * Default bundle type for other entity types.
     */
    private static final String DEFAULT_BUNDLE = "entity_only";

    /**
     * Default bundle type for diagrams.
     */
    private static final String DIAGRAM_DEFAULT_BUNDLE = "diagram_only";

    /**
     * Default depth for data entities.
     */
    private static final Integer DATA_ENTITY_DEFAULT_DEPTH = 1;

    /**
     * Get the implement context for a work item.
     * Returns empty lists if no context exists.
     * Includes structured selections when available, or infers defaults for legacy contexts.
     *
     * @param projectId the project ID
     * @param workItemId the work item ID
     * @return the implement context DTO with current or empty selections
     */
    @Transactional(readOnly = true)
    public ImplementContextDto getContext(UUID projectId, UUID workItemId) {
        log.debug("Getting implement context for project: {}, workItem: {}", projectId, workItemId);

        return repository.findByProjectIdAndWorkItemId(projectId, workItemId)
            .map(this::toDto)
            .orElseGet(() -> {
                log.debug("No context found, returning empty context");
                return new ImplementContextDto(
                    projectId,
                    workItemId,
                    new ArrayList<>(),
                    new ArrayList<>(),
                    new ArrayList<>(),
                    new ArrayList<>(),
                    new ArrayList<>(),
                    new ArrayList<>()
                );
            });
    }

    /**
     * Save the implement context for a work item (upsert).
     * Creates new context if none exists, or updates existing context.
     * Supports both legacy ID arrays and structured selections.
     * Includes relationship selection support.
     *
     * Spec: Implement Context Include Relationships and Propagate to Planner Payload
     *
     * @param projectId the project ID
     * @param workItemId the work item ID
     * @param entityIds list of selected entity IDs
     * @param diagramIds list of selected diagram IDs
     * @param entitySelections list of structured entity selections
     * @param diagramSelections list of structured diagram selections
     * @param relationshipIds list of selected relationship IDs
     * @param relationshipSelections list of structured relationship selections
     * @return the saved implement context DTO
     */
    @Transactional
    public ImplementContextDto saveContext(UUID projectId, UUID workItemId,
                                           List<String> entityIds, List<String> diagramIds,
                                           List<EntitySelection> entitySelections,
                                           List<DiagramSelection> diagramSelections,
                                           List<String> relationshipIds,
                                           List<RelationshipSelection> relationshipSelections) {
        log.debug("Saving implement context for project: {}, workItem: {}, entities: {}, diagrams: {}, entitySelections: {}, diagramSelections: {}, relationships: {}, relationshipSelections: {}",
            projectId, workItemId,
            entityIds != null ? entityIds.size() : 0,
            diagramIds != null ? diagramIds.size() : 0,
            entitySelections != null ? entitySelections.size() : 0,
            diagramSelections != null ? diagramSelections.size() : 0,
            relationshipIds != null ? relationshipIds.size() : 0,
            relationshipSelections != null ? relationshipSelections.size() : 0);

        WorkItemImplementContextEntity entity = repository.findByProjectIdAndWorkItemId(projectId, workItemId)
            .orElseGet(() -> {
                log.debug("Creating new implement context");
                return WorkItemImplementContextEntity.builder()
                    .id(UUID.randomUUID())
                    .projectId(projectId)
                    .workItemId(workItemId)
                    .build();
            });

        entity.setSelectedEntityIds(entityIds != null ? new ArrayList<>(entityIds) : new ArrayList<>());
        entity.setSelectedDiagramIds(diagramIds != null ? new ArrayList<>(diagramIds) : new ArrayList<>());
        entity.setSelectedEntitySelections(entitySelections != null ? new ArrayList<>(entitySelections) : new ArrayList<>());
        entity.setSelectedDiagramSelections(diagramSelections != null ? new ArrayList<>(diagramSelections) : new ArrayList<>());
        // Spec: Implement Context Include Relationships and Propagate to Planner Payload
        entity.setSelectedRelationshipIds(relationshipIds != null ? new ArrayList<>(relationshipIds) : new ArrayList<>());
        entity.setSelectedRelationshipSelections(relationshipSelections != null ? new ArrayList<>(relationshipSelections) : new ArrayList<>());

        WorkItemImplementContextEntity saved = repository.save(entity);
        log.debug("Saved implement context with id: {}", saved.getId());

        return toDto(saved);
    }

    /**
     * Save the implement context for a work item (upsert) without relationships.
     * Backward-compatible method that defaults relationship fields to empty lists.
     *
     * @param projectId the project ID
     * @param workItemId the work item ID
     * @param entityIds list of selected entity IDs
     * @param diagramIds list of selected diagram IDs
     * @param entitySelections list of structured entity selections
     * @param diagramSelections list of structured diagram selections
     * @return the saved implement context DTO
     */
    @Transactional
    public ImplementContextDto saveContext(UUID projectId, UUID workItemId,
                                           List<String> entityIds, List<String> diagramIds,
                                           List<EntitySelection> entitySelections,
                                           List<DiagramSelection> diagramSelections) {
        return saveContext(projectId, workItemId, entityIds, diagramIds,
                          entitySelections, diagramSelections, null, null);
    }

    /**
     * Backward-compatible save method that only uses legacy ID arrays.
     *
     * @param projectId the project ID
     * @param workItemId the work item ID
     * @param entityIds list of selected entity IDs
     * @param diagramIds list of selected diagram IDs
     * @return the saved implement context DTO
     */
    @Transactional
    public ImplementContextDto saveContext(UUID projectId, UUID workItemId,
                                           List<String> entityIds, List<String> diagramIds) {
        return saveContext(projectId, workItemId, entityIds, diagramIds, null, null, null, null);
    }

    /**
     * Convert entity to DTO.
     * If structured selections are empty but legacy IDs exist, infer defaults.
     * Always returns empty lists (never null) for backward compatibility.
     *
     * Spec: Implement Context Include Relationships and Propagate to Planner Payload
     * - Added relationship field mapping with empty list defaults.
     */
    private ImplementContextDto toDto(WorkItemImplementContextEntity entity) {
        List<String> entityIds = entity.getSelectedEntityIds() != null ? entity.getSelectedEntityIds() : new ArrayList<>();
        List<String> diagramIds = entity.getSelectedDiagramIds() != null ? entity.getSelectedDiagramIds() : new ArrayList<>();
        List<EntitySelection> entitySelections = entity.getSelectedEntitySelections();
        List<DiagramSelection> diagramSelections = entity.getSelectedDiagramSelections();

        // If structured selections are empty but legacy IDs exist, infer defaults
        if ((entitySelections == null || entitySelections.isEmpty()) && !entityIds.isEmpty()) {
            log.debug("Inferring entity selections from legacy IDs for {} entities", entityIds.size());
            entitySelections = inferEntitySelections(entityIds);
        }

        if ((diagramSelections == null || diagramSelections.isEmpty()) && !diagramIds.isEmpty()) {
            log.debug("Inferring diagram selections from legacy IDs for {} diagrams", diagramIds.size());
            diagramSelections = inferDiagramSelections(diagramIds);
        }

        // Spec: Implement Context Include Relationships and Propagate to Planner Payload
        // Always return empty lists (not null) for relationship fields
        List<String> relationshipIds = entity.getSelectedRelationshipIds() != null
            ? entity.getSelectedRelationshipIds()
            : new ArrayList<>();
        List<RelationshipSelection> relationshipSelections = entity.getSelectedRelationshipSelections() != null
            ? entity.getSelectedRelationshipSelections()
            : new ArrayList<>();

        return new ImplementContextDto(
            entity.getProjectId(),
            entity.getWorkItemId(),
            entityIds,
            diagramIds,
            entitySelections != null ? entitySelections : new ArrayList<>(),
            diagramSelections != null ? diagramSelections : new ArrayList<>(),
            relationshipIds,
            relationshipSelections
        );
    }

    /**
     * Infers structured entity selections from legacy entity IDs.
     * Applies default bundle_type and depth based on entity type.
     *
     * Spec: Ensure Physical Data Entity Attributes Reach Planner LLM
     * - Interfaces -> interface_with_endpoints_and_schemas
     * - Services -> service_with_parents_and_children
     * - Physical/Logical data entities -> entity_with_attributes_and_relationships with depth=1
     * - Others -> entity_only
     *
     * @param entityIds list of entity IDs in format "entityType::entityId"
     * @return list of EntitySelection with inferred defaults
     */
    private List<EntitySelection> inferEntitySelections(List<String> entityIds) {
        List<EntitySelection> selections = new ArrayList<>();

        for (String compositeId : entityIds) {
            if (compositeId == null || compositeId.isBlank()) {
                continue;
            }

            // Parse "entityType::entityId" format
            int delimiterIndex = compositeId.indexOf("::");
            if (delimiterIndex <= 0 || delimiterIndex >= compositeId.length() - 2) {
                // Malformed ID, skip or use unknown type
                log.debug("Skipping malformed entity ID: {}", compositeId);
                continue;
            }

            String entityType = compositeId.substring(0, delimiterIndex);
            String entityId = compositeId.substring(delimiterIndex + 2);

            String bundleType = inferDefaultBundleType(entityType);
            Integer depth = inferDefaultDepth(entityType);

            selections.add(new EntitySelection(entityType, entityId, bundleType, depth));
        }

        return selections;
    }

    /**
     * Infers structured diagram selections from legacy diagram IDs.
     * Applies default bundle_type (diagram_only).
     *
     * @param diagramIds list of diagram IDs
     * @return list of DiagramSelection with inferred defaults
     */
    private List<DiagramSelection> inferDiagramSelections(List<String> diagramIds) {
        List<DiagramSelection> selections = new ArrayList<>();

        for (String diagramId : diagramIds) {
            if (diagramId == null || diagramId.isBlank()) {
                continue;
            }
            selections.add(new DiagramSelection(diagramId, DIAGRAM_DEFAULT_BUNDLE));
        }

        return selections;
    }

    /**
     * Infers the default bundle type for an entity based on its entity type.
     *
     * Spec: Ensure Physical Data Entity Attributes Reach Planner LLM
     *
     * @param entityType the entity type (e.g., "interfaces", "services", "physicalDataEntities")
     * @return the default bundle type for the entity
     */
    public static String inferDefaultBundleType(String entityType) {
        if (entityType == null) {
            return DEFAULT_BUNDLE;
        }

        return switch (entityType) {
            case "interfaces" -> INTERFACE_DEFAULT_BUNDLE;
            case "services" -> SERVICE_DEFAULT_BUNDLE;
            case "physicalDataEntities", "physical_data_entities",
                 "logicalDataEntities", "logical_data_entities" -> DATA_ENTITY_DEFAULT_BUNDLE;
            default -> DEFAULT_BUNDLE;
        };
    }

    /**
     * Infers the default depth for an entity based on its entity type.
     *
     * @param entityType the entity type
     * @return the default depth, or null if not applicable
     */
    private Integer inferDefaultDepth(String entityType) {
        if (entityType == null) {
            return null;
        }

        return switch (entityType) {
            case "physicalDataEntities", "physical_data_entities",
                 "logicalDataEntities", "logical_data_entities" -> DATA_ENTITY_DEFAULT_DEPTH;
            default -> null;
        };
    }
}
