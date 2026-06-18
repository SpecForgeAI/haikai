package com.example.architecturemodel.model.dto.apibehaviour;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * snake_case wire tests for the new {@code sequence_json} field on the baseline
 * item DTO + create request (Stateful Sequence Scenarios, 2026-06-18 — Task
 * Group 1). Mirrors the AMS global Jackson config
 * ({@code spring.jackson.property-naming-strategy: SNAKE_CASE}) so these DTOs
 * have NO {@code @CamelCaseWire}: the validation-service + frontend consumers
 * read {@code sequence_json} (the TS clients are snake_case per CLAUDE.md).
 *
 * <p>Timestamps are passed as {@code null} so a plain {@code ObjectMapper}
 * without the JSR-310 module serialises the record (same approach as
 * {@link ApiBehaviourBaselineIntegrityWireTest}); assertions are scoped to the
 * new field NAMES only.</p>
 */
class ApiBehaviourBaselineItemSequenceWireTest {

    private static ObjectMapper snakeMapper() {
        ObjectMapper m = new ObjectMapper();
        m.setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
        return m;
    }

    private static Map<String, Object> sequence() {
        Map<String, Object> step = new LinkedHashMap<>();
        step.put("index", 0);
        step.put("role", "act");
        step.put("kind", "http");
        step.put("expected_status", 201);
        step.put("response_refs", List.of(Map.of(
            "ref", "$0.id", "from_step", 0, "json_path", "id")));
        Map<String, Object> seq = new LinkedHashMap<>();
        seq.put("steps", List.of(step));
        seq.put("act_step_index", 0);
        seq.put("cleanup_best_effort", true);
        return seq;
    }

    @Test
    @DisplayName("(d) baseline item DTO serialises sequenceJson as snake_case sequence_json (no @CamelCaseWire)")
    void dtoSerialisesSequenceJsonSnakeCase() throws Exception {
        ApiBehaviourBaselineItemDto dto = new ApiBehaviourBaselineItemDto(
            UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
            UUID.randomUUID(), UUID.randomUUID(),
            "POST", "/filters/{id}/submitForReview", "submit-for-review",
            Map.of("body", Map.of("name", "draft")),
            200,
            Map.of("headers", Map.of(), "body", Map.of("status", "in_review")),
            null,          // volatilePathsJson
            sequence(),    // sequenceJson
            "noted",
            null, null);

        String json = snakeMapper().writeValueAsString(dto);

        assertThat(json).contains("\"sequence_json\"");
        assertThat(json).doesNotContain("\"sequenceJson\"");
        // nested chain keys are already snake_case inside the map
        assertThat(json).contains("\"act_step_index\"");
        assertThat(json).contains("\"cleanup_best_effort\"");
        assertThat(json).contains("\"response_refs\"");
    }

    @Test
    @DisplayName("(d2) create request deserialises sequence_json from the wire into sequenceJson")
    void createRequestDeserialisesSequenceJsonSnakeCase() throws Exception {
        String wire = """
            {
              "baseline_id": "%s",
              "capture_id": "%s",
              "operation_id": "%s",
              "scenario_id": "%s",
              "method": "POST",
              "path": "/filters/{id}/submitForReview",
              "scenario_name": "submit-for-review",
              "request_json": { "body": { "name": "draft" } },
              "response_status": 200,
              "response_json": { "headers": {}, "body": { "status": "in_review" } },
              "volatile_paths_json": null,
              "sequence_json": {
                "steps": [ { "index": 0, "role": "act", "kind": "http",
                             "expected_status": 201,
                             "response_refs": [ { "ref": "$0.id", "from_step": 0, "json_path": "id" } ] } ],
                "act_step_index": 0,
                "cleanup_best_effort": true
              },
              "business_notes": "noted"
            }
            """.formatted(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID());

        CreateApiBehaviourBaselineItemRequest req =
            snakeMapper().readValue(wire, CreateApiBehaviourBaselineItemRequest.class);

        assertThat(req.sequenceJson())
            .as("sequence_json on the wire maps to sequenceJson")
            .isNotNull()
            .containsEntry("act_step_index", 0)
            .containsEntry("cleanup_best_effort", true);
        assertThat(req.sequenceJson().get("steps")).isInstanceOf(List.class);
    }
}
