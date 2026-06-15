package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.EntityBundleSelection;
import com.example.architecturemodel.model.dto.ExpandResolveResponseDto;
import com.example.architecturemodel.model.entity.LogicalDataEntityRelationshipEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.model.entity.PhysicalDataAttributeEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.diagram.DiagramNodeRepository;
import com.example.architecturemodel.repository.diagram.DiagramRepository;
import com.example.architecturemodel.repository.entity.EndpointRepository;
import com.example.architecturemodel.repository.entity.InterfaceRepository;
import com.example.architecturemodel.repository.entity.PhysicalDataAttributeRepository;
import com.example.architecturemodel.repository.entity.ServiceRepository;
import com.example.architecturemodel.repository.relationship.InterfaceLogicalEntityRepository;
import com.example.architecturemodel.repository.relationship.LogicalDataEntityRelationshipRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * Unit tests for ContextBundleExpansionService data entity expansion functionality.
 *
 * Tests data entity bundle expansion rules including:
 * - entity_only: returns only the data entity (logical or physical)
 * - entity_with_attributes_and_relationships: includes attributes for physical entities
 * - entity_with_attributes_and_relationships: includes depth=1 relationships only
 *
 * Spec: Context Bundles Backend Expansion - Task Group 6
 */
@ExtendWith(MockitoExtension.class)
class ContextBundleExpansionServiceDataEntityTest {

    @Mock private ModelFileRepository modelFileRepository;
    @Mock private ImplementContextResolutionService resolutionService;
    @Mock private EndpointRepository endpointRepository;
    @Mock private InterfaceRepository interfaceRepository;
    @Mock private PhysicalDataAttributeRepository physicalDataAttributeRepository;
    @Mock private LogicalDataEntityRelationshipRepository logicalDataEntityRelationshipRepository;
    @Mock private DiagramNodeRepository diagramNodeRepository;
    @Mock private DiagramRepository diagramRepository;
    @Mock private ServiceRepository serviceRepository;
    @Mock private InterfaceLogicalEntityRepository interfaceLogicalEntityRepository;

    private ContextBundleExpansionService service;

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final String MODEL_FILE_ID = "model-file-123";
    private static final String LOGICAL_ENTITY_ID = "logical-entity-001";
    private static final String PHYSICAL_ENTITY_ID = "physical-entity-001";

    @BeforeEach
    void setUp() {
        service = new ContextBundleExpansionService(
            modelFileRepository,
            resolutionService,
            endpointRepository,
            interfaceRepository,
            physicalDataAttributeRepository,
            logicalDataEntityRelationshipRepository,
            diagramNodeRepository,
            diagramRepository,
            serviceRepository,
            interfaceLogicalEntityRepository
        );
        // Set default configuration values via reflection
        ReflectionTestUtils.setField(service, "maxExpandedEntities", 250);
        ReflectionTestUtils.setField(service, "maxExpandedDiagrams", 50);
        ReflectionTestUtils.setField(service, "maxRelationships", 500);
    }

    private void setupModelFileRepository() {
        ModelFileEntity modelFile = new ModelFileEntity();
        modelFile.setId(MODEL_FILE_ID);
        modelFile.setProjectId(PROJECT_ID);
        when(modelFileRepository.findByProjectId(PROJECT_ID)).thenReturn(Optional.of(modelFile));
    }

    // ============================================================================
    // Test: entity_only returns only the data entity
    // ============================================================================

    @Nested
    @DisplayName("entity_only expansion")
    class EntityOnlyExpansionTests {

        @Test
        @DisplayName("entity_only returns only the logical data entity in canonical format")
        void entityOnly_logicalEntity_returnsOnlyEntity() {
            // Arrange
            setupModelFileRepository();
            List<EntityBundleSelection> selections = List.of(
                new EntityBundleSelection("logicalDataEntities", LOGICAL_ENTITY_ID, "entity_only", null)
            );

            // Act
            ExpandResolveResponseDto result = service.expandAndResolve(PROJECT_ID, selections, List.of());

            // Assert
            assertNotNull(result);
            assertEquals(1, result.expandedEntityIds().size(), "entity_only should return only the entity");
            assertEquals("logicalDataEntities::" + LOGICAL_ENTITY_ID, result.expandedEntityIds().get(0));
            assertFalse(result.truncated());
        }

