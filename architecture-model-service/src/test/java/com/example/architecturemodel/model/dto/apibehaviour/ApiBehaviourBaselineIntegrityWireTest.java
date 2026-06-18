package com.example.architecturemodel.model.dto.apibehaviour;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * snake_case wire tests for the Baseline Integrity &amp; Provenance fields
 * (2026-06-17) — Task Group 1. Mirrors the AMS global Jackson config
 * ({@code spring.jackson.property-naming-strategy: SNAKE_CASE}) so these DTOs
 * have NO {@code @CamelCaseWire}: the validation-service + frontend consumers
 * read {@code content_hash} / {@code provenance_json} / {@code recomputed_hash}
 * / {@code integrity_verified}.
 *
 * <p>Timestamps are passed as {@code null} (same approach as
 * {@code ApiBehaviourCaptureSessionCoverageSummaryTest}'s snake_case test) so a
 * plain {@code ObjectMapper} without the JSR-310 module serialises the record
 * — the assertions are scoped to the new field NAMES only.</p>
 */
class ApiBehaviourBaselineIntegrityWireTest {

    private static ObjectMapper snakeMapper() {
        ObjectMapper m = new ObjectMapper();
        m.setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
        return m;
    }

    @Test
    @DisplayName("(e) integrity DTO serialises content_hash / recomputed_hash / integrity_verified in snake_case")
    void integrityDtoSnakeCase() throws Exception {
        ApiBehaviourBaselineIntegrityDto dto =
            new ApiBehaviourBaselineIntegrityDto("abc123", "abc123", true);

        String json = snakeMapper().writeValueAsString(dto);

        assertThat(json).contains("\"content_hash\"");
        assertThat(json).contains("\"recomputed_hash\"");
        assertThat(json).contains("\"integrity_verified\"");
        assertThat(json).doesNotContain("\"contentHash\"");
        assertThat(json).doesNotContain("\"recomputedHash\"");
        assertThat(json).doesNotContain("\"integrityVerified\"");
    }

    @Test
    @DisplayName("(e2) baseline DTO serialises content_hash / provenance_json in snake_case (no @CamelCaseWire)")
    void baselineDtoSnakeCase() throws Exception {
        Map<String, Object> provenance = new LinkedHashMap<>();
        provenance.put("session_id", UUID.randomUUID().toString());
        provenance.put("coverage_score", 0.5);
        provenance.put("hash_algo", "sha256");
        provenance.put("canonical_version", 1);

        ApiBehaviourBaselineDto dto = new ApiBehaviourBaselineDto(
            UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
            "baseline", "active", 2, 2, null,
            "current", null,
            "deadbeef", provenance,
            null, null);

        String json = snakeMapper().writeValueAsString(dto);

        assertThat(json).contains("\"content_hash\"");
        assertThat(json).contains("\"provenance_json\"");
        assertThat(json).doesNotContain("\"contentHash\"");
        assertThat(json).doesNotContain("\"provenanceJson\"");
        // nested provenance keys are already snake_case inside the map
        assertThat(json).contains("\"coverage_score\"");
        assertThat(json).contains("\"hash_algo\"");
    }
}
