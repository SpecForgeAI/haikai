package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Wire-contract tests for {@link GeneratedMigrationBookOfWorkDto} create-body
 * deserialization.
 *
 * <p>These drive the REAL Jackson round-trip that the service/controller tests
 * bypass (those construct the DTO as a Java object). That gap let the gateway's
 * camelCase keys + bare-array book of work be silently dropped by AMS
 * (unknown-properties tolerated), persisting a null {@code book_of_work_json} +
 * null architecture ids -- the "empty book of work + blank architecture" bug
 * (Spec 2026-06-23 fix). The mapper here mirrors the app's global Jackson config
 * (SNAKE_CASE + fail-on-unknown-properties:false, per application.yml).</p>
 */
class GeneratedMigrationBookOfWorkDtoWireTest {

    private final ObjectMapper mapper = new ObjectMapper()
        .setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE)
        .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    private static final String UUID_A = "11111111-1111-1111-1111-111111111111";
    private static final String UUID_B = "22222222-2222-2222-2222-222222222222";

    /** The canonical snake_case create body the (fixed) gateway now sends. */
    @Test
    void bindsTheCanonicalSnakeCaseCreateBody() throws Exception {
        String json = "{"
            + "\"title\":\"Migration Delivery Plan (8 delivery streams)\","
            + "\"summary\":\"s\","
            + "\"current_architecture_id\":\"" + UUID_A + "\","
            + "\"target_architecture_id\":\"" + UUID_B + "\","
            + "\"generation_inputs_json\":{\"k\":\"v\"},"
            + "\"generation_summary_json\":{\"k\":\"v\"},"
            + "\"quality_assessment_json\":{\"k\":\"v\"},"
            + "\"book_of_work_json\":{\"items\":[{\"id\":\"I1\",\"type\":\"initiative\",\"title\":\"t\"}]}"
            + "}";

        GeneratedMigrationBookOfWorkDto dto =
            mapper.readValue(json, GeneratedMigrationBookOfWorkDto.class);

        // The fields that used to silently bind to null are now populated.
        assertThat(dto.currentArchitectureId()).isNotNull();
        assertThat(dto.targetArchitectureId()).isNotNull();
        assertThat(dto.generationInputsJson()).containsKey("k");
        assertThat(dto.generationSummaryJson()).containsKey("k");
        assertThat(dto.qualityAssessmentJson()).containsKey("k");
        assertThat(dto.bookOfWorkJson()).isNotNull();
        assertThat(dto.bookOfWorkJson()).containsKey("items");
    }

    /**
     * Belt-and-braces: a deploy-skewed gateway sending the historical camelCase
     * keys still binds (via {@code @JsonAlias}) instead of silently nulling the
     * columns. The book of work must still arrive as an object {@code {items:[...]}}.
     */
    @Test
    void beltAndBracesAlsoBindsCamelCaseKeysViaJsonAlias() throws Exception {
        String json = "{"
            + "\"title\":\"t\","
            + "\"summary\":\"s\","
            + "\"currentArchitectureId\":\"" + UUID_A + "\","
            + "\"targetArchitectureId\":\"" + UUID_B + "\","
            + "\"generationInputs\":{\"k\":\"v\"},"
            + "\"generationSummary\":{\"k\":\"v\"},"
            + "\"qualityAssessment\":{\"k\":\"v\"},"
            + "\"bookOfWorkJson\":{\"items\":[{\"id\":\"I1\"}]}"
            + "}";

        GeneratedMigrationBookOfWorkDto dto =
            mapper.readValue(json, GeneratedMigrationBookOfWorkDto.class);

        assertThat(dto.currentArchitectureId()).isNotNull();
        assertThat(dto.targetArchitectureId()).isNotNull();
        assertThat(dto.generationInputsJson()).containsKey("k");
        assertThat(dto.bookOfWorkJson()).isNotNull();
        assertThat(dto.bookOfWorkJson()).containsKey("items");
    }
}
