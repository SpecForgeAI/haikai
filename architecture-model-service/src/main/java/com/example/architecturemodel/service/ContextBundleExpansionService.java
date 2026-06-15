package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.DiagramBundleSelection;
import com.example.architecturemodel.model.dto.EntityBundleSelection;
import com.example.architecturemodel.model.dto.ExpandResolveResponseDto;
import com.example.architecturemodel.model.dto.diagram.ResolvedDiagramSummary;
import com.example.architecturemodel.model.dto.entity.ResolvedEntitySummary;
import com.example.architecturemodel.model.dto.relationship.RelationshipEndpoint;
import com.example.architecturemodel.model.dto.relationship.ResolvedRelationshipDto;
import com.example.architecturemodel.model.entity.EndpointEntity;
import com.example.architecturemodel.model.entity.InterfaceEntity;
import com.example.architecturemodel.model.entity.InterfaceLogicalEntityEntity;
import com.example.architecturemodel.model.entity.LogicalDataEntityRelationshipEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.model.entity.PhysicalDataAttributeEntity;
import com.example.architecturemodel.model.entity.ServiceEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.diagram.DiagramNodeRepository;
import com.example.architecturemodel.repository.diagram.DiagramRepository;
import com.example.architecturemodel.repository.entity.EndpointRepository;
import com.example.architecturemodel.repository.entity.InterfaceRepository;
import com.example.architecturemodel.repository.entity.PhysicalDataAttributeRepository;
import com.example.architecturemodel.repository.entity.ServiceRepository;
import com.example.architecturemodel.repository.relationship.InterfaceLogicalEntityRepository;
import com.example.architecturemodel.repository.relationship.LogicalDataEntityRelationshipRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;
import java.util.stream.Collectors;

