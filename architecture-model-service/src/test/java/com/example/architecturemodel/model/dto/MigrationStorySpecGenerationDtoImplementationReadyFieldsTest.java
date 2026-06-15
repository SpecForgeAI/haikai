package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Focused wire-contract tests for the two new fields on
 * {@link MigrationStorySpecGenerationDto} added by the Implementation-Ready
 * Migration Spec Generation spec (2026-06-14, Spec 1 of 4):
 * {@code structuredTestsJson} (-&gt; {@code structured_tests_json}) and
 * {@code coveredEndpointIds} (-&gt; {@code covered_endpoint_ids}).
 *
 * <p>Spec: Implementation-Ready Migration Spec Generation (2026-06-14) --
 * Task Group 1.</p>
 *
 * <p>Mirrors the {@link MigrationDeliveryHierarchyNodeDtoManuallyEditedTest}
 * convention: a direct {@link ObjectMapper} with the SNAKE_CASE strategy proves
 * the {@code @JsonProperty} snake_case wire names, independent of the global
 * AMS naming config.</p>
 *
 * <p>Focused tests (2 -- within the remaining 2-8 budget for task 1.1):</p>
 * <ol>
 *   <li>The canonical 25-arg constructor serialises both new fields under their
 *       snake_case wire names AND a JSON payload using those snake_case names
 *       deserialises back into the camelCase record components verbatim
 *       (POST/PUT in, GET out).</li>
 *   <li>The 19-arg back-compat constructor (pre-implementation-ready signature)
 *       still compiles and defaults BOTH new fields to {@code null}.</li>
 * </ol>
 */
class MigrationStorySpecGenerationDtoImplementationReadyFieldsTest {

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID WORK_ITEM_ID = UUID.randomUUID();
    private static final UUID BOOK_ID = UUID.randomUUID();
    private static final UUID SPEC_ID = UUID.randomUUID();

    @Test
    @DisplayName("structured_tests_json + covered_endpoint_ids serialise as snake_case and deserialise back verbatim")
    void newFieldsRoundTripSnakeCaseWire() throws Exception {
        List<Map<String, Object>> structuredTests = List.of(
            Map.of("title", "Account migrates", "description", "row survives the move", "type", "functional"),
            Map.of("title", "Mapper unit", "description", "no rounding", "type", "unit"));
        List<String> coveredEndpointIds = List.of(
            "11111111-1111-1111-1111-111111111111");

        MigrationStorySpecGenerationDto dto = new MigrationStorySpecGenerationDto(
            SPEC_ID, PROJECT_ID, WORK_ITEM_ID, BOOK_ID, "bi-1",
            "generated", "high", null,
            "/agent-os:shape-spec migrate accounts",
            null, null, null, null,
            "2026-06-14T10:00:00Z", null,
            1, "product-manager--migration-shape-spec-generation",
            "2026-06-14T09:00:00Z", "2026-06-14T10:00:00Z",
            Boolean.FALSE, null, null, null,
            structuredTests, coveredEndpointIds);

        // camelCase record components are populated.
        assertThat(dto.structuredTestsJson()).hasSize(2);
        assertThat(dto.coveredEndpointIds()).containsExactly(
            "11111111-1111-1111-1111-111111111111");

        ObjectMapper mapper = new ObjectMapper()
            .setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);

        // Serialise: @JsonProperty pins the wire names to snake_case.
        String json = mapper.writeValueAsString(dto);
        assertThat(json).contains("\"structured_tests_json\"");
        assertThat(json).contains("\"covered_endpoint_ids\"");
        assertThat(json).contains("\"type\":\"functional\"");

        // Deserialise the snake_case payload straight back into the DTO.
        MigrationStorySpecGenerationDto readBack =
            mapper.readValue(json, MigrationStorySpecGenerationDto.class);
        assertThat(readBack.structuredTestsJson()).hasSize(2);
        assertThat(readBack.structuredTestsJson().get(0))
            .containsEntry("title", "Account migrates")
            .containsEntry("type", "functional");
        assertThat(readBack.coveredEndpointIds())
            .containsExactly("11111111-1111-1111-1111-111111111111");
    }

    @Test
    @DisplayName("19-arg back-compat constructor leaves structuredTestsJson + coveredEndpointIds null")
    void backCompat19ArgConstructorDefaultsNewFieldsNull() {
        MigrationStorySpecGenerationDto dto = new MigrationStorySpecGenerationDto(
            SPEC_ID, PROJECT_ID, WORK_ITEM_ID, BOOK_ID, "bi-1",
            "generated", "high", null,
            "/agent-os:shape-spec migrate accounts",
            null, null, null, null,
            "2026-06-14T10:00:00Z", null,
            1, "product-manager--migration-shape-spec-generation",
            "2026-06-14T09:00:00Z", "2026-06-14T10:00:00Z");

        assertThat(dto.structuredTestsJson())
            .as("19-arg constructor defaults structuredTestsJson to null")
            .isNull();
        assertThat(dto.coveredEndpointIds())
            .as("19-arg constructor defaults coveredEndpointIds to null")
            .isNull();
        // The manual-edit fields are still defaulted as before.
        assertThat(dto.manuallyEdited()).isFalse();
    }
}