        @Test
        @DisplayName("entity_only returns only the physical data entity in canonical format")
        void entityOnly_physicalEntity_returnsOnlyEntity() {
            // Arrange
            setupModelFileRepository();
            List<EntityBundleSelection> selections = List.of(
                new EntityBundleSelection("physicalDataEntities", PHYSICAL_ENTITY_ID, "entity_only", null)
            );

            // Act
            ExpandResolveResponseDto result = service.expandAndResolve(PROJECT_ID, selections, List.of());

            // Assert
            assertNotNull(result);
            assertEquals(1, result.expandedEntityIds().size(), "entity_only should return only the entity");
            assertEquals("physicalDataEntities::" + PHYSICAL_ENTITY_ID, result.expandedEntityIds().get(0));
            assertFalse(result.truncated());
        }

        @Test
        @DisplayName("entity_only does not query attribute repositories")
        void entityOnly_doesNotQueryRelatedRepositories() {
            // Arrange
            setupModelFileRepository();
            List<EntityBundleSelection> selections = List.of(
                new EntityBundleSelection("physicalDataEntities", PHYSICAL_ENTITY_ID, "entity_only", null)
            );

            // Act
            service.expandAndResolve(PROJECT_ID, selections, List.of());

            // Assert - should NOT query attribute repositories for entity_only.
            // NOTE: the relationship repository IS now queried unconditionally —
            // Spec "Implement Context Include Relationships and Propagate to
            // Planner Payload" made expandAndResolve always collect data-entity
            // relationships across the expanded set, regardless of bundle_type.
            verify(physicalDataAttributeRepository, never()).findByPhysicalEntityId(anyString());
        }
    }

    // ============================================================================
    // Test: entity_with_attributes_and_relationships includes attributes for physical entities
    // ============================================================================

    @Nested
    @DisplayName("entity_with_attributes_and_relationships - attributes expansion")
    class EntityWithAttributesExpansionTests {

        @Test
        @DisplayName("entity_with_attributes_and_relationships includes attributes for physical entities")
        void entityWithAttributesAndRelationships_physicalEntity_includesAttributes() {
            // Arrange
            setupModelFileRepository();

            // Create mock attributes for the physical entity
            PhysicalDataAttributeEntity attr1 = PhysicalDataAttributeEntity.builder()
                .id("attr-001")
                .modelFileId(MODEL_FILE_ID)
                .physicalEntityId(PHYSICAL_ENTITY_ID)
                .name("user_id")
                .dataType("VARCHAR(36)")
                .isPrimaryKey(true)
                .isNullable(false)
                .build();

            PhysicalDataAttributeEntity attr2 = PhysicalDataAttributeEntity.builder()
                .id("attr-002")
                .modelFileId(MODEL_FILE_ID)
                .physicalEntityId(PHYSICAL_ENTITY_ID)
                .name("email")
                .dataType("VARCHAR(255)")
                .isPrimaryKey(false)
                .isNullable(false)
                .build();

            when(physicalDataAttributeRepository.findByPhysicalEntityId(PHYSICAL_ENTITY_ID))
                .thenReturn(List.of(attr1, attr2));
            when(logicalDataEntityRelationshipRepository.findByModelFileId(MODEL_FILE_ID))
                .thenReturn(List.of());

            List<EntityBundleSelection> selections = List.of(
                new EntityBundleSelection("physicalDataEntities", PHYSICAL_ENTITY_ID, "entity_with_attributes_and_relationships", null)
            );

            // Act
            ExpandResolveResponseDto result = service.expandAndResolve(PROJECT_ID, selections, List.of());

            // Assert
            assertNotNull(result);
            // Should include: 1 physical entity + 2 attributes = 3 entities
            assertEquals(3, result.expandedEntityIds().size(), "Should include entity plus attributes");
            assertTrue(result.expandedEntityIds().contains("physicalDataEntities::" + PHYSICAL_ENTITY_ID),
                "Should include the physical entity itself");
            assertTrue(result.expandedEntityIds().contains("physicalDataAttributes::attr-001"),
                "Should include first attribute");
            assertTrue(result.expandedEntityIds().contains("physicalDataAttributes::attr-002"),
                "Should include second attribute");
            assertFalse(result.truncated());
        }