/**
 * Service for expanding context bundle selections into related entities/diagrams
 * and resolving them into human-readable summaries.
 *
 * This service takes entity and diagram bundle selections with bundle_type indicators
 * and expands them according to the bundle expansion rules, then resolves the expanded
 * IDs into detailed summaries for LLM context enrichment.
 *
 * Key features:
 * - De-duplication of expanded entity IDs using LinkedHashSet
 * - Deterministic ordering (sorted by entityType then entityId)
 * - Configurable truncation limits with truncation reason reporting
 * - Automatic relationship discovery between expanded entities
 * - Depth-aware expansion for data entities (Spec 2026-01-17)
 *
 * Bundle expansion rules implemented:
 * - interface_only: returns only the interface entity
 * - interface_with_endpoints: includes all endpoints via EndpointRepository.findByInterfaceId()
 * - interface_with_endpoints_and_schemas: includes endpoints AND data entities via InterfaceLogicalEntityRepository
 * - service_only: returns only the service entity
 * - service_with_parents_and_children: includes Application/ApplicationComponent parents and child interfaces
 * - entity_only: returns only the data entity (logical or physical)
 * - entity_with_attributes_and_relationships: includes attributes (for physical) and relationships
 *   - depth=1 (default): direct relationships only
 *   - depth=2: relationships up to 2 hops
 * - diagram_only: returns only the diagram ID (does NOT auto-expand node references)
 *
 * Spec: Context Bundles Backend Expansion - Task Groups 3, 4, 5, 6 & 7
 * Spec: Context Bundles Auto-Include Relationships - Task Groups 2, 3, 4, 5, 6
 * Spec 2026-01-17: Fix Context Bundle + Depth Wiring End-to-End - Task Group 6
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class ContextBundleExpansionService {

    private final ModelFileRepository modelFileRepository;
    private final ImplementContextResolutionService resolutionService;

    // Repositories for traversal (Task Group 3.3)
    private final EndpointRepository endpointRepository;
    private final InterfaceRepository interfaceRepository;
    private final PhysicalDataAttributeRepository physicalDataAttributeRepository;
    private final LogicalDataEntityRelationshipRepository logicalDataEntityRelationshipRepository;
    private final DiagramNodeRepository diagramNodeRepository;
    private final DiagramRepository diagramRepository;
    private final ServiceRepository serviceRepository;

    // Repository for interface-to-data-entity relationships (Task Group 4)
    private final InterfaceLogicalEntityRepository interfaceLogicalEntityRepository;

    // Configurable truncation limits (Task Group 3.6)
    @Value("${context.expansion.maxEntities:250}")
    private int maxExpandedEntities;

    @Value("${context.expansion.maxDiagrams:50}")
    private int maxExpandedDiagrams;

    // Configurable relationship limit (Auto-Include Relationships - Task Group 2.2)
    @Value("${context.expansion.maxRelationships:500}")
    private int maxRelationships;

    // Configurable limit for depth=2 expansion (Spec 2026-01-17 Task Group 6)
    @Value("${context.expansion.maxDepth2Entities:100}")
    private int maxDepth2Entities;

    // Bundle type constants for interface expansion (Task Group 4)
    private static final String BUNDLE_INTERFACE_ONLY = "interface_only";
    private static final String BUNDLE_INTERFACE_WITH_ENDPOINTS = "interface_with_endpoints";
    private static final String BUNDLE_INTERFACE_WITH_ENDPOINTS_AND_SCHEMAS = "interface_with_endpoints_and_schemas";

    // Bundle type constants for service expansion (Task Group 5)
    private static final String BUNDLE_SERVICE_ONLY = "service_only";
    private static final String BUNDLE_SERVICE_WITH_PARENTS_AND_CHILDREN = "service_with_parents_and_children";

    // Bundle type constants for data entity expansion (Task Group 6)
    private static final String BUNDLE_ENTITY_ONLY = "entity_only";
    private static final String BUNDLE_ENTITY_WITH_ATTRIBUTES_AND_RELATIONSHIPS = "entity_with_attributes_and_relationships";

    // Bundle type constant for diagram expansion (Task Group 7)
    private static final String BUNDLE_DIAGRAM_ONLY = "diagram_only";

    // Data entity point ID prefixes (Task Group 4.5 & 6)
    private static final String DEP_LOGICAL_PREFIX = "dep_log_";
    private static final String DEP_PHYSICAL_PREFIX = "dep_phy_";

    // Entity type constants for data entities (Task Group 6)
    private static final String ENTITY_TYPE_LOGICAL_DATA_ENTITIES = "logicalDataEntities";
    private static final String ENTITY_TYPE_PHYSICAL_DATA_ENTITIES = "physicalDataEntities";
    private static final String ENTITY_TYPE_PHYSICAL_DATA_ATTRIBUTES = "physicalDataAttributes";

    // Relationship type constants (Auto-Include Relationships)
    private static final String REL_TYPE_FK = "fk";
    private static final String REL_TYPE_ASSOCIATION = "association";
    private static final String REL_TYPE_MANY_TO_MANY = "many_to_many";
    private static final String REL_TYPE_SCHEMA_REF = "schema_ref";
    private static final String REL_TYPE_CONTAINS = "contains";
    private static final String REL_TYPE_EXPOSES = "exposes";

    /**
     * Internal record for expansion results containing both expanded IDs and discovered relationships.
     * Used to return multiple values from expansion methods.
     *
     * Spec: Context Bundles Auto-Include Relationships - Task Groups 4 & 5
     */
    private record ExpansionResult(List<String> expandedIds, List<ResolvedRelationshipDto> relationships) {
        static ExpansionResult of(List<String> expandedIds) {
            return new ExpansionResult(expandedIds, Collections.emptyList());
        }
        static ExpansionResult of(List<String> expandedIds, List<ResolvedRelationshipDto> relationships) {
            return new ExpansionResult(expandedIds, relationships);
        }
    }

    /**
     * Expands bundle selections and resolves them into detailed summaries.
     *
     * This method:
     * 1. Validates inputs and looks up the model file
     * 2. Expands entity selections based on bundle_type
     * 3. Expands diagram selections based on bundle_type
     * 4. De-duplicates and sorts expanded IDs deterministically
     * 5. Truncates if limits are exceeded
     * 6. Resolves expanded IDs into human-readable summaries
     * 7. Discovers relationships between expanded entities
     *
     * @param projectId the project ID (filename)
     * @param selectedEntities list of entity bundle selections to expand
     * @param selectedDiagrams list of diagram bundle selections to expand
     * @return ExpandResolveResponseDto with expanded IDs and resolved summaries
     * @throws ResourceNotFoundException if project/model file not found
     */
    @Transactional(readOnly = true)
    public ExpandResolveResponseDto expandAndResolve(
            UUID projectId,
            List<EntityBundleSelection> selectedEntities,
            List<DiagramBundleSelection> selectedDiagrams) {

        log.debug("Expanding and resolving context for project: {}, entities: {}, diagrams: {}",
            projectId,
            selectedEntities != null ? selectedEntities.size() : 0,
            selectedDiagrams != null ? selectedDiagrams.size() : 0);

        // Validate inputs and lookup model file by project UUID (Task Group 3.4)
        ModelFileEntity modelFile = modelFileRepository.findByProjectId(projectId)
            .orElseThrow(() -> new ResourceNotFoundException("Model file not found for project: " + projectId));

        String modelFileId = modelFile.getId();

        // Initialize tracking for truncation
        boolean truncated = false;
        List<String> truncationReasons = new ArrayList<>();

        // Initialize collection for structural relationships discovered during expansion
        List<ResolvedRelationshipDto> structuralRelationships = new ArrayList<>();

        // Step 1: Expand entity selections
        // Use LinkedHashSet for de-duplication while preserving insertion order initially
        LinkedHashSet<String> expandedEntityIdSet = new LinkedHashSet<>();
        if (selectedEntities != null) {
            for (EntityBundleSelection selection : selectedEntities) {
                ExpansionResult result = expandEntity(selection, modelFileId);
                expandedEntityIdSet.addAll(result.expandedIds());
                structuralRelationships.addAll(result.relationships());
            }
        }

        // Step 2: Expand diagram selections
        LinkedHashSet<String> expandedDiagramIdSet = new LinkedHashSet<>();
        if (selectedDiagrams != null) {
            for (DiagramBundleSelection selection : selectedDiagrams) {
                List<String> expanded = expandDiagram(selection, modelFileId);
                expandedDiagramIdSet.addAll(expanded);
            }
        }

        // Step 3: Apply deterministic ordering (sort by entityType then entityId)
        List<String> sortedEntityIds = sortCanonicalIds(expandedEntityIdSet);
        List<String> sortedDiagramIds = new ArrayList<>(expandedDiagramIdSet);
        Collections.sort(sortedDiagramIds);

        // Step 4: Apply truncation if limits exceeded
        if (sortedEntityIds.size() > maxExpandedEntities) {
            truncated = true;
            truncationReasons.add(String.format(
                "Truncated entities from %d to %d (limit: %d)",
                sortedEntityIds.size(), maxExpandedEntities, maxExpandedEntities
            ));
            sortedEntityIds = sortedEntityIds.subList(0, maxExpandedEntities);
            log.warn("Entity expansion exceeded limit: truncated from {} to {}",
                expandedEntityIdSet.size(), maxExpandedEntities);
        }

        if (sortedDiagramIds.size() > maxExpandedDiagrams) {
            truncated = true;
            truncationReasons.add(String.format(
                "Truncated diagrams from %d to %d (limit: %d)",
                sortedDiagramIds.size(), maxExpandedDiagrams, maxExpandedDiagrams
            ));
            sortedDiagramIds = sortedDiagramIds.subList(0, maxExpandedDiagrams);
            log.warn("Diagram expansion exceeded limit: truncated from {} to {}",
                expandedDiagramIdSet.size(), maxExpandedDiagrams);
        }

        // Step 5: Resolve expanded IDs into summaries
        List<ResolvedEntitySummary> resolvedEntities = resolveEntities(sortedEntityIds, modelFileId);
        List<ResolvedDiagramSummary> resolvedDiagrams = resolveDiagrams(sortedDiagramIds, modelFileId);

        // Build entity summaries map for relationship endpoint name resolution
        // Note: ResolvedEntitySummary uses id() method, not entityId()
        Map<String, ResolvedEntitySummary> entitySummariesByCanonicalId = new HashMap<>();
        for (ResolvedEntitySummary summary : resolvedEntities) {
            String canonicalId = formatCanonicalId(summary.entityType(), summary.id());
            entitySummariesByCanonicalId.put(canonicalId, summary);
        }

        // Step 6: Discover relationships between expanded entities (Task 2.6)
        Set<String> expandedEntityIdSetFinal = new LinkedHashSet<>(sortedEntityIds);
        List<ResolvedRelationshipDto> discoveredRelationships = discoverRelationships(
            expandedEntityIdSetFinal,
            modelFileId,
            entitySummariesByCanonicalId,
            structuralRelationships,
            truncationReasons
        );

        // Check if relationships were truncated
        if (!truncationReasons.isEmpty() && !truncated) {
            String lastReason = truncationReasons.get(truncationReasons.size() - 1);
            if (lastReason.contains("relationships")) {
                truncated = true;
            }
        }

        // Build truncation reason string
        String truncationReason = truncated ? String.join("; ", truncationReasons) : null;

        log.debug("Expansion complete: {} entities, {} diagrams, {} relationships, truncated: {}",
            sortedEntityIds.size(), sortedDiagramIds.size(), discoveredRelationships.size(), truncated);

        return new ExpandResolveResponseDto(
            sortedEntityIds,
            sortedDiagramIds,
            resolvedEntities,
            resolvedDiagrams,
            truncated,
            truncationReason,
            discoveredRelationships
        );
    }

    // ============================================================================
    // Relationship Discovery (Auto-Include Relationships - Task Group 2)
    // ============================================================================

    /**
     * Discovers relationships between expanded entities.
     *
     * Task Group 2.3: Implements the main relationship discovery method.
     * This method:
     * 1. Collects data entity relationships (Rule 1 - Task Group 3)
     * 2. Combines with structural relationships from expansion (Rules 2 & 3 - Task Groups 4 & 5)
     * 3. De-duplicates by (type + from.entityId + to.entityId) tuple (Task 2.4)
     * 4. Sorts deterministically by type, from.entityType, from.entityId (Task 2.5)
     * 5. Applies truncation limit if exceeded
     *
     * @param expandedEntityIds set of expanded canonical entity IDs
     * @param modelFileId the model file ID for scoping relationship queries
     * @param entitySummariesByCanonicalId map of entity summaries for name resolution
     * @param structuralRelationships relationships discovered during entity expansion
     * @param truncationReasons list to add truncation reasons if limit exceeded
     * @return de-duplicated, sorted list of discovered relationships
     */
    private List<ResolvedRelationshipDto> discoverRelationships(
            Set<String> expandedEntityIds,
            String modelFileId,
            Map<String, ResolvedEntitySummary> entitySummariesByCanonicalId,
            List<ResolvedRelationshipDto> structuralRelationships,
            List<String> truncationReasons) {

        log.trace("Discovering relationships for {} expanded entities", expandedEntityIds.size());

        // Return empty list when no expanded entities (Task 2.1 - test case 1)
        if (expandedEntityIds == null || expandedEntityIds.isEmpty()) {
            return Collections.emptyList();
        }

        // Collect all relationships using LinkedHashSet for de-duplication (Task 2.4)
        // Use unique key: type + from.entityId + to.entityId
        Map<String, ResolvedRelationshipDto> uniqueRelationships = new LinkedHashMap<>();

        // Task Group 3: Collect data entity relationships (Rule 1)
        List<ResolvedRelationshipDto> dataEntityRelationships = collectDataEntityRelationships(
            expandedEntityIds, modelFileId, entitySummariesByCanonicalId
        );
        for (ResolvedRelationshipDto rel : dataEntityRelationships) {
            String uniqueKey = buildRelationshipUniqueKey(rel);
            uniqueRelationships.put(uniqueKey, rel);
        }

        // Add structural relationships from expansion (Rules 2 & 3 - already collected during expansion)
        for (ResolvedRelationshipDto rel : structuralRelationships) {
            String uniqueKey = buildRelationshipUniqueKey(rel);
            // Only include if both endpoints are in expanded set (Task 2.1 - test case 5)
            String fromCanonicalId = formatCanonicalId(rel.from().entityType(), rel.from().entityId());
            String toCanonicalId = formatCanonicalId(rel.to().entityType(), rel.to().entityId());
            if (expandedEntityIds.contains(fromCanonicalId) && expandedEntityIds.contains(toCanonicalId)) {
                uniqueRelationships.put(uniqueKey, rel);
            }
        }

        // Convert to list for sorting
        List<ResolvedRelationshipDto> allRelationships = new ArrayList<>(uniqueRelationships.values());

        // Task 2.5: Apply deterministic sorting
        // Primary: relationship type (alphabetically)
        // Secondary: from.entityType (alphabetically)
        // Tertiary: from.entityId (alphabetically)
        allRelationships.sort((a, b) -> {
            int typeCompare = a.type().compareTo(b.type());
            if (typeCompare != 0) return typeCompare;

            int fromTypeCompare = a.from().entityType().compareTo(b.from().entityType());
            if (fromTypeCompare != 0) return fromTypeCompare;

            return a.from().entityId().compareTo(b.from().entityId());
        });

        // Apply truncation if limit exceeded (Task 2.2)
        if (allRelationships.size() > maxRelationships) {
            truncationReasons.add(String.format(
                "Truncated relationships from %d to %d (limit: %d)",
                allRelationships.size(), maxRelationships, maxRelationships
            ));
            log.warn("Relationship discovery exceeded limit: truncated from {} to {}",
                allRelationships.size(), maxRelationships);
            allRelationships = allRelationships.subList(0, maxRelationships);
        }

        log.trace("Discovered {} relationships after de-duplication and sorting", allRelationships.size());
        return allRelationships;
    }

    /**
     * Builds a unique key for relationship de-duplication.
     *
     * Task 2.4: Uses tuple (type + from.entityId + to.entityId) as unique key.
     *
     * @param relationship the relationship to build a key for
     * @return unique key string
     */
    private String buildRelationshipUniqueKey(ResolvedRelationshipDto relationship) {
        return relationship.type() + "|" + relationship.from().entityId() + "|" + relationship.to().entityId();
    }

    // ============================================================================
    // Data Entity Relationship Discovery (Task Group 3)
    // ============================================================================

    /**
     * Collects data entity relationships where BOTH endpoints are in the expanded set.
     *
     * Task Group 3.2-3.5: Implements Rule 1 - Data Entity Relationship Discovery.
     * - Queries LogicalDataEntityRelationshipRepository.findByModelFileId()
     * - Filters to relationships where both endpoints are in expanded set
     * - Resolves endpoint names from entity summaries
     * - Maps relationship types (fk, association, many_to_many)
     * - Populates summaryFields with cardinality, relationship_type, description (Task Group 6)
     *
     * @param expandedEntityIds set of expanded canonical entity IDs
     * @param modelFileId the model file ID for scoping queries
     * @param entitySummariesByCanonicalId map of entity summaries for name resolution
     * @return list of discovered data entity relationships
     */
    private List<ResolvedRelationshipDto> collectDataEntityRelationships(
            Set<String> expandedEntityIds,
            String modelFileId,
            Map<String, ResolvedEntitySummary> entitySummariesByCanonicalId) {

        log.trace("Collecting data entity relationships for model: {}", modelFileId);

        List<ResolvedRelationshipDto> relationships = new ArrayList<>();

        // Task 3.2: Query all relationships in the model file
        List<LogicalDataEntityRelationshipEntity> allRelationships =
            logicalDataEntityRelationshipRepository.findByModelFileId(modelFileId);

        log.trace("Found {} total data entity relationships in model", allRelationships.size());

        for (LogicalDataEntityRelationshipEntity relEntity : allRelationships) {
            // Parse endpoint point IDs to canonical format
            String fromCanonicalId = parseDataEntityPointId(relEntity.getFromDataEntityPointId());
            String toCanonicalId = parseDataEntityPointId(relEntity.getToDataEntityPointId());

            // Skip if either endpoint couldn't be parsed
            if (fromCanonicalId == null || toCanonicalId == null) {
                log.trace("Skipping relationship {} - could not parse endpoint IDs", relEntity.getId());
                continue;
            }

            // Task 3.1 test case 1 & 2: Only include if BOTH endpoints are in expanded set
            if (!expandedEntityIds.contains(fromCanonicalId) || !expandedEntityIds.contains(toCanonicalId)) {
                log.trace("Skipping relationship {} - endpoints not both in expanded set", relEntity.getId());
                continue;
            }

            // Task 3.3: Resolve endpoint names from expanded entity summaries
            String[] fromParts = parseCanonicalId(fromCanonicalId);
            String[] toParts = parseCanonicalId(toCanonicalId);

            String fromName = resolveEntityName(fromCanonicalId, fromParts[1], entitySummariesByCanonicalId);
            String toName = resolveEntityName(toCanonicalId, toParts[1], entitySummariesByCanonicalId);

            // Task 3.4: Map relationship type
            String relType = mapDataEntityRelationshipType(relEntity);

            // Task Group 6.2-6.3: Populate summaryFields
            Map<String, Object> summaryFields = buildSummaryFields(relEntity);

            // Build relationship label from type or description
            String label = relEntity.getDescription() != null && !relEntity.getDescription().isEmpty()
                ? relEntity.getDescription()
                : relType;

            RelationshipEndpoint fromEndpoint = new RelationshipEndpoint(fromParts[0], fromParts[1], fromName);
            RelationshipEndpoint toEndpoint = new RelationshipEndpoint(toParts[0], toParts[1], toName);

            relationships.add(new ResolvedRelationshipDto(
                relEntity.getId(),
                relType,
                fromEndpoint,
                toEndpoint,
                label,
                summaryFields
            ));
        }

        log.trace("Collected {} data entity relationships with both endpoints in expanded set",
            relationships.size());
        return relationships;
    }

    /**
     * Resolves an entity name from the entity summaries map.
     *
     * Task 3.3: Implements endpoint name resolution.
     * Uses the entity's name from resolved summaries, falling back to entityId if not found.
     *
     * @param canonicalId the canonical entity ID
     * @param entityId the entity ID (fallback)
     * @param entitySummariesByCanonicalId map of entity summaries
     * @return the resolved entity name
     */
    private String resolveEntityName(
            String canonicalId,
            String entityId,
            Map<String, ResolvedEntitySummary> entitySummariesByCanonicalId) {

        ResolvedEntitySummary summary = entitySummariesByCanonicalId.get(canonicalId);
        if (summary != null && summary.name() != null && !summary.name().isEmpty()) {
            return summary.name();
        }
        // Fallback to entityId if name not found in summaries
        return entityId;
    }

    /**
     * Maps a LogicalDataEntityRelationshipEntity to a relationship type string.
     *
     * Task 3.4: Implements relationship type mapping.
     * - Uses "fk" for DEPENDENCY or COMPOSITION relationships (foreign key semantics)
     * - Uses "many_to_many" for MANY_TO_MANY cardinality
     * - Uses "association" for ASSOCIATION or default
     *
     * @param relEntity the relationship entity
     * @return the mapped relationship type string
     */
    private String mapDataEntityRelationshipType(LogicalDataEntityRelationshipEntity relEntity) {
        String relationship = relEntity.getRelationship();
        String cardinality = relEntity.getCardinality();

        // Check for FK semantics (DEPENDENCY or COMPOSITION typically indicate FK)
        if (relationship != null) {
            String upperRel = relationship.toUpperCase();
            if ("DEPENDENCY".equals(upperRel) || "COMPOSITION".equals(upperRel)) {
                return REL_TYPE_FK;
            }
        }

        // Check for MANY_TO_MANY cardinality
        if (cardinality != null && "MANY_TO_MANY".equalsIgnoreCase(cardinality)) {
            return REL_TYPE_MANY_TO_MANY;
        }

        // Default to association
        return REL_TYPE_ASSOCIATION;
    }

    /**
     * Builds the summaryFields map from a LogicalDataEntityRelationshipEntity.
     *
     * Task Group 6.2-6.3: Populates summaryFields with available metadata.
     * Only includes non-null values to handle empty fields gracefully.
     *
     * Fields included when present:
     * - cardinality: ONE_TO_ONE, ONE_TO_MANY, MANY_TO_ONE, MANY_TO_MANY
     * - relationship_type: GENERALIZATION, REALIZATION, COMPOSITION, AGGREGATION, ASSOCIATION, DEPENDENCY
     * - description: Optional description text
     *
     * @param relEntity the relationship entity
     * @return map of summary fields (empty if all optional fields are null)
     */
    private Map<String, Object> buildSummaryFields(LogicalDataEntityRelationshipEntity relEntity) {
        Map<String, Object> summaryFields = new HashMap<>();

        // Task 6.2: Add cardinality if present
        if (relEntity.getCardinality() != null && !relEntity.getCardinality().isEmpty()) {
            summaryFields.put("cardinality", relEntity.getCardinality());
        }

        // Task 6.2: Add relationship_type if present
        if (relEntity.getRelationship() != null && !relEntity.getRelationship().isEmpty()) {
            summaryFields.put("relationship_type", relEntity.getRelationship());
        }

        // Task 6.2: Add description if present
        if (relEntity.getDescription() != null && !relEntity.getDescription().isEmpty()) {
            summaryFields.put("description", relEntity.getDescription());
        }

        // Task 6.3: Return empty map if all optional fields are null
        return summaryFields;
    }

    /**
     * Expands a single entity selection based on its bundle_type.
     *
     * Dispatches to the appropriate expansion method based on entity type and bundle type:
     * - For interfaces: expandInterface()
     * - For services: expandService()
     * - For data entities (logical/physical): expandDataEntity() with depth support
     * - For other entity types: placeholder expansion returning just the entity itself
     *
     * Spec 2026-01-17 Task Group 6: Passes depth from selection to data entity expansion
     *
     * @param selection the entity bundle selection
     * @param modelFileId the model file ID for scoping queries
     * @return ExpansionResult with expanded canonical entity IDs and discovered relationships
     */
    private ExpansionResult expandEntity(EntityBundleSelection selection, String modelFileId) {
        if (selection == null || selection.entityType() == null || selection.entityId() == null) {
            return ExpansionResult.of(List.of());
        }

        String entityType = selection.entityType();
        String entityId = selection.entityId();
        String bundleType = selection.bundleType();
        // Spec 2026-01-17 Task Group 6: Get effective depth (defaults to 1 if null)
        int depth = selection.effectiveDepth();

        log.trace("Expanding entity: {}::{} with bundleType: {}, depth: {}", entityType, entityId, bundleType, depth);

        // Dispatch to appropriate expansion method based on entity type
        if ("interfaces".equals(entityType)) {
            return expandInterface(entityId, bundleType, modelFileId);
        }

        if ("services".equals(entityType)) {
            return expandService(entityId, bundleType, modelFileId);
        }

        // Handle data entity types (Task Group 6 + Spec 2026-01-17 Task Group 6)
        if (ENTITY_TYPE_LOGICAL_DATA_ENTITIES.equals(entityType) ||
            ENTITY_TYPE_PHYSICAL_DATA_ENTITIES.equals(entityType)) {
            // Pass depth to data entity expansion
            return ExpansionResult.of(expandDataEntity(entityId, entityType, bundleType, modelFileId, depth));
        }

        // Default: return the entity itself in canonical format
        // Full expansion logic for other entity types will be implemented in future task groups
        String canonicalId = formatCanonicalId(entityType, entityId);
        return ExpansionResult.of(List.of(canonicalId));
    }

    // ============================================================================
    // Interface Bundle Expansion (Task Group 4)
    // ============================================================================

    /**
     * Expands an interface based on its bundle_type.
     *
     * Task Group 4.2: Main dispatch method for interface expansion.
     *
     * @param interfaceId the interface ID to expand
     * @param bundleType the bundle type determining expansion scope
     * @param modelFileId the model file ID for scoping queries
     * @return ExpansionResult with expanded entity IDs and discovered relationships
     */
    private ExpansionResult expandInterface(String interfaceId, String bundleType, String modelFileId) {
        log.trace("Expanding interface: {} with bundleType: {}", interfaceId, bundleType);

        if (bundleType == null) {
            // Default to interface_only if no bundle type specified
            return ExpansionResult.of(expandInterfaceOnly(interfaceId));
        }

        switch (bundleType) {
            case BUNDLE_INTERFACE_ONLY:
                return ExpansionResult.of(expandInterfaceOnly(interfaceId));
            case BUNDLE_INTERFACE_WITH_ENDPOINTS:
                return ExpansionResult.of(expandInterfaceWithEndpoints(interfaceId));
            case BUNDLE_INTERFACE_WITH_ENDPOINTS_AND_SCHEMAS:
                return expandInterfaceWithEndpointsAndSchemas(interfaceId, modelFileId);
            default:
                log.warn("Unknown bundle type '{}' for interface, defaulting to interface_only", bundleType);
                return ExpansionResult.of(expandInterfaceOnly(interfaceId));
        }
    }

    /**
     * Expands interface with bundle_type = interface_only.
     *
     * Task Group 4.3: Returns only the interface entity itself.
     *
     * @param interfaceId the interface ID
     * @return single-element list containing "interfaces::<interfaceId>"
     */
    private List<String> expandInterfaceOnly(String interfaceId) {
        log.trace("Expanding interface_only for: {}", interfaceId);
        return List.of(formatCanonicalId("interfaces", interfaceId));
    }

    /**
     * Expands interface with bundle_type = interface_with_endpoints.
     *
     * Task Group 4.4: Returns the interface plus all its endpoints.
     * Queries EndpointRepository.findByInterfaceId() to get all endpoints.
     *
     * @param interfaceId the interface ID
     * @return list containing interface and all endpoint IDs in canonical format
     */
    private List<String> expandInterfaceWithEndpoints(String interfaceId) {
        log.trace("Expanding interface_with_endpoints for: {}", interfaceId);

        List<String> expandedIds = new ArrayList<>();

        // Include the interface itself
        expandedIds.add(formatCanonicalId("interfaces", interfaceId));

        // Query and include all endpoints for this interface
        List<EndpointEntity> endpoints = endpointRepository.findByInterfaceId(interfaceId);
        for (EndpointEntity endpoint : endpoints) {
            expandedIds.add(formatCanonicalId("endpoints", endpoint.getId()));
        }

        log.trace("interface_with_endpoints expanded to {} entities (1 interface + {} endpoints)",
            expandedIds.size(), endpoints.size());

        return expandedIds;
    }

    /**
     * Expands interface with bundle_type = interface_with_endpoints_and_schemas.
     *
     * Task Group 4.5 and Auto-Include Relationships Task 4.2-4.4:
     * Returns the interface, all endpoints, AND all related data entities.
     * Also creates schema_ref relationships for interface-to-data-entity links.
     *
     * @param interfaceId the interface ID
     * @param modelFileId the model file ID for scoping queries
     * @return ExpansionResult containing expanded IDs and schema_ref relationships
     */
    private ExpansionResult expandInterfaceWithEndpointsAndSchemas(String interfaceId, String modelFileId) {
        log.trace("Expanding interface_with_endpoints_and_schemas for: {}", interfaceId);

        List<String> expandedIds = new ArrayList<>();
        List<ResolvedRelationshipDto> schemaRefRelationships = new ArrayList<>();

        // Include the interface itself
        expandedIds.add(formatCanonicalId("interfaces", interfaceId));

        // Include all endpoints for this interface
        List<EndpointEntity> endpoints = endpointRepository.findByInterfaceId(interfaceId);
        for (EndpointEntity endpoint : endpoints) {
            expandedIds.add(formatCanonicalId("endpoints", endpoint.getId()));
        }

        // Task 4.2: Query interface-to-data-entity links and create schema_ref relationships
        List<InterfaceLogicalEntityEntity> dataEntityRelations =
            interfaceLogicalEntityRepository.findByInterfaceId(interfaceId);

        // Get interface name for relationship endpoint
        String interfaceName = getInterfaceName(interfaceId, modelFileId);

        for (InterfaceLogicalEntityEntity relation : dataEntityRelations) {
            String dataEntityCanonicalId = parseDataEntityPointId(relation.getDataEntityPointId());
            if (dataEntityCanonicalId != null) {
                expandedIds.add(dataEntityCanonicalId);

                // Task 4.3: Create schema_ref relationship DTO
                String[] dataEntityParts = parseCanonicalId(dataEntityCanonicalId);

                RelationshipEndpoint fromEndpoint = new RelationshipEndpoint(
                    "interfaces", interfaceId, interfaceName
                );
                RelationshipEndpoint toEndpoint = new RelationshipEndpoint(
                    dataEntityParts[0], dataEntityParts[1], dataEntityParts[1]
                );

                schemaRefRelationships.add(new ResolvedRelationshipDto(
                    "schema_ref_" + interfaceId + "_" + dataEntityParts[1],
                    REL_TYPE_SCHEMA_REF,
                    fromEndpoint,
                    toEndpoint,
                    "schema",
                    Collections.emptyMap()
                ));
            }
        }

        log.trace("interface_with_endpoints_and_schemas expanded to {} entities " +
            "(1 interface + {} endpoints + {} data entities), {} schema_ref relationships",
            expandedIds.size(), endpoints.size(), dataEntityRelations.size(), schemaRefRelationships.size());

        return ExpansionResult.of(expandedIds, schemaRefRelationships);
    }

    private String getInterfaceName(String interfaceId, String modelFileId) {
        Optional<InterfaceEntity> interfaceOpt = interfaceRepository.findById(interfaceId);
        if (interfaceOpt.isPresent() && interfaceOpt.get().getName() != null) {
            return interfaceOpt.get().getName();
        }
        return interfaceId;
    }

    /**
     * Parses a dataEntityPointId into its canonical entity ID format.
     *
     * Task Group 4.5: Handles the data entity point ID format used by interface-to-data-entity relationships.
     * - "dep_log_<id>" -> "logicalDataEntities::<id>"
     * - "dep_phy_<id>" -> "physicalDataEntities::<id>"
     *
     * @param dataEntityPointId the data entity point ID (e.g., "dep_log_entity-123" or "dep_phy_table-456")
     * @return canonical entity ID or null if format is invalid/unrecognized
     */
    private String parseDataEntityPointId(String dataEntityPointId) {
        if (dataEntityPointId == null || dataEntityPointId.isEmpty()) {
            log.trace("Skipping null/empty dataEntityPointId");
            return null;
        }

        if (dataEntityPointId.startsWith(DEP_LOGICAL_PREFIX)) {
            String entityId = dataEntityPointId.substring(DEP_LOGICAL_PREFIX.length());
            return formatCanonicalId(ENTITY_TYPE_LOGICAL_DATA_ENTITIES, entityId);
        }

        if (dataEntityPointId.startsWith(DEP_PHYSICAL_PREFIX)) {
            String entityId = dataEntityPointId.substring(DEP_PHYSICAL_PREFIX.length());
            return formatCanonicalId(ENTITY_TYPE_PHYSICAL_DATA_ENTITIES, entityId);
        }

        log.trace("Unrecognized dataEntityPointId format: {}", dataEntityPointId);
        return null;
    }

    // ============================================================================
    // Service Bundle Expansion (Task Group 5)
    // ============================================================================

    /**
     * Expands a service based on its bundle_type.
     *
     * Task Group 5.2: Main dispatch method for service expansion.
     *
     * @param serviceId the service ID to expand
     * @param bundleType the bundle type determining expansion scope
     * @param modelFileId the model file ID for scoping queries
     * @return ExpansionResult with expanded entity IDs and discovered relationships
     */
    private ExpansionResult expandService(String serviceId, String bundleType, String modelFileId) {
        log.trace("Expanding service: {} with bundleType: {}", serviceId, bundleType);

        if (bundleType == null) {
            // Default to service_only if no bundle type specified
            return ExpansionResult.of(expandServiceOnly(serviceId));
        }

        switch (bundleType) {
            case BUNDLE_SERVICE_ONLY:
                return ExpansionResult.of(expandServiceOnly(serviceId));
            case BUNDLE_SERVICE_WITH_PARENTS_AND_CHILDREN:
                return expandServiceWithParentsAndChildren(serviceId, modelFileId);
            default:
                log.warn("Unknown bundle type '{}' for service, defaulting to service_only", bundleType);
                return ExpansionResult.of(expandServiceOnly(serviceId));
        }
    }

    /**
     * Expands service with bundle_type = service_only.
     *
     * Task Group 5.3: Returns only the service entity itself.
     *
     * @param serviceId the service ID
     * @return single-element list containing "services::<serviceId>"
     */
    private List<String> expandServiceOnly(String serviceId) {
        log.trace("Expanding service_only for: {}", serviceId);
        return List.of(formatCanonicalId("services", serviceId));
    }

    /**
     * Expands service with bundle_type = service_with_parents_and_children.
     *
     * Task Group 5.4 and Auto-Include Relationships Task 5.2-5.4:
     * Returns the service, its parent Application/ApplicationComponent, and child interfaces.
     * Also creates structural relationships:
     * - application -> appComponent (contains)
     * - appComponent -> service (contains)
     * - service -> interface (exposes)
     *
     * @param serviceId the service ID
     * @param modelFileId the model file ID for scoping queries
     * @return ExpansionResult with expanded IDs and structural relationships
     */
    private ExpansionResult expandServiceWithParentsAndChildren(String serviceId, String modelFileId) {
        log.trace("Expanding service_with_parents_and_children for: {}", serviceId);

        List<String> expandedIds = new ArrayList<>();
        List<ResolvedRelationshipDto> structuralRelationships = new ArrayList<>();

        expandedIds.add(formatCanonicalId("services", serviceId));

        Optional<ServiceEntity> serviceEntityOpt = serviceRepository.findById(serviceId);
        if (serviceEntityOpt.isEmpty()) {
            return ExpansionResult.of(expandedIds);
        }

        ServiceEntity serviceEntity = serviceEntityOpt.get();
        String serviceName = serviceEntity.getName() != null ? serviceEntity.getName() : serviceId;
        String applicationId = serviceEntity.getApplicationId();
        String applicationComponentId = serviceEntity.getApplicationComponentId();

        if (applicationId != null && !applicationId.isEmpty()) {
            expandedIds.add(formatCanonicalId("applications", applicationId));
        }

        if (applicationComponentId != null && !applicationComponentId.isEmpty()) {
            expandedIds.add(formatCanonicalId("appComponents", applicationComponentId));

            // Task 5.3: Create contains relationship: application -> appComponent
            if (applicationId != null && !applicationId.isEmpty()) {
                structuralRelationships.add(new ResolvedRelationshipDto(
                    "contains_" + applicationId + "_" + applicationComponentId,
                    REL_TYPE_CONTAINS,
                    new RelationshipEndpoint("applications", applicationId, applicationId),
                    new RelationshipEndpoint("appComponents", applicationComponentId, applicationComponentId),
                    "contains", Collections.emptyMap()
                ));
            }

            // Task 5.3: Create contains relationship: appComponent -> service
            structuralRelationships.add(new ResolvedRelationshipDto(
                "contains_" + applicationComponentId + "_" + serviceId,
                REL_TYPE_CONTAINS,
                new RelationshipEndpoint("appComponents", applicationComponentId, applicationComponentId),
                new RelationshipEndpoint("services", serviceId, serviceName),
                "contains", Collections.emptyMap()
            ));
        } else if (applicationId != null && !applicationId.isEmpty()) {
            // Task 5.3: Create contains relationship: application -> service (no component)
            structuralRelationships.add(new ResolvedRelationshipDto(
                "contains_" + applicationId + "_" + serviceId,
                REL_TYPE_CONTAINS,
                new RelationshipEndpoint("applications", applicationId, applicationId),
                new RelationshipEndpoint("services", serviceId, serviceName),
                "contains", Collections.emptyMap()
            ));
        }

        // Find child interfaces
        List<InterfaceEntity> allInterfaces = interfaceRepository.findByModelFileId(modelFileId);
        List<InterfaceEntity> childInterfaces = allInterfaces.stream()
            .filter(iface -> serviceId.equals(iface.getServiceId()))
            .collect(Collectors.toList());

        for (InterfaceEntity childInterface : childInterfaces) {
            expandedIds.add(formatCanonicalId("interfaces", childInterface.getId()));
            String interfaceName = childInterface.getName() != null ? childInterface.getName() : childInterface.getId();

            // Task 5.3: Create exposes relationship: service -> interface
            structuralRelationships.add(new ResolvedRelationshipDto(
                "exposes_" + serviceId + "_" + childInterface.getId(),
                REL_TYPE_EXPOSES,
                new RelationshipEndpoint("services", serviceId, serviceName),
                new RelationshipEndpoint("interfaces", childInterface.getId(), interfaceName),
                "exposes", Collections.emptyMap()
            ));
        }

        return ExpansionResult.of(expandedIds, structuralRelationships);
    }

    // ============================================================================
    // Data Entity Bundle Expansion (Task Group 6 + Spec 2026-01-17 Task Group 6)
    // ============================================================================

    /**
     * Expands a data entity (logical or physical) based on its bundle_type and depth.
     *
     * Task Group 6.2: Main dispatch method for data entity expansion.
     * Handles both logicalDataEntities and physicalDataEntities types.
     *
     * Spec 2026-01-17 Task Group 6: Added depth parameter support
     * - depth=1 (default): Include direct relationships only
     * - depth=2: Include relationships up to 2 hops
     *
     * @param entityId the data entity ID to expand
     * @param entityType the entity type ("logicalDataEntities" or "physicalDataEntities")
     * @param bundleType the bundle type determining expansion scope
     * @param modelFileId the model file ID for scoping queries
     * @param depth the relationship expansion depth (1 or 2)
     * @return list of expanded entity IDs in canonical format
     */
    private List<String> expandDataEntity(String entityId, String entityType, String bundleType, String modelFileId, int depth) {
        log.trace("Expanding data entity: {}::{} with bundleType: {}, depth: {}", entityType, entityId, bundleType, depth);

        if (bundleType == null) {
            // Default to entity_only if no bundle type specified
            return expandDataEntityOnly(entityId, entityType);
        }

        switch (bundleType) {
            case BUNDLE_ENTITY_ONLY:
                return expandDataEntityOnly(entityId, entityType);
            case BUNDLE_ENTITY_WITH_ATTRIBUTES_AND_RELATIONSHIPS:
                return expandDataEntityWithAttributesAndRelationships(entityId, entityType, modelFileId, depth);
            default:
                log.warn("Unknown bundle type '{}' for data entity, defaulting to entity_only", bundleType);
                return expandDataEntityOnly(entityId, entityType);
        }
    }

    /**
     * Backward-compatible overload without depth parameter.
     * Delegates to the depth-aware version with depth=1.
     */
    private List<String> expandDataEntity(String entityId, String entityType, String bundleType, String modelFileId) {
        return expandDataEntity(entityId, entityType, bundleType, modelFileId, 1);
    }

    /**
     * Expands data entity with bundle_type = entity_only.
     *
     * Task Group 6.3: Returns only the data entity itself in canonical format.
     *
     * @param entityId the data entity ID
     * @param entityType the entity type ("logicalDataEntities" or "physicalDataEntities")
     * @return single-element list containing the canonical ID
     */
    private List<String> expandDataEntityOnly(String entityId, String entityType) {
        log.trace("Expanding entity_only for: {}::{}", entityType, entityId);
        return List.of(formatCanonicalId(entityType, entityId));
    }

    /**
     * Expands data entity with bundle_type = entity_with_attributes_and_relationships.
     *
     * Task Group 6.4 + Spec 2026-01-17 Task Group 6: Returns the data entity plus:
     * - For physical entities: includes attributes via PhysicalDataAttributeRepository.findByPhysicalEntityId()
     * - For all entities: includes relationships up to the specified depth
     *
     * Depth behavior:
     * - depth=1: Only direct relationships (existing behavior)
     * - depth=2: Direct relationships + relationships from those related entities
     *
     * Spec 2026-01-17 Task Group 6.4: Truncation limits are applied for depth=2
     *
     * @param entityId the data entity ID
     * @param entityType the entity type ("logicalDataEntities" or "physicalDataEntities")
     * @param modelFileId the model file ID for scoping queries
     * @param depth the relationship expansion depth (1 or 2)
     * @return list containing entity, attributes (if physical), and related entities up to depth
     */
    private List<String> expandDataEntityWithAttributesAndRelationships(
            String entityId, String entityType, String modelFileId, int depth) {
        log.trace("Expanding entity_with_attributes_and_relationships for: {}::{} with depth: {}", entityType, entityId, depth);

        LinkedHashSet<String> expandedIds = new LinkedHashSet<>();

        // Include the entity itself
        String rootCanonicalId = formatCanonicalId(entityType, entityId);
        expandedIds.add(rootCanonicalId);

        // For physical entities, include attributes
        if (ENTITY_TYPE_PHYSICAL_DATA_ENTITIES.equals(entityType)) {
            List<PhysicalDataAttributeEntity> attributes =
                physicalDataAttributeRepository.findByPhysicalEntityId(entityId);

            for (PhysicalDataAttributeEntity attribute : attributes) {
                expandedIds.add(formatCanonicalId(ENTITY_TYPE_PHYSICAL_DATA_ATTRIBUTES, attribute.getId()));
            }

            log.trace("Added {} attributes for physical entity: {}", attributes.size(), entityId);
        }

        // Query all relationships in the model file once
        List<LogicalDataEntityRelationshipEntity> allRelationships =
            logicalDataEntityRelationshipRepository.findByModelFileId(modelFileId);

        // Track entities at each depth level for multi-hop expansion
        Set<String> currentLevelEntities = new HashSet<>();
        currentLevelEntities.add(rootCanonicalId);

        // Expand relationships for each depth level
        for (int currentDepth = 1; currentDepth <= depth; currentDepth++) {
            Set<String> nextLevelEntities = new HashSet<>();

            for (String sourceCanonicalId : currentLevelEntities) {
                // Parse the canonical ID to get entityType and entityId
                String[] parts = parseCanonicalId(sourceCanonicalId);
                String sourceEntityType = parts[0];
                String sourceEntityId = parts[1];

                // Only expand data entities
                if (!ENTITY_TYPE_LOGICAL_DATA_ENTITIES.equals(sourceEntityType) &&
                    !ENTITY_TYPE_PHYSICAL_DATA_ENTITIES.equals(sourceEntityType)) {
                    continue;
                }

                // Build the data entity point ID for this entity
                String dataEntityPointId = buildDataEntityPointId(sourceEntityId, sourceEntityType);

                // Find relationships where this entity is source or target
                for (LogicalDataEntityRelationshipEntity relationship : allRelationships) {
                    String fromPointId = relationship.getFromDataEntityPointId();
                    String toPointId = relationship.getToDataEntityPointId();

                    // Check if this entity is the source (fromDataEntityPointId matches)
                    if (dataEntityPointId.equals(fromPointId)) {
                        String targetCanonicalId = parseDataEntityPointId(toPointId);
                        if (targetCanonicalId != null && !expandedIds.contains(targetCanonicalId)) {
                            expandedIds.add(targetCanonicalId);
                            nextLevelEntities.add(targetCanonicalId);
                            log.trace("Added related entity (outbound) at depth {}: {}", currentDepth, targetCanonicalId);
                        }
                    }

                    // Check if this entity is the target (toDataEntityPointId matches)
                    if (dataEntityPointId.equals(toPointId)) {
                        String sourceRelatedCanonicalId = parseDataEntityPointId(fromPointId);
                        if (sourceRelatedCanonicalId != null && !expandedIds.contains(sourceRelatedCanonicalId)) {
                            expandedIds.add(sourceRelatedCanonicalId);
                            nextLevelEntities.add(sourceRelatedCanonicalId);
                            log.trace("Added related entity (inbound) at depth {}: {}", currentDepth, sourceRelatedCanonicalId);
                        }
                    }
                }
            }

            // Move to the next depth level
            currentLevelEntities = nextLevelEntities;

            // Spec 2026-01-17 Task Group 6.4: Apply truncation limit for depth=2 expansions
            if (depth > 1 && expandedIds.size() > maxDepth2Entities) {
                log.warn("Depth {} expansion exceeded limit: truncating from {} to {} entities",
                    depth, expandedIds.size(), maxDepth2Entities);
                break;
            }
        }

        List<String> result = new ArrayList<>(expandedIds);
        log.trace("entity_with_attributes_and_relationships expanded to {} entities for {}::{} at depth {}",
            result.size(), entityType, entityId, depth);

        return result;
    }

    /**
     * Builds a data entity point ID from an entity ID and type.
     *
     * This is the inverse of parseDataEntityPointId():
     * - "logicalDataEntities" + entityId -> "dep_log_<entityId>"
     * - "physicalDataEntities" + entityId -> "dep_phy_<entityId>"
     *
     * @param entityId the entity ID
     * @param entityType the entity type
     * @return the data entity point ID format
     */
    private String buildDataEntityPointId(String entityId, String entityType) {
        if (ENTITY_TYPE_LOGICAL_DATA_ENTITIES.equals(entityType)) {
            return DEP_LOGICAL_PREFIX + entityId;
        }
        if (ENTITY_TYPE_PHYSICAL_DATA_ENTITIES.equals(entityType)) {
            return DEP_PHYSICAL_PREFIX + entityId;
        }
        // Fallback (shouldn't happen for valid data entity types)
        log.warn("Unknown entity type for building data entity point ID: {}", entityType);
        return DEP_LOGICAL_PREFIX + entityId;
    }

    // ============================================================================
    // Diagram Bundle Expansion (Task Group 7)
    // ============================================================================

    /**
     * Expands a single diagram selection based on its bundle_type.
     *
     * Task Group 7.2: Main dispatch method for diagram expansion.
     *
     * Currently supported bundle types:
     * - diagram_only: Returns only the diagram ID (does NOT auto-expand node references)
     *
     * Per the spec: "Do not auto-expand beyond the diagram's direct node references"
     * The DiagramNodeRepository.findByDiagramId() method is available for optional
     * node reference lookup, but diagram_only does NOT add those entities to the
     * expanded entity list.
     *
     * @param selection the diagram bundle selection
     * @param modelFileId the model file ID for scoping queries
     * @return list of expanded diagram IDs
     */
    private List<String> expandDiagram(DiagramBundleSelection selection, String modelFileId) {
        if (selection == null || selection.diagramId() == null) {
            return List.of();
        }

        String diagramId = selection.diagramId();
        String bundleType = selection.bundleType();

        log.trace("Expanding diagram: {} with bundleType: {}", diagramId, bundleType);

        // Dispatch based on bundle type
        // Currently only diagram_only is supported
        // Unknown or null bundle types default to diagram_only behavior
        return expandDiagramOnly(diagramId, modelFileId);
    }

    /**
     * Expands diagram with bundle_type = diagram_only.
     *
     * Task Group 7.3: Returns only the diagram ID.
     *
     * Per the spec requirements:
     * - "diagram_only: include the diagram entity"
     * - "Optionally resolve referenced entities from DiagramNodeRepository.findByDiagramId()
     *    if they are not already included by other bundle expansions"
     * - "Do not auto-expand beyond the diagram's direct node references"
     *
     * This implementation returns ONLY the diagram ID. The node references are available
     * via DiagramNodeRepository.findByDiagramId() but are NOT automatically expanded.
     * This behavior ensures that diagram expansion does not auto-expand beyond direct nodes.
     *
     * @param diagramId the diagram ID
     * @param modelFileId the model file ID for scoping queries (available for optional node lookup)
     * @return single-element list containing just the diagram ID
     */
    private List<String> expandDiagramOnly(String diagramId, String modelFileId) {
        log.trace("Expanding diagram_only for: {}", diagramId);

        // Per spec: "diagram_only: include the diagram entity"
        // Return only the diagram ID - do NOT auto-expand node references to entity IDs

        // Note: DiagramNodeRepository.findByDiagramId(diagramId) is available for optional
        // node reference lookup, but per spec we do NOT auto-expand beyond direct diagram
        // node references. The nodes referenced by the diagram can be looked up separately
        // if needed, but they are not automatically included in the expanded entity list.

        return List.of(diagramId);
    }

    // ============================================================================
    // Utility Methods
    // ============================================================================

    /**
     * Formats an entity type and ID into canonical format.
     *
     * @param entityType the entity type
     * @param entityId the entity ID
     * @return canonical format string: entityType::entityId
     */
    private String formatCanonicalId(String entityType, String entityId) {
        return entityType + "::" + entityId;
    }

    /**
     * Sorts canonical entity IDs deterministically by entityType (alphabetically) then entityId.
     *
     * This ensures consistent ordering of output regardless of input order,
     * which is important for reproducibility and testing.
     *
     * @param canonicalIds set of canonical IDs to sort
     * @return sorted list of canonical IDs
     */
    private List<String> sortCanonicalIds(Set<String> canonicalIds) {
        return canonicalIds.stream()
            .sorted((a, b) -> {
                // Parse both IDs
                String[] partsA = parseCanonicalId(a);
                String[] partsB = parseCanonicalId(b);

                // Compare by entityType first
                int typeCompare = partsA[0].compareTo(partsB[0]);
                if (typeCompare != 0) {
                    return typeCompare;
                }

                // Then compare by entityId
                return partsA[1].compareTo(partsB[1]);
            })
            .collect(Collectors.toList());
    }

    /**
     * Parses a canonical ID into its component parts.
     *
     * @param canonicalId the canonical ID (format: entityType::entityId)
     * @return array of [entityType, entityId]
     */
    private String[] parseCanonicalId(String canonicalId) {
        int delimiterIndex = canonicalId.indexOf("::");
        if (delimiterIndex > 0) {
            return new String[] {
                canonicalId.substring(0, delimiterIndex),
                canonicalId.substring(delimiterIndex + 2)
            };
        }
        // Fallback for malformed IDs
        return new String[] { canonicalId, "" };
    }

    /**
     * Resolves a list of canonical entity IDs into detailed summaries.
     *
     * Delegates to ImplementContextResolutionService for the actual resolution logic.
     *
     * @param canonicalIds list of canonical entity IDs
     * @param modelFileId the model file ID for scoping queries
     * @return list of resolved entity summaries
     */
    private List<ResolvedEntitySummary> resolveEntities(List<String> canonicalIds, String modelFileId) {
        List<ResolvedEntitySummary> resolved = new ArrayList<>();
        for (String canonicalId : canonicalIds) {
            ResolvedEntitySummary summary = resolutionService.resolveEntity(canonicalId, modelFileId);
            if (summary != null) {
                resolved.add(summary);
            }
        }
        return resolved;
    }

    /**
     * Resolves a list of diagram IDs into detailed summaries.
     *
     * Delegates to ImplementContextResolutionService for the actual resolution logic.
     *
     * @param diagramIds list of diagram IDs
     * @param modelFileId the model file ID for scoping queries
     * @return list of resolved diagram summaries
     */
    private List<ResolvedDiagramSummary> resolveDiagrams(List<String> diagramIds, String modelFileId) {
        List<ResolvedDiagramSummary> resolved = new ArrayList<>();
        for (String diagramId : diagramIds) {
            ResolvedDiagramSummary summary = resolutionService.resolveDiagram(diagramId, modelFileId);
            if (summary != null) {
                resolved.add(summary);
            }
        }
        return resolved;
    }

    /**
     * Returns the configured maximum number of expanded entities.
     * Used for testing and configuration verification.
     */
    public int getMaxExpandedEntities() {
        return maxExpandedEntities;
    }

    /**
     * Returns the configured maximum number of expanded diagrams.
     * Used for testing and configuration verification.
     */
    public int getMaxExpandedDiagrams() {
        return maxExpandedDiagrams;
    }

    /**
     * Returns the configured maximum number of relationships.
     * Used for testing and configuration verification.
     */
    public int getMaxRelationships() {
        return maxRelationships;
    }

    /**
     * Returns the configured maximum number of entities for depth=2 expansion.
     * Used for testing and configuration verification.
     *
     * Spec 2026-01-17: Fix Context Bundle + Depth Wiring End-to-End - Task Group 6
     */
    public int getMaxDepth2Entities() {
        return maxDepth2Entities;
    }
}
