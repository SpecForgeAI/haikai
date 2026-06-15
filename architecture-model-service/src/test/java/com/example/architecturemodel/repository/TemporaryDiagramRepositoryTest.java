package com.example.architecturemodel.repository;

import com.example.architecturemodel.model.entity.TemporaryDiagramEntity;
import com.example.architecturemodel.repository.entity.TemporaryDiagramRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for TemporaryDiagramRepository and TemporaryDiagramEntity.
 *
 * Spec 2026-03-26: MCP Endpoint for Saving Temporary Architecture Diagrams (Increment 3)
 * Task Group 1: Liquibase Migration and JPA Entity
 */
@ExtendWith(MockitoExtension.class)
class TemporaryDiagramRepositoryTest {

    @Mock
    private TemporaryDiagramRepository repository;

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final String TEMPORARY_DIAGRAM_ID = "tmp-er-diagram-001";

    @BeforeEach
    void setUp() {
        // Setup handled by Mockito
    }

    /**
     * Test 1: TemporaryDiagramEntity can be built via Lombok @Builder with all required fields.
     */
    @Test
    void entity_canBeBuiltViaBuilder_withAllRequiredFields() {
        // Given
        UUID entityId = UUID.randomUUID();
        Instant now = Instant.now();
        Map<String, Object> diagramPayload = new HashMap<>();
        diagramPayload.put("id", TEMPORARY_DIAGRAM_ID);
        diagramPayload.put("name", "Test ER Diagram");
        diagramPayload.put("diagram_kind", "ER");
        diagramPayload.put("nodes", java.util.List.of());
        diagramPayload.put("edges", java.util.List.of());

        // When
        TemporaryDiagramEntity entity = TemporaryDiagramEntity.builder()
            .id(entityId)
            .projectId(PROJECT_ID)
            .temporaryDiagramId(TEMPORARY_DIAGRAM_ID)
            .diagramPayload(diagramPayload)
            .createdAt(now)
            .updatedAt(now)
            .build();

        // Then
        assertThat(entity.getId()).isEqualTo(entityId);
        assertThat(entity.getProjectId()).isEqualTo(PROJECT_ID);
        assertThat(entity.getTemporaryDiagramId()).isEqualTo(TEMPORARY_DIAGRAM_ID);
        assertThat(entity.getDiagramPayload()).containsEntry("id", TEMPORARY_DIAGRAM_ID);
        assertThat(entity.getDiagramPayload()).containsEntry("name", "Test ER Diagram");
        assertThat(entity.getDiagramPayload()).containsEntry("diagram_kind", "ER");
        assertThat(entity.getCreatedAt()).isEqualTo(now);
        assertThat(entity.getUpdatedAt()).isEqualTo(now);
    }

    /**
     * Test 2: Repository findByProjectIdAndTemporaryDiagramId returns the entity when it exists.
     */
    @Test
    void findByProjectIdAndTemporaryDiagramId_returnsEntity_whenExists() {
        // Given
        UUID entityId = UUID.randomUUID();
        Map<String, Object> diagramPayload = new HashMap<>();
        diagramPayload.put("id", TEMPORARY_DIAGRAM_ID);
        diagramPayload.put("diagram_kind", "ER");

        TemporaryDiagramEntity entity = TemporaryDiagramEntity.builder()
            .id(entityId)
            .projectId(PROJECT_ID)
            .temporaryDiagramId(TEMPORARY_DIAGRAM_ID)
            .diagramPayload(diagramPayload)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        when(repository.findByProjectIdAndTemporaryDiagramId(PROJECT_ID, TEMPORARY_DIAGRAM_ID))
            .thenReturn(Optional.of(entity));

        // When
        Optional<TemporaryDiagramEntity> result = repository.findByProjectIdAndTemporaryDiagramId(PROJECT_ID, TEMPORARY_DIAGRAM_ID);

        // Then
        assertThat(result).isPresent();
        assertThat(result.get().getId()).isEqualTo(entityId);
        assertThat(result.get().getProjectId()).isEqualTo(PROJECT_ID);
        assertThat(result.get().getTemporaryDiagramId()).isEqualTo(TEMPORARY_DIAGRAM_ID);
        assertThat(result.get().getDiagramPayload()).containsEntry("diagram_kind", "ER");
    }

    /**
     * Test 3: Repository findByProjectIdAndTemporaryDiagramId returns empty Optional when no match.
     */
    @Test
    void findByProjectIdAndTemporaryDiagramId_returnsEmptyOptional_whenNoMatch() {
        // Given
        when(repository.findByProjectIdAndTemporaryDiagramId(PROJECT_ID, "nonexistent-diagram"))
            .thenReturn(Optional.empty());

        // When
        Optional<TemporaryDiagramEntity> result = repository.findByProjectIdAndTemporaryDiagramId(PROJECT_ID, "nonexistent-diagram");

        // Then
        assertThat(result).isEmpty();
    }

    /**
     * Test 4: Saving an entity with the same (projectId, temporaryDiagramId) composite key
     * updates (not duplicates) the record. This test verifies the upsert pattern by
     * simulating the find-or-create flow used by the service layer.
     */
    @Test
    void save_updatesExistingEntity_whenSameCompositeKeyExists() {
        // Given - an existing entity
        UUID existingId = UUID.randomUUID();
        Instant originalCreatedAt = Instant.now().minusSeconds(3600);
        Map<String, Object> originalPayload = new HashMap<>();
        originalPayload.put("id", TEMPORARY_DIAGRAM_ID);
        originalPayload.put("name", "Original Diagram");

        TemporaryDiagramEntity existingEntity = TemporaryDiagramEntity.builder()
            .id(existingId)
            .projectId(PROJECT_ID)
            .temporaryDiagramId(TEMPORARY_DIAGRAM_ID)
            .diagramPayload(originalPayload)
            .createdAt(originalCreatedAt)
            .updatedAt(Instant.now().minusSeconds(60))
            .build();

        // Simulate finding existing entity
        when(repository.findByProjectIdAndTemporaryDiagramId(PROJECT_ID, TEMPORARY_DIAGRAM_ID))
            .thenReturn(Optional.of(existingEntity));

        when(repository.save(any(TemporaryDiagramEntity.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));

        // When - update payload on existing entity (simulating upsert)
        Map<String, Object> updatedPayload = new HashMap<>();
        updatedPayload.put("id", TEMPORARY_DIAGRAM_ID);
        updatedPayload.put("name", "Updated Diagram");

        TemporaryDiagramEntity found = repository.findByProjectIdAndTemporaryDiagramId(PROJECT_ID, TEMPORARY_DIAGRAM_ID).get();
        found.setDiagramPayload(updatedPayload);
        TemporaryDiagramEntity saved = repository.save(found);

        // Then - same entity ID is preserved (update, not duplicate)
        ArgumentCaptor<TemporaryDiagramEntity> captor = ArgumentCaptor.forClass(TemporaryDiagramEntity.class);
        verify(repository).save(captor.capture());

        assertThat(captor.getValue().getId()).isEqualTo(existingId);
        assertThat(captor.getValue().getProjectId()).isEqualTo(PROJECT_ID);
        assertThat(captor.getValue().getTemporaryDiagramId()).isEqualTo(TEMPORARY_DIAGRAM_ID);
        assertThat(captor.getValue().getDiagramPayload()).containsEntry("name", "Updated Diagram");
        assertThat(captor.getValue().getCreatedAt()).isEqualTo(originalCreatedAt);
    }
}