        @Test
        @DisplayName("entity_with_attributes_and_relationships for logical entity does not include attributes")
        void entityWithAttributesAndRelationships_logicalEntity_noAttributes() {
            // Arrange
            setupModelFileRepository();

            // Logical entities don't have attributes, so attribute repo should not be queried
            when(logicalDataEntityRelationshipRepository.findByModelFileId(MODEL_FILE_ID))
                .thenReturn(List.of());

            List<EntityBundleSelection> selections = List.of(
                new EntityBundleSelection("logicalDataEntities", LOGICAL_ENTITY_ID, "entity_with_attributes_and_relationships", null)
            );

            // Act
            ExpandResolveResponseDto result = service.expandAndResolve(PROJECT_ID, selections, List.of());

            // Assert
            assertNotNull(result);
            // Logical entities don't have attributes, should only include the entity itself
            assertEquals(1, result.expandedEntityIds().size(), "Logical entity should not expand attributes");
            assertTrue(result.expandedEntityIds().contains("logicalDataEntities::" + LOGICAL_ENTITY_ID));

            // Attribute repository should NOT be queried for logical entities
            verify(physicalDataAttributeRepository, never()).findByPhysicalEntityId(anyString());
        }
    }

    // ============================================================================
    // Test: entity_with_attributes_and_relationships includes depth=1 relationships only
    // ============================================================================

    @Nested
    @DisplayName("entity_with_attributes_and_relationships - relationships expansion")
    class EntityWithRelationshipsExpansionTests {

        @Test
        @DisplayName("entity_with_attributes_and_relationships includes depth=1 relationships for logical entity")
        void entityWithAttributesAndRelationships_logicalEntity_includesDepth1Relationships() {
            // Arrange
            setupModelFileRepository();

            // Create mock relationships where logical entity is source
            LogicalDataEntityRelationshipEntity rel1 = LogicalDataEntityRelationshipEntity.builder()
                .id("rel-001")
                .modelFileId(MODEL_FILE_ID)
                .fromDataEntityPointId("dep_log_" + LOGICAL_ENTITY_ID)
                .toDataEntityPointId("dep_log_related-entity-001")
                .cardinality("ONE_TO_MANY")
                .relationship("ASSOCIATION")
                .build();

            // Create mock relationship where logical entity is target
            LogicalDataEntityRelationshipEntity rel2 = LogicalDataEntityRelationshipEntity.builder()
                .id("rel-002")
                .modelFileId(MODEL_FILE_ID)
                .fromDataEntityPointId("dep_log_other-entity-002")
                .toDataEntityPointId("dep_log_" + LOGICAL_ENTITY_ID)
                .cardinality("MANY_TO_ONE")
                .relationship("AGGREGATION")
                .build();

            // Create mock relationship that doesn't involve our entity (should be excluded)
            LogicalDataEntityRelationshipEntity relUnrelated = LogicalDataEntityRelationshipEntity.builder()
                .id("rel-003")
                .modelFileId(MODEL_FILE_ID)
                .fromDataEntityPointId("dep_log_unrelated-a")
                .toDataEntityPointId("dep_log_unrelated-b")
                .cardinality("ONE_TO_ONE")
                .relationship("ASSOCIATION")
                .build();

            when(logicalDataEntityRelationshipRepository.findByModelFileId(MODEL_FILE_ID))
                .thenReturn(List.of(rel1, rel2, relUnrelated));

            List<EntityBundleSelection> selections = List.of(
                new EntityBundleSelection("logicalDataEntities", LOGICAL_ENTITY_ID, "entity_with_attributes_and_relationships", null)
            );

            // Act
            ExpandResolveResponseDto result = service.expandAndResolve(PROJECT_ID, selections, List.of());

            // Assert
            assertNotNull(result);
            // Should include: 1 entity + 2 related entities = 3 entities
            // (unrelated entities should be excluded)
            assertEquals(3, result.expandedEntityIds().size(), "Should include entity plus depth=1 related entities");
            assertTrue(result.expandedEntityIds().contains("logicalDataEntities::" + LOGICAL_ENTITY_ID),
                "Should include the entity itself");
            assertTrue(result.expandedEntityIds().contains("logicalDataEntities::related-entity-001"),
                "Should include related entity from outbound relationship");
            assertTrue(result.expandedEntityIds().contains("logicalDataEntities::other-entity-002"),
                "Should include related entity from inbound relationship");
            assertFalse(result.expandedEntityIds().contains("logicalDataEntities::unrelated-a"),
                "Should NOT include unrelated entities");
            assertFalse(result.expandedEntityIds().contains("logicalDataEntities::unrelated-b"),
                "Should NOT include unrelated entities");
            assertFalse(result.truncated());
        }

