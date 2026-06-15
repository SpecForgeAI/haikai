package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.DiscoveryCandidateDto;
import com.example.architecturemodel.model.entity.DiscoveryCandidateEntity;
import com.example.architecturemodel.repository.entity.DiscoveryCandidateRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.when;

/**
 * Tests for the `operation` dimension on DiscoveryCandidateEntity and
 * DiscoveryCandidateDto.
 *
 * Spec: Model-Aware Discovery -- Dedup Against Existing Entities +
 * Enrichment/Link Candidates (2026-05-30)
 * Task Group 1, Task 1.1: focused tests for the operation field.
 *
 * `operation` is a typed dimension on the candidate row (create / enrich /
 * link, default "create") -- NOT a new entity/relationship type. snake_case at
 * the wire (no @CamelCaseWire).
 *
 * Test 1: A candidate persisted without `operation` round-trips as "create"
 *         (the @Builder.Default and the bulkCreate null-coercion both apply).
 * Test 2: A candidate persisted with "enrich" / "link" round-trips that value
 *         through the entity and toDto.
 * Test 3: bulkCreate carries an explicit operation onto the persisted entity
 *         (write direction) and back out through toDto (read direction).
 * Test 4: The DTO serializes the field as snake_case `operation` (NOT camelCase)
 *         and deserializes back, under the AMS global SNAKE_CASE strategy.
 */
@ExtendWith(MockitoExtension.class)
class DiscoveryCandidateOperationFieldTest {

    @Mock
    private DiscoveryCandidateRepository candidateRepository;

    @Mock
    private DiscoveryRunArchitectureGuard runGuard;

    private DiscoveryCandidateService service;

