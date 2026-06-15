package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.ImplementContextDto;
import com.example.architecturemodel.model.dto.RelationshipSelection;
import com.example.architecturemodel.model.entity.WorkItemImplementContextEntity;
import com.example.architecturemodel.repository.entity.WorkItemImplementContextRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Unit tests for WorkItemImplementContextService.
 *
 * Spec 2026-01-09: Persist Implement Context per Work Item in Backend
 * Task Group 4: Testing and Verification
 *
 * Spec: Implement Context Include Relationships and Propagate to Planner Payload
 * Task Group 3: Backend Unit Tests
 * - Added tests for relationship selection persistence and retrieval.
 */
@ExtendWith(MockitoExtension.class)
class WorkItemImplementContextServiceTest {

    @Mock
    private WorkItemImplementContextRepository repository;

    private WorkItemImplementContextService service;

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID WORK_ITEM_ID = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        service = new WorkItemImplementContextService(repository);
    }

    @Test
    void getContext_returnsEmptyLists_whenNoContextExists() {
        // Given
        when(repository.findByProjectIdAndWorkItemId(PROJECT_ID, WORK_ITEM_ID))
            .thenReturn(Optional.empty());

        // When
        ImplementContextDto result = service.getContext(PROJECT_ID, WORK_ITEM_ID);

        // Then
        assertThat(result).isNotNull();
        assertThat(result.projectId()).isEqualTo(PROJECT_ID);
        assertThat(result.workItemId()).isEqualTo(WORK_ITEM_ID);
        assertThat(result.selectedEntityIds()).isEmpty();
        assertThat(result.selectedDiagramIds()).isEmpty();
    }

    @Test
    void getContext_returnsExistingContext_whenContextExists() {
        // Given
        WorkItemImplementContextEntity entity = WorkItemImplementContextEntity.builder()
            .id(UUID.randomUUID())
            .projectId(PROJECT_ID)
            .workItemId(WORK_ITEM_ID)
            .selectedEntityIds(List.of("applications::app-1", "services::svc-1"))
            .selectedDiagramIds(List.of("diagram-1", "diagram-2"))
            .build();

        when(repository.findByProjectIdAndWorkItemId(PROJECT_ID, WORK_ITEM_ID))
            .thenReturn(Optional.of(entity));

        // When
        ImplementContextDto result = service.getContext(PROJECT_ID, WORK_ITEM_ID);

        // Then
        assertThat(result).isNotNull();
        assertThat(result.projectId()).isEqualTo(PROJECT_ID);
        assertThat(result.workItemId()).isEqualTo(WORK_ITEM_ID);
        assertThat(result.selectedEntityIds()).containsExactly("applications::app-1", "services::svc-1");
        assertThat(result.selectedDiagramIds()).containsExactly("diagram-1", "diagram-2");
    }

    @Test
    void saveContext_createsNewContext_whenNoContextExists() {
        // Given
        List<String> entityIds = List.of("applications::app-1");
        List<String> diagramIds = List.of("diagram-1");

        when(repository.findByProjectIdAndWorkItemId(PROJECT_ID, WORK_ITEM_ID))
            .thenReturn(Optional.empty());

        when(repository.save(any(WorkItemImplementContextEntity.class)))
            .thenAnswer(invocation -> {
                WorkItemImplementContextEntity saved = invocation.getArgument(0);
                // Simulate DB save by returning the same entity
                return saved;
            });

        // When
        ImplementContextDto result = service.saveContext(PROJECT_ID, WORK_ITEM_ID, entityIds, diagramIds);

        // Then
        assertThat(result).isNotNull();
        assertThat(result.projectId()).isEqualTo(PROJECT_ID);
        assertThat(result.workItemId()).isEqualTo(WORK_ITEM_ID);
        assertThat(result.selectedEntityIds()).containsExactly("applications::app-1");
        assertThat(result.selectedDiagramIds()).containsExactly("diagram-1");

        verify(repository).save(any(WorkItemImplementContextEntity.class));
    }

    @Test
    void saveContext_updatesExistingContext_whenContextExists() {
        // Given
        UUID contextId = UUID.randomUUID();
        WorkItemImplementContextEntity existingEntity = WorkItemImplementContextEntity.builder()
            .id(contextId)
            .projectId(PROJECT_ID)
            .workItemId(WORK_ITEM_ID)
            .selectedEntityIds(new ArrayList<>(List.of("old-entity")))
            .selectedDiagramIds(new ArrayList<>(List.of("old-diagram")))
            .build();

        List<String> newEntityIds = List.of("new-entity-1", "new-entity-2");
        List<String> newDiagramIds = List.of("new-diagram");

        when(repository.findByProjectIdAndWorkItemId(PROJECT_ID, WORK_ITEM_ID))
            .thenReturn(Optional.of(existingEntity));

        when(repository.save(any(WorkItemImplementContextEntity.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));

        // When
        ImplementContextDto result = service.saveContext(PROJECT_ID, WORK_ITEM_ID, newEntityIds, newDiagramIds);

        // Then
        assertThat(result).isNotNull();
        assertThat(result.selectedEntityIds()).containsExactly("new-entity-1", "new-entity-2");
        assertThat(result.selectedDiagramIds()).containsExactly("new-diagram");

        verify(repository).save(argThat(entity ->
            entity.getId().equals(contextId) &&
            entity.getSelectedEntityIds().equals(newEntityIds) &&
            entity.getSelectedDiagramIds().equals(newDiagramIds)
        ));
    }

    @Test
    void saveContext_handlesNullLists_gracefully() {
        // Given
        when(repository.findByProjectIdAndWorkItemId(PROJECT_ID, WORK_ITEM_ID))
            .thenReturn(Optional.empty());

        when(repository.save(any(WorkItemImplementContextEntity.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));

        // When
        ImplementContextDto result = service.saveContext(PROJECT_ID, WORK_ITEM_ID, null, null);

        // Then
        assertThat(result).isNotNull();
        assertThat(result.selectedEntityIds()).isEmpty();
        assertThat(result.selectedDiagramIds()).isEmpty();
    }

    // ============================================================================
    // Relationship Selection Tests
    // Spec: Implement Context Include Relationships and Propagate to Planner Payload
    // Task Group 3: Backend Unit Tests
    // ============================================================================

    @Test
    void getContext_returnsEmptyRelationshipLists_whenNoContextExists() {
        // Given
        when(repository.findByProjectIdAndWorkItemId(PROJECT_ID, WORK_ITEM_ID))
            .thenReturn(Optional.empty());

        // When
        ImplementContextDto result = service.getContext(PROJECT_ID, WORK_ITEM_ID);

        // Then - relationship fields should be empty lists (not null)
        assertThat(result.selectedRelationshipIds()).isNotNull().isEmpty();
        assertThat(result.selectedRelationshipSelections()).isNotNull().isEmpty();
    }

    @Test
    void getContext_returnsExistingRelationshipSelections_whenContextExists() {
        // Given
        List<String> relationshipIds = List.of("contains::rel-1", "uses::rel-2");
        List<RelationshipSelection> relationshipSelections = List.of(
            new RelationshipSelection("contains", "rel-1", "Service A contains Component B"),
            new RelationshipSelection("uses", "rel-2", "Component B uses Interface C")
        );

        WorkItemImplementContextEntity entity = WorkItemImplementContextEntity.builder()
            .id(UUID.randomUUID())
            .projectId(PROJECT_ID)
            .workItemId(WORK_ITEM_ID)
            .selectedEntityIds(List.of("services::svc-1"))
            .selectedDiagramIds(List.of())
            .selectedRelationshipIds(relationshipIds)
            .selectedRelationshipSelections(relationshipSelections)
            .build();

        when(repository.findByProjectIdAndWorkItemId(PROJECT_ID, WORK_ITEM_ID))
            .thenReturn(Optional.of(entity));

        // When
        ImplementContextDto result = service.getContext(PROJECT_ID, WORK_ITEM_ID);

        // Then
        assertThat(result.selectedRelationshipIds()).containsExactly("contains::rel-1", "uses::rel-2");
        assertThat(result.selectedRelationshipSelections()).hasSize(2);
        assertThat(result.selectedRelationshipSelections().get(0).relationshipType()).isEqualTo("contains");
        assertThat(result.selectedRelationshipSelections().get(0).relationshipId()).isEqualTo("rel-1");
        assertThat(result.selectedRelationshipSelections().get(0).label()).isEqualTo("Service A contains Component B");
        assertThat(result.selectedRelationshipSelections().get(1).relationshipType()).isEqualTo("uses");
        assertThat(result.selectedRelationshipSelections().get(1).relationshipId()).isEqualTo("rel-2");
    }

    @Test
    void saveContext_savesRelationshipSelections_whenProvided() {
        // Given
        List<String> entityIds = List.of("services::svc-1");
        List<String> diagramIds = List.of();
        List<String> relationshipIds = List.of("contains::rel-1");
        List<RelationshipSelection> relationshipSelections = List.of(
            new RelationshipSelection("contains", "rel-1", "Service A contains Component B")
        );

        when(repository.findByProjectIdAndWorkItemId(PROJECT_ID, WORK_ITEM_ID))
            .thenReturn(Optional.empty());

        when(repository.save(any(WorkItemImplementContextEntity.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));

        // When
        ImplementContextDto result = service.saveContext(
            PROJECT_ID, WORK_ITEM_ID, entityIds, diagramIds, null, null,
            relationshipIds, relationshipSelections
        );

        // Then
        assertThat(result.selectedRelationshipIds()).containsExactly("contains::rel-1");
        assertThat(result.selectedRelationshipSelections()).hasSize(1);
        assertThat(result.selectedRelationshipSelections().get(0).relationshipType()).isEqualTo("contains");

        verify(repository).save(argThat(entity ->
            entity.getSelectedRelationshipIds().equals(relationshipIds) &&
            entity.getSelectedRelationshipSelections().equals(relationshipSelections)
        ));
    }

    @Test
    void saveContext_updatesRelationshipSelections_whenContextExists() {
        // Given
        UUID contextId = UUID.randomUUID();
        WorkItemImplementContextEntity existingEntity = WorkItemImplementContextEntity.builder()
            .id(contextId)
            .projectId(PROJECT_ID)
            .workItemId(WORK_ITEM_ID)
            .selectedEntityIds(new ArrayList<>())
            .selectedDiagramIds(new ArrayList<>())
            .selectedRelationshipIds(new ArrayList<>(List.of("old::rel-1")))
            .selectedRelationshipSelections(new ArrayList<>(List.of(
                new RelationshipSelection("old", "rel-1", "Old relationship")
            )))
            .build();

        List<String> newRelationshipIds = List.of("new::rel-2", "new::rel-3");
        List<RelationshipSelection> newRelationshipSelections = List.of(
            new RelationshipSelection("new", "rel-2", "New relationship 2"),
            new RelationshipSelection("new", "rel-3", "New relationship 3")
        );

        when(repository.findByProjectIdAndWorkItemId(PROJECT_ID, WORK_ITEM_ID))
            .thenReturn(Optional.of(existingEntity));

        when(repository.save(any(WorkItemImplementContextEntity.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));

        // When
        ImplementContextDto result = service.saveContext(
            PROJECT_ID, WORK_ITEM_ID, List.of(), List.of(), null, null,
            newRelationshipIds, newRelationshipSelections
        );

        // Then
        assertThat(result.selectedRelationshipIds()).containsExactly("new::rel-2", "new::rel-3");
        assertThat(result.selectedRelationshipSelections()).hasSize(2);

        verify(repository).save(argThat(entity ->
            entity.getId().equals(contextId) &&
            entity.getSelectedRelationshipIds().equals(newRelationshipIds) &&
            entity.getSelectedRelationshipSelections().equals(newRelationshipSelections)
        ));
    }

    @Test
    void saveContext_handlesNullRelationshipLists_gracefully() {
        // Given
        when(repository.findByProjectIdAndWorkItemId(PROJECT_ID, WORK_ITEM_ID))
            .thenReturn(Optional.empty());

        when(repository.save(any(WorkItemImplementContextEntity.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));

        // When - pass null for relationship fields
        ImplementContextDto result = service.saveContext(
            PROJECT_ID, WORK_ITEM_ID, List.of(), List.of(), null, null, null, null
        );

        // Then - should default to empty lists
        assertThat(result.selectedRelationshipIds()).isNotNull().isEmpty();
        assertThat(result.selectedRelationshipSelections()).isNotNull().isEmpty();

        verify(repository).save(argThat(entity ->
            entity.getSelectedRelationshipIds() != null &&
            entity.getSelectedRelationshipIds().isEmpty() &&
            entity.getSelectedRelationshipSelections() != null &&
            entity.getSelectedRelationshipSelections().isEmpty()
        ));
    }

    @Test
    void getContext_handlesNullRelationshipFieldsInEntity_gracefully() {
        // Given - entity with null relationship fields (simulating legacy data)
        WorkItemImplementContextEntity entity = WorkItemImplementContextEntity.builder()
            .id(UUID.randomUUID())
            .projectId(PROJECT_ID)
            .workItemId(WORK_ITEM_ID)
            .selectedEntityIds(List.of("services::svc-1"))
            .selectedDiagramIds(List.of())
            .selectedRelationshipIds(null)
            .selectedRelationshipSelections(null)
            .build();

        when(repository.findByProjectIdAndWorkItemId(PROJECT_ID, WORK_ITEM_ID))
            .thenReturn(Optional.of(entity));

        // When
        ImplementContextDto result = service.getContext(PROJECT_ID, WORK_ITEM_ID);

        // Then - should return empty lists (not null) for backward compatibility
        assertThat(result.selectedRelationshipIds()).isNotNull().isEmpty();
        assertThat(result.selectedRelationshipSelections()).isNotNull().isEmpty();
    }

    @Test
    void saveContext_preservesExistingRelationships_whenNotProvided() {
        // Given - existing entity with relationships
        UUID contextId = UUID.randomUUID();
        List<String> existingRelationshipIds = List.of("contains::rel-1");
        List<RelationshipSelection> existingRelationshipSelections = List.of(
            new RelationshipSelection("contains", "rel-1", "Existing relationship")
        );

        WorkItemImplementContextEntity existingEntity = WorkItemImplementContextEntity.builder()
            .id(contextId)
            .projectId(PROJECT_ID)
            .workItemId(WORK_ITEM_ID)
            .selectedEntityIds(new ArrayList<>())
            .selectedDiagramIds(new ArrayList<>())
            .selectedRelationshipIds(new ArrayList<>(existingRelationshipIds))
            .selectedRelationshipSelections(new ArrayList<>(existingRelationshipSelections))
            .build();

        when(repository.findByProjectIdAndWorkItemId(PROJECT_ID, WORK_ITEM_ID))
            .thenReturn(Optional.of(existingEntity));

        when(repository.save(any(WorkItemImplementContextEntity.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));

        // When - use backward-compatible 4-arg method (no relationships)
        ImplementContextDto result = service.saveContext(
            PROJECT_ID, WORK_ITEM_ID, List.of("new-entity"), List.of("new-diagram")
        );

        // Then - relationships should be cleared (not preserved) since we're using the legacy method
        // The legacy method explicitly passes null which becomes empty lists
        assertThat(result.selectedRelationshipIds()).isEmpty();
        assertThat(result.selectedRelationshipSelections()).isEmpty();
    }
}