        @Test
        @DisplayName("entity_with_attributes_and_relationships handles mixed logical/physical relationships")
        void entityWithAttributesAndRelationships_mixedRelationships() {
            // Arrange
            setupModelFileRepository();

            // Relationship to physical entity
            LogicalDataEntityRelationshipEntity rel1 = LogicalDataEntityRelationshipEntity.builder()
                .id("rel-001")
                .modelFileId(MODEL_FILE_ID)
                .fromDataEntityPointId("dep_log_" + LOGICAL_ENTITY_ID)
                .toDataEntityPointId("dep_phy_physical-table-001")
                .cardinality("ONE_TO_ONE")
                .relationship("REALIZATION")
                .build();

            when(logicalDataEntityRelationshipRepository.findByModelFileId(MODEL_FILE_ID))
                .thenReturn(List.of(rel1));

            List<EntityBundleSelection> selections = List.of(
                new EntityBundleSelection("logicalDataEntities", LOGICAL_ENTITY_ID, "entity_with_attributes_and_relationships", null)
            );

            // Act
            ExpandResolveResponseDto result = service.expandAndResolve(PROJECT_ID, selections, List.of());

            // Assert
            assertNotNull(result);
            assertEquals(2, result.expandedEntityIds().size(), "Should include entity plus physical entity relation");
            assertTrue(result.expandedEntityIds().contains("logicalDataEntities::" + LOGICAL_ENTITY_ID));
            assertTrue(result.expandedEntityIds().contains("physicalDataEntities::physical-table-001"),
                "Should correctly parse dep_phy_ prefix for related physical entity");
        }

