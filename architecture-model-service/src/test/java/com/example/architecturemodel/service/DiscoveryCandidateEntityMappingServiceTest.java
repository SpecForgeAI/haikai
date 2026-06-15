package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.DiscoveryCandidateEntityMappingDto;
import com.example.architecturemodel.model.entity.DiscoveryCandidateEntityMappingEntity;
import com.example.architecturemodel.repository.entity.DiscoveryCandidateEntityMappingRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.*;

/**
 * Service-level tests for DiscoveryCandidateEntityMappingService.
 *
 * Spec: Candidate Save-Back to Canonical Model (Increment 11)
 * Task Group 2: JPA Entity, DTO, Repository, Service, and Controller
 *
 * Tests:
 * 1. bulkCreate persists mappings with correct fields and returns DTOs
 * 2. getByRunId returns all mappings for a given run
 */
@ExtendWith(MockitoExtension.class)
class DiscoveryCandidateEntityMappingServiceTest {

    @Mock
    private DiscoveryCandidateEntityMappingRepository mappingRepository;

    @Mock
    private DiscoveryRunArchitectureGuard runGuard;

    private DiscoveryCandidateEntityMappingService service;

    private static final UUID RUN_ID = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        service = new DiscoveryCandidateEntityMappingService(mappingRepository, runGuard);
    }

    /**
     * Test 1: bulkCreate persists mappings with correct fields and returns DTOs.
     */
    @Test
    @DisplayName("Test 1: bulkCreate persists mappings with correct fields and returns DTOs")
    void bulkCreate_persistsMappingsAndReturnsDtos() {
        // Given
        UUID candidateId1 = UUID.randomUUID();
        UUID candidateId2 = UUID.randomUUID();

        DiscoveryCandidateEntityMappingDto dto1 = new DiscoveryCandidateEntityMappingDto(
            null, candidateId1, RUN_ID, "applications", "app-abc123", "created", null
        );

        DiscoveryCandidateEntityMappingDto dto2 = new DiscoveryCandidateEntityMappingDto(
            null, candidateId2, RUN_ID, "services", "svc-def456", "reused", null
        );

        // Mock saveAll to return entities with generated IDs and timestamps
        when(mappingRepository.saveAll(anyList())).thenAnswer(invocation -> {
            @SuppressWarnings("unchecked")
            List<DiscoveryCandidateEntityMappingEntity> entities = invocation.getArgument(0);
            return entities;
        });

        // When
        List<DiscoveryCandidateEntityMappingDto> result = service.bulkCreate(RUN_ID, List.of(dto1, dto2));

        // Then
        assertThat(result).hasSize(2);

        // Verify first mapping
        assertThat(result.get(0).id()).isNotNull();
        assertThat(result.get(0).candidateId()).isEqualTo(candidateId1);
        assertThat(result.get(0).runId()).isEqualTo(RUN_ID);
        assertThat(result.get(0).entityType()).isEqualTo("applications");
        assertThat(result.get(0).entityId()).isEqualTo("app-abc123");
        assertThat(result.get(0).action()).isEqualTo("created");
        assertThat(result.get(0).createdAt()).isNotNull();

        // Verify second mapping
        assertThat(result.get(1).candidateId()).isEqualTo(candidateId2);
        assertThat(result.get(1).entityType()).isEqualTo("services");
        assertThat(result.get(1).entityId()).isEqualTo("svc-def456");
        assertThat(result.get(1).action()).isEqualTo("reused");

        // Verify runId override: both entities should use the path parameter runId
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<DiscoveryCandidateEntityMappingEntity>> captor =
            ArgumentCaptor.forClass(List.class);
        verify(mappingRepository).saveAll(captor.capture());
        List<DiscoveryCandidateEntityMappingEntity> savedEntities = captor.getValue();
        assertThat(savedEntities).allMatch(e -> e.getRunId().equals(RUN_ID));
    }

    /**
     * Test 2: getByRunId returns all mappings for a given run.
     */
    @Test
    @DisplayName("Test 2: getByRunId returns all mappings for a given run")
    void getByRunId_returnsAllMappingsForRun() {
        // Given
        UUID mappingId1 = UUID.randomUUID();
        UUID mappingId2 = UUID.randomUUID();
        UUID candidateId1 = UUID.randomUUID();
        UUID candidateId2 = UUID.randomUUID();
        Instant now = Instant.now();

        DiscoveryCandidateEntityMappingEntity entity1 = DiscoveryCandidateEntityMappingEntity.builder()
            .id(mappingId1)
            .candidateId(candidateId1)
            .runId(RUN_ID)
            .entityType("applications")
            .entityId("app-abc123")
            .action("created")
            .createdAt(now)
            .build();

        DiscoveryCandidateEntityMappingEntity entity2 = DiscoveryCandidateEntityMappingEntity.builder()
            .id(mappingId2)
            .candidateId(candidateId2)
            .runId(RUN_ID)
            .entityType("services")
            .entityId("svc-def456")
            .action("reused")
            .createdAt(now)
            .build();

        when(mappingRepository.findByRunId(RUN_ID))
            .thenReturn(List.of(entity1, entity2));

        // When
        List<DiscoveryCandidateEntityMappingDto> result = service.getByRunId(RUN_ID);

        // Then
        assertThat(result).hasSize(2);

        assertThat(result.get(0).id()).isEqualTo(mappingId1);
        assertThat(result.get(0).candidateId()).isEqualTo(candidateId1);
        assertThat(result.get(0).runId()).isEqualTo(RUN_ID);
        assertThat(result.get(0).entityType()).isEqualTo("applications");
        assertThat(result.get(0).entityId()).isEqualTo("app-abc123");
        assertThat(result.get(0).action()).isEqualTo("created");
        assertThat(result.get(0).createdAt()).isEqualTo(now.toString());

        assertThat(result.get(1).id()).isEqualTo(mappingId2);
        assertThat(result.get(1).entityType()).isEqualTo("services");
        assertThat(result.get(1).action()).isEqualTo("reused");

        verify(mappingRepository).findByRunId(RUN_ID);
    }
}
