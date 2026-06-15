package com.example.archtool.service;

import com.example.archtool.model.dto.diagram.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.*;

/**
 * Service for computing diagram expansions for the Advanced Add feature.
 *
 * <p>This service traverses the meta-model graph starting from a root entity
 * and following the relationship paths specified by the user's selections.
 * It determines which nodes and edges should be added to the diagram.</p>
 *
 * <p>The service also checks which entities/edges already exist on the diagram
 * to avoid duplicates.</p>
 */
@Service
public class DiagramExpansionService {

    private static final Logger log = LoggerFactory.getLogger(DiagramExpansionService.class);

    // Entity type constants (matching frontend ENTITY_TYPES)
    public static final String ET_APPLICATION = "APPLICATION";
    public static final String ET_APP_COMPONENT = "APP_COMPONENT";
    public static final String ET_SERVICE = "SERVICE";
    public static final String ET_INTERFACE = "INTERFACE";
    public static final String ET_APPLICATION_POINT = "APPLICATION_POINT";
    public static final String ET_BUSINESS_USER = "BUSINESS_USER";
    public static final String ET_BUSINESS_PROCESS = "BUSINESS_PROCESS";
    public static final String ET_PROCESS_ACTIVITY = "PROCESS_ACTIVITY";
    public static final String ET_LOGICAL_DATA_ENTITY = "LOGICAL_DATA_ENTITY";
    public static final String ET_LOGICAL_DATA_ATTRIBUTE = "LOGICAL_DATA_ATTRIBUTE";
    public static final String ET_PHYSICAL_DATA_ENTITY = "PHYSICAL_DATA_ENTITY";
    public static final String ET_PHYSICAL_DATA_ATTRIBUTE = "PHYSICAL_DATA_ATTRIBUTE";

    // Relationship type constants
    public static final String RT_APP_COMPONENTS = "app_components";
    public static final String RT_SERVICES = "services";
    public static final String RT_INTERFACES = "interfaces";
    public static final String RT_PROCESS_ACTIVITIES = "process_activities";
    public static final String RT_LOGICAL_DATA_ATTRIBUTES = "logical_data_attributes";
    public static final String RT_PHYSICAL_DATA_ATTRIBUTES = "physical_data_attributes";
    public static final String RT_APP_POINT_BUSINESS_PROCESSES = "application_point_business_processes";
    public static final String RT_LOGICAL_PHYSICAL_ENTITIES = "logical_data_entity_physical_data_entities";
    public static final String RT_BUSINESS_USER_PROCESSES = "business_user_processes";
    public static final String RT_INTERFACE_LOGICAL_ENTITIES = "interface_logical_entities";

    /**
     * Computes the expansion for an Advanced Add request.
     *
     * <p>This method traverses the meta-model starting from the root entity,
     * following the relationship paths specified in the selections, and returns
     * the nodes and edges that should be added to the diagram.</p>
     *
     * @param request The Advanced Add request containing root entity and selections
     * @param metaModel The meta-model data (entities and relationships)
     * @param diagramData The current diagram state (existing nodes and edges)
     * @return An AdvancedAddResponse containing nodes and edges to add
     */
    public AdvancedAddResponse computeExpansion(
        AdvancedAddRequest request,
        Map<String, Object> metaModel,
        Map<String, Object> diagramData
    ) {
        log.info("Computing expansion for root entity: {} ({})",
            request.rootEntityId(), request.rootEntityType());

        // Validate request
        request.validate();

        // Get existing entities and edges on diagram
        Set<String> existingEntityIds = getExistingEntityIds(diagramData);
        Set<String> existingEdgeIds = getExistingEdgeIds(diagramData);

        List<NodeDescriptor> nodes = new ArrayList<>();
        List<EdgeDescriptor> edges = new ArrayList<>();

        // Add root entity first
        String rootEntityName = getEntityName(metaModel, request.rootEntityType(), request.rootEntityId());
        boolean rootOnDiagram = existingEntityIds.contains(request.rootEntityId());

        nodes.add(new NodeDescriptor(
            request.rootEntityType(),
            request.rootEntityId(),
            rootEntityName,
            rootOnDiagram,
            null
        ));

        // Process each selection
        for (SelectionDescriptor selection : request.selections()) {
            processSelection(
                request,
                selection,
                metaModel,
                existingEntityIds,
                existingEdgeIds,
                nodes,
                edges
            );
        }

        log.info("Expansion computed: {} nodes, {} edges", nodes.size(), edges.size());

        return new AdvancedAddResponse(nodes, edges);
    }