        @Test
        @DisplayName("entity_with_attributes_and_relationships does NOT traverse multi-hop relationships")
        void entityWithAttributesAndRelationships_noMultiHopTraversal() {
            // Arrange
            setupModelFileRepository();

            // Direct relationship: entity -> related-entity-001
            LogicalDataEntityRelationshipEntity directRel = LogicalDataEntityRelationshipEntity.builder()
                .id("rel-001")
                .modelFileId(MODEL_FILE_ID)
                .fromDataEntityPointId("dep_log_" + LOGICAL_ENTITY_ID)
                .toDataEntityPointId("dep_log_related-entity-001")
                .cardinality("ONE_TO_MANY")
                .relationship("ASSOCIATION")
                .build();

            // Second-hop relationship: related-entity-001 -> hop2-entity
            // This should NOT be included (depth > 1)
            LogicalDataEntityRelationshipEntity secondHopRel = LogicalDataEntityRelationshipEntity.builder()
                .id("rel-002")
                .modelFileId(MODEL_FILE_ID)
                .fromDataEntityPointId("dep_log_related-entity-001")
                .toDataEntityPointId("dep_log_hop2-entity")
                .cardinality("ONE_TO_ONE")
                .relationship("ASSOCIATION")
                .build();

            when(logicalDataEntityRelationshipRepository.findByModelFileId(MODEL_FILE_ID))
                .thenReturn(List.of(directRel, secondHopRel));

            List<EntityBundleSelection> selections = List.of(
                new EntityBundleSelection("logicalDataEntities", LOGICAL_ENTITY_ID, "entity_with_attributes_and_relationships", null)
            );

            // Act
            ExpandResolveResponseDto result = service.expandAndResolve(PROJECT_ID, selections, List.of());

            // Assert
            assertNotNull(result);
            // Should include: 1 entity + 1 depth-1 related entity = 2 entities
            // hop2-entity should NOT be included (it's depth=2)
            assertEquals(2, result.expandedEntityIds().size(), "Should stop at depth=1, not traverse multi-hop");
            assertTrue(result.expandedEntityIds().contains("logicalDataEntities::" + LOGICAL_ENTITY_ID),
                "Should include the entity itself");
            assertTrue(result.expandedEntityIds().contains("logicalDataEntities::related-entity-001"),
                "Should include depth=1 related entity");
            assertFalse(result.expandedEntityIds().contains("logicalDataEntities::hop2-entity"),
                "Should NOT include depth=2 entity (multi-hop)");
            assertFalse(result.truncated());
        }
    }

    // ============================================================================
    // Test: Combined attributes and relationships for physical entity
    // ============================================================================

    @Nested
    @DisplayName("entity_with_attributes_and_relationships - combined expansion")
    class EntityWithCombinedExpansionTests {

        @Test
        @DisplayName("entity_with_attributes_and_relationships for physical entity includes both attributes and relationships")
        void entityWithAttributesAndRelationships_physicalEntity_includesBoth() {
            // Arrange
            setupModelFileRepository();

            // Create mock attributes
            PhysicalDataAttributeEntity attr1 = PhysicalDataAttributeEntity.builder()
                .id("attr-001")
                .modelFileId(MODEL_FILE_ID)
                .physicalEntityId(PHYSICAL_ENTITY_ID)
                .name("id")
                .dataType("UUID")
                .isPrimaryKey(true)
                .isNullable(false)
                .build();

            when(physicalDataAttributeRepository.findByPhysicalEntityId(PHYSICAL_ENTITY_ID))
                .thenReturn(List.of(attr1));

            // Create mock relationship
            LogicalDataEntityRelationshipEntity rel1 = LogicalDataEntityRelationshipEntity.builder()
                .id("rel-001")
                .modelFileId(MODEL_FILE_ID)
                .fromDataEntityPointId("dep_phy_" + PHYSICAL_ENTITY_ID)
                .toDataEntityPointId("dep_phy_related-table-001")
                .cardinality("ONE_TO_MANY")
                .relationship("ASSOCIATION")
                .build();

            when(logicalDataEntityRelationshipRepository.findByModelFileId(MODEL_FILE_ID))
                .thenReturn(List.of(rel1));

            List<EntityBundleSelection> selections = List.of(
                new EntityBundleSelection("physicalDataEntities", PHYSICAL_ENTITY_ID, "entity_with_attributes_and_relationships", null)
            );

            // Act
            ExpandResolveResponseDto result = service.expandAndResolve(PROJECT_ID, selections, List.of());

            // Assert
            assertNotNull(result);
            // Should include: 1 physical entity + 1 attribute + 1 related entity = 3 entities
            assertEquals(3, result.expandedEntityIds().size(), "Should include entity, attributes, and relationships");
            assertTrue(result.expandedEntityIds().contains("physicalDataEntities::" + PHYSICAL_ENTITY_ID),
                "Should include the physical entity itself");
            assertTrue(result.expandedEntityIds().contains("physicalDataAttributes::attr-001"),
                "Should include attribute");
            assertTrue(result.expandedEntityIds().contains("physicalDataEntities::related-table-001"),
                "Should include related entity");
            assertFalse(result.truncated());
        }
    }
}
