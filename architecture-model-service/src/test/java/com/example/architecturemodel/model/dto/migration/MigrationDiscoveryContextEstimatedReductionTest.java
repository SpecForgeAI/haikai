package com.example.architecturemodel.model.dto.migration;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Tests for the OPTIONAL {@code estimatedReduction} block on
 * {@link MigrationDiscoveryContextDto} (Spec: Vulnerability Reduction +
 * Steering, 2026-06-24, Spec 4 -- Task Group 4, task 4.1b).
 *
 * <p>Asserts the fail-soft contract: the block is OMITTED from the wire when
 * {@code null} (no target snapshot) -- never a zeroed reduction -- and, when
 * present, serialises with its per-bucket totals + the {@code estimate} flag so
 * every reporting surface inherits the ESTIMATE label.</p>
 *
 * <p>The {@link MigrationDiscoveryContextDto} is an established camelCase-wire
 * consumer (explicit {@code @JsonProperty} on every field), so the new
 * {@code estimatedReduction} key stays camelCase even under the AMS global
 * SNAKE_CASE mapper used here (the explicit annotation wins) -- this test pins
 * that the existing camelCase contract is preserved across the additive field.</p>
 *
 * <p>Plain JUnit (no Spring context) -- pure record (de)serialisation.</p>
 */
class MigrationDiscoveryContextEstimatedReductionTest {

    private static ObjectMapper snakeCaseMapper() {
        return new ObjectMapper()
            .registerModule(new JavaTimeModule())
            .setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
    }

    /** A minimal context DTO with the given (possibly null) reduction block. */
    private static MigrationDiscoveryContextDto minimalContext(
            MigrationDiscoveryContextDto.EstimatedReductionSummary reduction) {
        return new MigrationDiscoveryContextDto(
            UUID.randomUUID(),               // projectId
            UUID.randomUUID(),               // currentArchitectureId
            null,                            // targetArchitectureId (none)
            List.of(),                       // discoveryRunIds
            List.of(),                       // apiBehaviourBaselineIds
            Instant.parse("2026-06-24T00:00:00Z"),
            "summary",
            null, null, null, null,          // arch/run/findings summaries
            List.of(),                       // highPriorityFindings
            Map.of(),                        // findingsByCategory
            List.of(),                       // evidenceHighlights
            null,                            // candidateSummary
            List.of(),                       // unresolvedDecisionTasks
            null, null, null, null, null,    // runtime/db/baseline/mappings/readiness
            List.of(),                       // contextWarnings
            null,                            // targetStateDecisionsSummary
            List.of(),                       // scenarioSeeds
            reduction                        // estimatedReduction (under test)
        );
    }

    @Test
    @DisplayName("estimatedReduction is OMITTED from the wire when null (no target snapshot)")
    void omittedWhenNull() throws Exception {
        ObjectMapper mapper = snakeCaseMapper();
        String json = mapper.writeValueAsString(minimalContext(null));

        // Fail-soft ABSENT contract: the key is not present at all (NON_NULL),
        // never a zeroed block.
        assertThat(json).doesNotContain("estimatedReduction");
        assertThat(json).doesNotContain("estimated_reduction");

        // And it round-trips back to null.
        MigrationDiscoveryContextDto back =
            mapper.readValue(json, MigrationDiscoveryContextDto.class);
        assertThat(back.estimatedReduction()).isNull();
    }

    @Test
    @DisplayName("estimatedReduction serialises per-bucket totals + the estimate flag (camelCase key preserved)")
    void presentSerialisesBucketsAndEstimateFlag() throws Exception {
        ObjectMapper mapper = snakeCaseMapper();
        MigrationDiscoveryContextDto.EstimatedReductionSummary reduction =
            new MigrationDiscoveryContextDto.EstimatedReductionSummary(
                true, 10, 6, 4, 2);
        String json = mapper.writeValueAsString(minimalContext(reduction));

        // The block is present with its camelCase key (explicit @JsonProperty
        // wins over the global SNAKE_CASE) and carries the estimate label + counts.
        assertThat(json).contains("\"estimatedReduction\":");
        assertThat(json).contains("\"estimate\":true");
        assertThat(json).contains("\"total\":10");
        assertThat(json).contains("\"eliminated\":6");
        assertThat(json).contains("\"remaining\":4");
        assertThat(json).contains("\"newlyIntroduced\":2");

        // Round-trips faithfully.
        MigrationDiscoveryContextDto back =
            mapper.readValue(json, MigrationDiscoveryContextDto.class);
        assertThat(back.estimatedReduction()).isNotNull();
        assertThat(back.estimatedReduction().estimate()).isTrue();
        assertThat(back.estimatedReduction().eliminated()).isEqualTo(6);
        assertThat(back.estimatedReduction().newlyIntroduced()).isEqualTo(2);
    }

    @Test
    @DisplayName("newlyIntroduced is omitted (null) on the OSV-degrade path; estimate + headline buckets remain")
    void newlyIntroducedOmittedOnDegrade() throws Exception {
        ObjectMapper mapper = snakeCaseMapper();
        // OSV unavailable => newlyIntroduced null (distinct from a present 0).
        MigrationDiscoveryContextDto.EstimatedReductionSummary reduction =
            new MigrationDiscoveryContextDto.EstimatedReductionSummary(
                true, 10, 6, 4, null);
        String json = mapper.writeValueAsString(minimalContext(reduction));

        assertThat(json).contains("\"estimatedReduction\":");
        assertThat(json).contains("\"estimate\":true");
        assertThat(json).contains("\"eliminated\":6");
        // newlyIntroduced absent from the wire (NON_NULL on the nested record).
        assertThat(json).doesNotContain("newlyIntroduced");

        MigrationDiscoveryContextDto back =
            mapper.readValue(json, MigrationDiscoveryContextDto.class);
        assertThat(back.estimatedReduction().newlyIntroduced()).isNull();
        assertThat(back.estimatedReduction().eliminated()).isEqualTo(6);
    }
}