    /**
     * Processes a single selection from the Advanced Add tree.
     */
    private void processSelection(
        AdvancedAddRequest request,
        SelectionDescriptor selection,
        Map<String, Object> metaModel,
        Set<String> existingEntityIds,
        Set<String> existingEdgeIds,
        List<NodeDescriptor> nodes,
        List<EdgeDescriptor> edges
    ) {
        String relationshipType = selection.relationshipType();
        List<String> selectedIds = selection.selectedEntityIds();

        // If specific IDs were selected, use those
        if (selectedIds != null && !selectedIds.isEmpty()) {
            for (String entityId : selectedIds) {
                String entityType = getTargetEntityType(relationshipType);
                String entityName = getEntityName(metaModel, entityType, entityId);
                boolean onDiagram = existingEntityIds.contains(entityId);

                // Determine parent based on relationship direction
                String parentId = selection.direction().equals("CHILD") ? request.rootEntityId() : null;

                nodes.add(new NodeDescriptor(entityType, entityId, entityName, onDiagram, parentId));
            }
        } else {
            // Otherwise, traverse the relationship to find all related entities
            List<Map<String, String>> relatedEntities = findRelatedEntities(
                metaModel,
                request.rootEntityId(),
                request.rootEntityType(),
                relationshipType,
                selection.direction()
            );

            for (Map<String, String> entity : relatedEntities) {
                String entityId = entity.get("id");
                String entityName = entity.get("name");
                String entityType = entity.get("type");
                boolean onDiagram = existingEntityIds.contains(entityId);

                String parentId = selection.direction().equals("CHILD") ? request.rootEntityId() : null;

                nodes.add(new NodeDescriptor(entityType, entityId, entityName, onDiagram, parentId));
            }
        }
    }

    /**
     * Gets the target entity type for a given relationship table name.
     */
    private String getTargetEntityType(String relationshipType) {
        return switch (relationshipType) {
            case RT_APP_COMPONENTS -> ET_APP_COMPONENT;
            case RT_SERVICES -> ET_SERVICE;
            case RT_INTERFACES -> ET_INTERFACE;
            case RT_PROCESS_ACTIVITIES -> ET_PROCESS_ACTIVITY;
            case RT_LOGICAL_DATA_ATTRIBUTES -> ET_LOGICAL_DATA_ATTRIBUTE;
            case RT_PHYSICAL_DATA_ATTRIBUTES -> ET_PHYSICAL_DATA_ATTRIBUTE;
            case RT_APP_POINT_BUSINESS_PROCESSES -> ET_BUSINESS_PROCESS;
            case RT_LOGICAL_PHYSICAL_ENTITIES -> ET_PHYSICAL_DATA_ENTITY;
            case RT_BUSINESS_USER_PROCESSES -> ET_BUSINESS_PROCESS;
            case RT_INTERFACE_LOGICAL_ENTITIES -> ET_LOGICAL_DATA_ENTITY;
            default -> "UNKNOWN";
        };
    }

    /**
     * Finds related entities based on relationship type and direction.
     */
    @SuppressWarnings("unchecked")
    private List<Map<String, String>> findRelatedEntities(
        Map<String, Object> metaModel,
        String rootEntityId,
        String rootEntityType,
        String relationshipType,
        String direction
    ) {
        List<Map<String, String>> results = new ArrayList<>();

        try {
            Map<String, Object> entities = (Map<String, Object>) metaModel.get("entities");
            Map<String, Object> relationships = (Map<String, Object>) metaModel.get("relationships");

            if (entities == null) return results;

            // Handle parent/child relationships (direct entity table lookup)
            if ("CHILD".equals(direction)) {
                List<Map<String, Object>> targetEntities = getEntityList(entities, relationshipType);
                String foreignKey = getForeignKeyField(relationshipType, rootEntityType);

                for (Map<String, Object> entity : targetEntities) {
                    String fkValue = (String) entity.get(foreignKey);
                    if (rootEntityId.equals(fkValue)) {
                        results.add(Map.of(
                            "id", (String) entity.get("id"),
                            "name", (String) entity.getOrDefault("name", ""),
                            "type", getTargetEntityType(relationshipType)
                        ));
                    }
                }
            }
            // Handle association relationships (via relationship table)
            else if ("ASSOCIATION".equals(direction) && relationships != null) {
                // Lookup via relationship table
                List<Map<String, Object>> relRecords = getRelationshipList(relationships, relationshipType);

                for (Map<String, Object> rel : relRecords) {
                    // Determine which field to match and which to return
                    String matchField = getMatchField(relationshipType, rootEntityType);
                    String returnField = getReturnField(relationshipType, rootEntityType);

                    if (rootEntityId.equals(rel.get(matchField))) {
                        String targetId = (String) rel.get(returnField);
                        String targetType = getTargetEntityType(relationshipType);
                        String targetName = getEntityName(metaModel, targetType, targetId);

                        results.add(Map.of(
                            "id", targetId,
                            "name", targetName,
                            "type", targetType
                        ));
                    }
                }
            }
        } catch (Exception e) {
            log.warn("Error finding related entities: {}", e.getMessage());
        }

        return results;
    }

    /**
     * Gets the foreign key field for a parent/child relationship.
     */
    private String getForeignKeyField(String relationshipType, String parentEntityType) {
        return switch (relationshipType) {
            case RT_APP_COMPONENTS -> "application_id";
            case RT_SERVICES -> parentEntityType.equals(ET_APPLICATION) ? "application_id" : "app_component_id";
            case RT_INTERFACES -> "service_id";
            case RT_PROCESS_ACTIVITIES -> "business_process_id";
            case RT_LOGICAL_DATA_ATTRIBUTES -> "logical_entity_id";
            case RT_PHYSICAL_DATA_ATTRIBUTES -> "physical_entity_id";
            default -> "parent_id";
        };
    }