    private static final UUID RUN_ID = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        service = new DiscoveryCandidateService(candidateRepository, runGuard);
    }

    /**
     * Test 1: A candidate built without `operation` defaults to "create" via
     * @Builder.Default, and that default survives toDto. Additionally, a DTO with
     * a null operation coerces to "create" through bulkCreate (the write path).
     */
    @Test
    @DisplayName("Test 1: operation defaults to 'create' when unset (entity @Builder.Default + bulkCreate null-coercion)")
    void operation_defaultsToCreate_whenUnset() {
        // Entity built without specifying operation -> @Builder.Default
        DiscoveryCandidateEntity entity = DiscoveryCandidateEntity.builder()
            .id(UUID.randomUUID())
            .runId(RUN_ID)
            .candidateType("application")
            .name("DefaultOpApp")
            .confidence(0.85)
            .status("proposed")
            .sourceClusterIds(List.of("cluster-1"))
            .data(Map.of("description", "App with default operation"))
            .synthesizedAt(Instant.now())
            .build();

        assertThat(entity.getOperation()).isEqualTo("create");

        // And toDto preserves the default
        DiscoveryCandidateDto dto = service.toDto(entity);
        assertThat(dto.operation()).isEqualTo("create");

        // And a DTO with a null operation coerces to "create" on the write path
        DiscoveryCandidateDto dtoWithNullOperation = new DiscoveryCandidateDto(
            UUID.randomUUID(), RUN_ID, "service", "NullOpService",
            0.7, "proposed",
            List.of("cluster-1"),
            Map.of("description", "no operation supplied"),
            Instant.now().toString(),
            null,
            "pending_review", null, null, null,
            null,
            null // operation omitted
        );

        when(candidateRepository.findAllById(anyList())).thenReturn(List.of());
        when(candidateRepository.saveAll(anyList()))
            .thenAnswer(invocation -> invocation.getArgument(0));

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<DiscoveryCandidateEntity>> captor = ArgumentCaptor.forClass(List.class);

        List<DiscoveryCandidateDto> result =
            service.bulkCreate(RUN_ID, List.of(dtoWithNullOperation));

        org.mockito.Mockito.verify(candidateRepository).saveAll(captor.capture());
        assertThat(captor.getValue()).hasSize(1);
        assertThat(captor.getValue().get(0).getOperation()).isEqualTo("create");
        assertThat(result).hasSize(1);
        assertThat(result.get(0).operation()).isEqualTo("create");
    }

    /**
     * Test 2: An entity built with "enrich" or "link" keeps that value and
     * round-trips through toDto unchanged.
     */
    @Test
    @DisplayName("Test 2: operation 'enrich' and 'link' round-trip through the entity and toDto")
    void operation_enrichAndLink_roundTripThroughEntityAndToDto() {
        for (String operation : new String[]{"enrich", "link"}) {
            DiscoveryCandidateEntity entity = DiscoveryCandidateEntity.builder()
                .id(UUID.randomUUID())
                .runId(RUN_ID)
                .candidateType("logical_data_entity")
                .name("Op-" + operation)
                .confidence(0.9)
                .status("proposed")
                .sourceClusterIds(List.of("cluster-x"))
                .data(Map.of("targetEntityName", "Owner"))
                .synthesizedAt(Instant.now())
                .operation(operation)
                .build();

            assertThat(entity.getOperation()).isEqualTo(operation);

            DiscoveryCandidateDto dto = service.toDto(entity);
            assertThat(dto.operation()).isEqualTo(operation);
        }
    }

    /**
     * Test 3: bulkCreate threads an explicit operation onto the persisted entity
     * (write direction) and returns it via toDto (read direction).
     */
    @Test
    @DisplayName("Test 3: bulkCreate carries an explicit 'enrich' operation in both directions")
    void bulkCreate_carriesExplicitOperation_bothDirections() {
        DiscoveryCandidateDto enrichDto = new DiscoveryCandidateDto(
            UUID.randomUUID(), RUN_ID, "logical_data_entity", "Owner",
            0.95, "proposed",
            new ArrayList<>(List.of("cluster-1")),
            new HashMap<>(Map.of("targetEntityName", "Owner", "confidence", 0.95)),
            Instant.now().toString(),
            null,
            "pending_review", null, null, null,
            null,
            "enrich"
        );

        when(candidateRepository.findAllById(anyList())).thenReturn(List.of());
        when(candidateRepository.saveAll(anyList()))
            .thenAnswer(invocation -> invocation.getArgument(0));

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<DiscoveryCandidateEntity>> captor = ArgumentCaptor.forClass(List.class);

        List<DiscoveryCandidateDto> result = service.bulkCreate(RUN_ID, List.of(enrichDto));

        // Write direction: the entity handed to the repository carries the operation
        org.mockito.Mockito.verify(candidateRepository).saveAll(captor.capture());
        assertThat(captor.getValue()).hasSize(1);
        assertThat(captor.getValue().get(0).getOperation()).isEqualTo("enrich");

        // Read direction: the returned DTO carries the operation
        assertThat(result).hasSize(1);
        assertThat(result.get(0).operation()).isEqualTo("enrich");
    }

    /**
     * Test 4: under the AMS global SNAKE_CASE naming strategy, the DTO serializes
     * the operation field as the snake_case key `operation` (NOT a camelCase
     * variant), and deserializes back from that key.
     */
    @Test
    @DisplayName("Test 4: DTO serializes operation as snake_case 'operation' and round-trips (SNAKE_CASE strategy)")
    void dto_serializesOperationAsSnakeCase() throws Exception {
        ObjectMapper mapper = new ObjectMapper()
            .setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);

        DiscoveryCandidateDto dto = new DiscoveryCandidateDto(
            UUID.randomUUID(), RUN_ID, "physical_data_entity", "owners",
            0.8, "proposed",
            List.of("cluster-1"),
            Map.of("description", "physical table"),
            Instant.now().toString(),
            null,
            "pending_review", null, null, null,
            null,
            "link"
        );

        String json = mapper.writeValueAsString(dto);

        // The wire key is the snake_case `operation` carrying the value
        assertThat(json).contains("\"operation\":\"link\"");
        // And NOT a camelCase variant (defensive: the single-word field has no
        // camelCase form, but assert no accidental alternate key leaks)
        assertThat(json).doesNotContain("\"Operation\"");

        // Round-trip back from the snake_case wire shape
        DiscoveryCandidateDto roundTripped = mapper.readValue(json, DiscoveryCandidateDto.class);
        assertThat(roundTripped.operation()).isEqualTo("link");
    }
}
