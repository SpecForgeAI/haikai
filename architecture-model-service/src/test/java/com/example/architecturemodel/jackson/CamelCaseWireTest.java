package com.example.architecturemodel.jackson;

import com.example.architecturemodel.model.dto.SuggestFromCurrentRequest;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Regression test for {@link CamelCaseWire}.
 *
 * <p>A {@code @CamelCaseWire} DTO must (de)serialise with camelCase JSON keys
 * EVEN under the application's global {@code SNAKE_CASE} Jackson naming strategy
 * (configured in {@code application.yml}). The meta-annotation only takes effect
 * if {@code @CamelCaseWire} is itself meta-annotated with
 * {@code @JacksonAnnotationsInside}; without it Jackson silently ignores the
 * nested {@code @JsonNaming} and the DTO falls back to the global SNAKE_CASE
 * strategy.</p>
 *
 * <p>That fallback was the root cause of the Target State "Suggest" failure:
 * the frontend POSTs {@code {"currentArchitectureId": "..."}} (camelCase) but a
 * SNAKE_CASE server expected {@code current_architecture_id}, so the field bound
 * to {@code null} and AMS rejected with
 * "currentArchitectureId is required ...".</p>
 *
 * <p>These tests use a hand-built SNAKE_CASE-global {@link ObjectMapper} that
 * mirrors the production config -- the existing controller tests use a default
 * (already-camelCase) mapper and therefore can NOT catch this regression.</p>
 */
class CamelCaseWireTest {

    /** Mirrors the production AMS ObjectMapper: global SNAKE_CASE naming. */
    private ObjectMapper snakeCaseGlobalMapper() {
        return new ObjectMapper()
            .setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
    }

    @Test
    @DisplayName("@CamelCaseWire DTO deserialises camelCase keys even under the global SNAKE_CASE mapper")
    void deserialisesCamelCaseUnderSnakeCaseGlobal() throws Exception {
        UUID id = UUID.randomUUID();
        String camelJson = "{\"currentArchitectureId\":\"" + id + "\"}";

        SuggestFromCurrentRequest req =
            snakeCaseGlobalMapper().readValue(camelJson, SuggestFromCurrentRequest.class);

        assertThat(req.currentArchitectureId())
            .as("@CamelCaseWire must make the camelCase key bind despite the global SNAKE_CASE default")
            .isEqualTo(id);
    }

    @Test
    @DisplayName("@CamelCaseWire DTO serialises to camelCase keys even under the global SNAKE_CASE mapper")
    void serialisesCamelCaseUnderSnakeCaseGlobal() throws Exception {
        UUID id = UUID.randomUUID();

        String json = snakeCaseGlobalMapper()
            .writeValueAsString(new SuggestFromCurrentRequest(id));

        assertThat(json)
            .as("must emit camelCase 'currentArchitectureId', not snake_case 'current_architecture_id'")
            .contains("\"currentArchitectureId\"")
            .doesNotContain("current_architecture_id");
    }
}