    /**
     * Gets the field to match for association relationships.
     */
    private String getMatchField(String relationshipType, String rootEntityType) {
        return switch (relationshipType) {
            case RT_APP_POINT_BUSINESS_PROCESSES ->
                rootEntityType.equals(ET_APPLICATION) ? "application_point_id" : "business_process_id";
            case RT_LOGICAL_PHYSICAL_ENTITIES -> "logical_entity_id";
            case RT_BUSINESS_USER_PROCESSES -> "business_user_id";
            case RT_INTERFACE_LOGICAL_ENTITIES -> "interface_id";
            default -> "source_id";
        };
    }

    /**
     * Gets the field to return for association relationships.
     */
    private String getReturnField(String relationshipType, String rootEntityType) {
        return switch (relationshipType) {
            case RT_APP_POINT_BUSINESS_PROCESSES ->
                rootEntityType.equals(ET_APPLICATION) ? "business_process_id" : "application_point_id";
            case RT_LOGICAL_PHYSICAL_ENTITIES -> "physical_entity_id";
            case RT_BUSINESS_USER_PROCESSES -> "business_process_id";
            case RT_INTERFACE_LOGICAL_ENTITIES -> "logical_entity_id";
            default -> "target_id";
        };
    }

    /**
     * Gets a list of entities from the entities map.
     */
    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> getEntityList(Map<String, Object> entities, String tableName) {
        Object list = entities.get(tableName);
        if (list instanceof List) {
            return (List<Map<String, Object>>) list;
        }
        return List.of();
    }

    /**
     * Gets a list of relationships from the relationships map.
     */
    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> getRelationshipList(Map<String, Object> relationships, String tableName) {
        Object list = relationships.get(tableName);
        if (list instanceof List) {
            return (List<Map<String, Object>>) list;
        }
        return List.of();
    }

    /**
     * Gets the name of an entity from the meta-model.
     */
    @SuppressWarnings("unchecked")
    private String getEntityName(Map<String, Object> metaModel, String entityType, String entityId) {
        try {
            Map<String, Object> entities = (Map<String, Object>) metaModel.get("entities");
            if (entities == null) return "";

            String tableName = getTableNameForEntityType(entityType);
            List<Map<String, Object>> entityList = getEntityList(entities, tableName);

            for (Map<String, Object> entity : entityList) {
                if (entityId.equals(entity.get("id"))) {
                    return (String) entity.getOrDefault("name", "");
                }
            }
        } catch (Exception e) {
            log.warn("Error getting entity name: {}", e.getMessage());
        }
        return "";
    }

    /**
     * Gets the table name for an entity type.
     */
    private String getTableNameForEntityType(String entityType) {
        return switch (entityType) {
            case ET_APPLICATION -> "applications";
            case ET_APP_COMPONENT -> "app_components";
            case ET_SERVICE -> "services";
            case ET_INTERFACE -> "interfaces";
            case ET_APPLICATION_POINT -> "application_points";
            case ET_BUSINESS_USER -> "business_users";
            case ET_BUSINESS_PROCESS -> "business_processes";
            case ET_PROCESS_ACTIVITY -> "process_activities";
            case ET_LOGICAL_DATA_ENTITY -> "logical_data_entities";
            case ET_LOGICAL_DATA_ATTRIBUTE -> "logical_data_attributes";
            case ET_PHYSICAL_DATA_ENTITY -> "physical_data_entities";
            case ET_PHYSICAL_DATA_ATTRIBUTE -> "physical_data_attributes";
            default -> entityType.toLowerCase() + "s";
        };
    }

    /**
     * Gets existing entity IDs from diagram data.
     */
    @SuppressWarnings("unchecked")
    private Set<String> getExistingEntityIds(Map<String, Object> diagramData) {
        Set<String> ids = new HashSet<>();
        try {
            List<Map<String, Object>> nodes = (List<Map<String, Object>>) diagramData.get("diagram_nodes");
            if (nodes != null) {
                for (Map<String, Object> node : nodes) {
                    String entityId = (String) node.get("entity_id");
                    if (entityId != null) {
                        ids.add(entityId);
                    }
                }
            }
        } catch (Exception e) {
            log.warn("Error getting existing entity IDs: {}", e.getMessage());
        }
        return ids;
    }

    /**
     * Gets existing edge IDs from diagram data.
     */
    @SuppressWarnings("unchecked")
    private Set<String> getExistingEdgeIds(Map<String, Object> diagramData) {
        Set<String> ids = new HashSet<>();
        try {
            List<Map<String, Object>> edges = (List<Map<String, Object>>) diagramData.get("diagram_edges");
            if (edges != null) {
                for (Map<String, Object> edge : edges) {
                    String relationshipId = (String) edge.get("relationship_id");
                    if (relationshipId != null) {
                        ids.add(relationshipId);
                    }
                }
            }
        } catch (Exception e) {
            log.warn("Error getting existing edge IDs: {}", e.getMessage());
        }
        return ids;
    }
}
