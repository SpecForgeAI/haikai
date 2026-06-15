package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.DiscoveryConfigDto;
import com.example.architecturemodel.model.entity.DiscoveryConfigEntity;
import com.example.architecturemodel.repository.entity.DiscoveryConfigRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Unit tests for DiscoveryConfigService.
 *
 * Spec: Phase 0 Persistence Contract (Increment 2)
 * Task Group 3: Service and Controller
 */
@ExtendWith(MockitoExtension.class)
class DiscoveryConfigServiceTest {

    @Mock
    private DiscoveryConfigRepository repository;

    private DiscoveryConfigService service;

    private static final UUID PROJECT_ID = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        service = new DiscoveryConfigService(repository);
    }

    /**
     * Test 1: upsertConfig creates a new entity when none exists for the given projectId.
     */
    @Test
    void upsertConfig_createsNewEntity_whenNoneExists() {
        // Given
        Map<String, Object> configPayload = new HashMap<>();
        configPayload.put("repos", List.of(Map.of("url", "https://github.com/example/repo")));
        configPayload.put("techHints", List.of());

        when(repository.findByProjectId(PROJECT_ID))
            .thenReturn(Optional.empty());

        when(repository.save(any(DiscoveryConfigEntity.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));

        // When
        DiscoveryConfigDto result = service.upsertConfig(PROJECT_ID, configPayload, "DRAFT");

        // Then
        assertThat(result).isNotNull();
        assertThat(result.projectId()).isEqualTo(PROJECT_ID);
        assertThat(result.status()).isEqualTo("DRAFT");
        assertThat(result.configPayload()).containsKey("repos");
        assertThat(result.createdAt()).isNotNull();
        assertThat(result.updatedAt()).isNotNull();

        ArgumentCaptor<DiscoveryConfigEntity> captor = ArgumentCaptor.forClass(DiscoveryConfigEntity.class);
        verify(repository).save(captor.capture());
        assertThat(captor.getValue().getId()).isNotNull();
        assertThat(captor.getValue().getProjectId()).isEqualTo(PROJECT_ID);
        assertThat(captor.getValue().getStatus()).isEqualTo("DRAFT");
    }

    /**
     * Test 2: upsertConfig updates the existing entity when one already exists for the projectId.
     */
    @Test
    void upsertConfig_updatesExistingEntity_whenAlreadyExists() {
        // Given
        UUID existingId = UUID.randomUUID();
        Instant originalCreatedAt = Instant.now().minusSeconds(3600);

        DiscoveryConfigEntity existingEntity = DiscoveryConfigEntity.builder()
            .id(existingId)
            .projectId(PROJECT_ID)
            .configPayload(Map.of("repos", List.of()))
            .status("DRAFT")
            .createdAt(originalCreatedAt)
            .updatedAt(Instant.now().minusSeconds(60))
            .build();

        Map<String, Object> updatedPayload = new HashMap<>();
        updatedPayload.put("repos", List.of(Map.of("url", "https://github.com/example/updated-repo")));
        updatedPayload.put("exclusions", List.of("node_modules"));

        when(repository.findByProjectId(PROJECT_ID))
            .thenReturn(Optional.of(existingEntity));

        when(repository.save(any(DiscoveryConfigEntity.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));

        // When
        DiscoveryConfigDto result = service.upsertConfig(PROJECT_ID, updatedPayload, "COMPLETE");

        // Then
        assertThat(result).isNotNull();
        assertThat(result.configPayload()).containsKey("exclusions");
        assertThat(result.status()).isEqualTo("COMPLETE");

        ArgumentCaptor<DiscoveryConfigEntity> captor = ArgumentCaptor.forClass(DiscoveryConfigEntity.class);
        verify(repository).save(captor.capture());
        // Same entity ID should be preserved (update, not duplicate)
        assertThat(captor.getValue().getId()).isEqualTo(existingId);
        assertThat(captor.getValue().getConfigPayload()).containsKey("exclusions");
        assertThat(captor.getValue().getStatus()).isEqualTo("COMPLETE");
        assertThat(captor.getValue().getCreatedAt()).isEqualTo(originalCreatedAt);
    }

    /**
     * Test 3: getConfig returns DTO when entity exists.
     */
    @Test
    void getConfig_returnsDto_whenEntityExists() {
        // Given
        UUID entityId = UUID.randomUUID();
        Instant now = Instant.now();
        Map<String, Object> configPayload = new HashMap<>();
        configPayload.put("repos", List.of(Map.of("url", "https://github.com/example/repo")));
        configPayload.put("techHints", List.of("Java", "Spring Boot"));

        DiscoveryConfigEntity entity = DiscoveryConfigEntity.builder()
            .id(entityId)
            .projectId(PROJECT_ID)
            .configPayload(configPayload)
            .status("COMPLETE")
            .createdAt(now)
            .updatedAt(now)
            .build();

        when(repository.findByProjectId(PROJECT_ID))
            .thenReturn(Optional.of(entity));

        // When
        DiscoveryConfigDto result = service.getConfig(PROJECT_ID);

        // Then
        assertThat(result).isNotNull();
        assertThat(result.id()).isEqualTo(entityId);
        assertThat(result.projectId()).isEqualTo(PROJECT_ID);
        assertThat(result.configPayload()).containsKey("repos");
        assertThat(result.configPayload()).containsKey("techHints");
        assertThat(result.status()).isEqualTo("COMPLETE");
        assertThat(result.createdAt()).isEqualTo(now.toString());
        assertThat(result.updatedAt()).isEqualTo(now.toString());
    }

    /**
     * Test 4: getConfig returns null when no entity exists.
     */
    @Test
    void getConfig_returnsNull_whenNoEntityExists() {
        // Given
        when(repository.findByProjectId(PROJECT_ID))
            .thenReturn(Optional.empty());

        // When
        DiscoveryConfigDto result = service.getConfig(PROJECT_ID);

        // Then
        assertThat(result).isNull();
    }

    /**
     * Test 5: upsertConfig rejects invalid status values.
     */
    @Test
    void upsertConfig_rejectsInvalidStatus() {
        // Given
        Map<String, Object> configPayload = new HashMap<>();
        configPayload.put("repos", List.of());

        // When/Then
        assertThatThrownBy(() -> service.upsertConfig(PROJECT_ID, configPayload, "INVALID_STATUS"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Invalid status");
    }

    /**
     * Gap Test 1 (Task Group 7): Round-trip upsert-then-get returns matching DTO.
     *
     * Verifies that upserting a config and then retrieving it via getConfig
     * returns a DTO with matching fields -- covering the full create-and-read
     * flow through the service layer.
     */
    @Test
    void upsertConfig_thenGetConfig_returnsMatchingDto() {
        // Given -- a config payload with representative discovery data
        Map<String, Object> configPayload = new HashMap<>();
        configPayload.put("repos", List.of(Map.of("url", "https://github.com/example/repo", "branch", "main")));
        configPayload.put("repoApplicationMappings", List.of(Map.of("repo", "repo", "application", "MyApp")));
        configPayload.put("techHints", List.of("Java", "Spring Boot"));
        configPayload.put("exclusions", List.of("node_modules", ".git"));
        configPayload.put("notes", List.of("Initial setup"));

        // Capture the entity that is saved so we can return it from findByProjectId
        ArgumentCaptor<DiscoveryConfigEntity> saveCaptor = ArgumentCaptor.forClass(DiscoveryConfigEntity.class);

        when(repository.findByProjectId(PROJECT_ID))
            .thenReturn(Optional.empty())     // first call (during upsert) -- no entity exists
            .thenAnswer(invocation -> {        // second call (during getConfig) -- return saved entity
                return Optional.of(saveCaptor.getValue());
            });

        when(repository.save(any(DiscoveryConfigEntity.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));

        // When -- upsert then get
        DiscoveryConfigDto upsertResult = service.upsertConfig(PROJECT_ID, configPayload, "DRAFT");

        // Capture the saved entity for the subsequent find
        verify(repository).save(saveCaptor.capture());

        DiscoveryConfigDto getResult = service.getConfig(PROJECT_ID);

        // Then -- round-trip fields match
        assertThat(getResult).isNotNull();
        assertThat(getResult.id()).isEqualTo(upsertResult.id());
        assertThat(getResult.projectId()).isEqualTo(upsertResult.projectId());
        assertThat(getResult.status()).isEqualTo(upsertResult.status());
        assertThat(getResult.configPayload()).isEqualTo(upsertResult.configPayload());
        assertThat(getResult.createdAt()).isEqualTo(upsertResult.createdAt());
        assertThat(getResult.updatedAt()).isEqualTo(upsertResult.updatedAt());

        // Verify the specific payload keys survived the round-trip
        assertThat(getResult.configPayload()).containsKeys("repos", "repoApplicationMappings", "techHints", "exclusions", "notes");
    }
}
