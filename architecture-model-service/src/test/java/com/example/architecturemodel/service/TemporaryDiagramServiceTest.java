package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.TemporaryDiagramDto;
import com.example.architecturemodel.model.entity.TemporaryDiagramEntity;
import com.example.architecturemodel.repository.entity.TemporaryDiagramRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Unit tests for TemporaryDiagramService.
 *
 * Spec 2026-03-26: MCP Endpoint for Saving Temporary Architecture Diagrams (Increment 3)
 * Task Group 2: Java Service, DTO, and Controller
 */
@ExtendWith(MockitoExtension.class)
class TemporaryDiagramServiceTest {

    @Mock
    private TemporaryDiagramRepository repository;

    private TemporaryDiagramService service;

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID ARCHITECTURE_ID = UUID.randomUUID();
    private static final String TEMPORARY_DIAGRAM_ID = "tmp-er-diagram-001";

    @BeforeEach
    void setUp() {
        service = new TemporaryDiagramService(repository);
    }

    /**
     * Test 1: saveDiagram creates a new entity when none exists for the given (projectId, temporaryDiagramId).
     */
    @Test
    void saveDiagram_createsNewEntity_whenNoneExists() {
        // Given
        Map<String, Object> diagramPayload = new HashMap<>();
        diagramPayload.put("id", TEMPORARY_DIAGRAM_ID);
        diagramPayload.put("name", "Test ER Diagram");
        diagramPayload.put("diagram_kind", "ER");

        when(repository.findByProjectIdAndArchitectureIdAndTemporaryDiagramId(PROJECT_ID, ARCHITECTURE_ID, TEMPORARY_DIAGRAM_ID))
            .thenReturn(Optional.empty());

        when(repository.save(any(TemporaryDiagramEntity.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));

        // When
        TemporaryDiagramDto result = service.saveDiagram(PROJECT_ID, ARCHITECTURE_ID, TEMPORARY_DIAGRAM_ID, diagramPayload);

        // Then
        assertThat(result).isNotNull();
        assertThat(result.projectId()).isEqualTo(PROJECT_ID);
        assertThat(result.temporaryDiagramId()).isEqualTo(TEMPORARY_DIAGRAM_ID);
        assertThat(result.diagramPayload()).containsEntry("name", "Test ER Diagram");
        assertThat(result.diagramPayload()).containsEntry("diagram_kind", "ER");
        assertThat(result.createdAt()).isNotNull();
        assertThat(result.updatedAt()).isNotNull();

        ArgumentCaptor<TemporaryDiagramEntity> captor = ArgumentCaptor.forClass(TemporaryDiagramEntity.class);
        verify(repository).save(captor.capture());
        assertThat(captor.getValue().getId()).isNotNull();
        assertThat(captor.getValue().getProjectId()).isEqualTo(PROJECT_ID);
        assertThat(captor.getValue().getTemporaryDiagramId()).isEqualTo(TEMPORARY_DIAGRAM_ID);
    }

    /**
     * Test 2: saveDiagram updates the existing entity (upsert) when one already exists for the same composite key.
     */
    @Test
    void saveDiagram_updatesExistingEntity_whenAlreadyExists() {
        // Given
        UUID existingId = UUID.randomUUID();
        Instant originalCreatedAt = Instant.now().minusSeconds(3600);

        TemporaryDiagramEntity existingEntity = TemporaryDiagramEntity.builder()
            .id(existingId)
            .projectId(PROJECT_ID)
            .temporaryDiagramId(TEMPORARY_DIAGRAM_ID)
            .diagramPayload(Map.of("id", TEMPORARY_DIAGRAM_ID, "name", "Original Diagram"))
            .createdAt(originalCreatedAt)
            .updatedAt(Instant.now().minusSeconds(60))
            .build();

        Map<String, Object> updatedPayload = new HashMap<>();
        updatedPayload.put("id", TEMPORARY_DIAGRAM_ID);
        updatedPayload.put("name", "Updated Diagram");
        updatedPayload.put("diagram_kind", "ER");

        when(repository.findByProjectIdAndArchitectureIdAndTemporaryDiagramId(PROJECT_ID, ARCHITECTURE_ID, TEMPORARY_DIAGRAM_ID))
            .thenReturn(Optional.of(existingEntity));

        when(repository.save(any(TemporaryDiagramEntity.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));

        // When
        TemporaryDiagramDto result = service.saveDiagram(PROJECT_ID, ARCHITECTURE_ID, TEMPORARY_DIAGRAM_ID, updatedPayload);

        // Then
        assertThat(result).isNotNull();
        assertThat(result.diagramPayload()).containsEntry("name", "Updated Diagram");

        ArgumentCaptor<TemporaryDiagramEntity> captor = ArgumentCaptor.forClass(TemporaryDiagramEntity.class);
        verify(repository).save(captor.capture());
        // Same entity ID should be preserved (update, not duplicate)
        assertThat(captor.getValue().getId()).isEqualTo(existingId);
        assertThat(captor.getValue().getDiagramPayload()).containsEntry("name", "Updated Diagram");
        assertThat(captor.getValue().getCreatedAt()).isEqualTo(originalCreatedAt);
    }

    /**
     * Test 3: getDiagram returns DTO when entity exists.
     */
    @Test
    void getDiagram_returnsDto_whenEntityExists() {
        // Given
        UUID entityId = UUID.randomUUID();
        Instant now = Instant.now();
        Map<String, Object> diagramPayload = new HashMap<>();
        diagramPayload.put("id", TEMPORARY_DIAGRAM_ID);
        diagramPayload.put("name", "Test Diagram");
        diagramPayload.put("diagram_kind", "ER");

        TemporaryDiagramEntity entity = TemporaryDiagramEntity.builder()
            .id(entityId)
            .projectId(PROJECT_ID)
            .temporaryDiagramId(TEMPORARY_DIAGRAM_ID)
            .diagramPayload(diagramPayload)
            .createdAt(now)
            .updatedAt(now)
            .build();

        when(repository.findByProjectIdAndArchitectureIdAndTemporaryDiagramId(PROJECT_ID, ARCHITECTURE_ID, TEMPORARY_DIAGRAM_ID))
            .thenReturn(Optional.of(entity));

        // When
        TemporaryDiagramDto result = service.getDiagram(PROJECT_ID, ARCHITECTURE_ID, TEMPORARY_DIAGRAM_ID);

        // Then
        assertThat(result).isNotNull();
        assertThat(result.id()).isEqualTo(entityId);
        assertThat(result.projectId()).isEqualTo(PROJECT_ID);
        assertThat(result.temporaryDiagramId()).isEqualTo(TEMPORARY_DIAGRAM_ID);
        assertThat(result.diagramPayload()).containsEntry("name", "Test Diagram");
        assertThat(result.diagramPayload()).containsEntry("diagram_kind", "ER");
        assertThat(result.createdAt()).isEqualTo(now.toString());
        assertThat(result.updatedAt()).isEqualTo(now.toString());
    }

    /**
     * Test 4: getDiagram returns null when no entity exists.
     */
    @Test
    void getDiagram_returnsNull_whenNoEntityExists() {
        // Given
        when(repository.findByProjectIdAndArchitectureIdAndTemporaryDiagramId(PROJECT_ID, ARCHITECTURE_ID, "nonexistent-diagram"))
            .thenReturn(Optional.empty());

        // When
        TemporaryDiagramDto result = service.getDiagram(PROJECT_ID, ARCHITECTURE_ID, "nonexistent-diagram");

        // Then
        assertThat(result).isNull();
    }
}
