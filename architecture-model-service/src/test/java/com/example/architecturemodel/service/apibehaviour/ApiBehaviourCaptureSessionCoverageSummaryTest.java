package com.example.architecturemodel.service.apibehaviour;

import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourCaptureSessionDto;
import com.example.architecturemodel.model.dto.apibehaviour.UpdateApiBehaviourCaptureSessionRequest;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourCaptureSessionEntity;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourCaptureSessionRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Focused round-trip tests for the {@code coverage_summary_json} field added by
 * the Oracle Coverage Scoring spec (2026-06-17) -- Task Group 1.
 *
 * <p>This is the ONE new nullable JSONB column on
 * {@code api_behaviour_capture_sessions} holding the whole coverage summary
 * (overall + per-endpoint dimensions, achieved/missed, honest reasons, and the
 * single project-level auth dimension), written on the completion PATCH by the
 * single-source coverage scorer in {@code captureSessionOrchestrator.ts}.</p>
 *
 * <p>Three critical behaviours only (per the spec's 2-8 focused-test budget):</p>
 * <ol>
 *   <li><b>PATCH persists + reads back intact</b> -- a PATCH that sets the
 *       nested coverage-summary JSON round-trips through {@code JsonType}
 *       binding without data loss.</li>
 *   <li><b>Null-guarded PATCH apply</b> -- a later PATCH that OMITS
 *       {@code coverageSummaryJson} (binds to {@code null}) MUST preserve the
 *       existing summary; it must never clobber a previously-recorded summary
 *       back to {@code null} (per
 *       {@code project_primitive_double_dto_overwrite.md}).</li>
 *   <li><b>snake_case wire shape</b> -- the DTO serialises
 *       {@code coverageSummaryJson} as {@code coverage_summary_json} under the
 *       global SNAKE_CASE strategy (AMS default; the field carries NO
 *       {@code @CamelCaseWire}).</li>
 * </ol>
 *
 * <p>The H2 PostgreSQL-mode test DB uses the same {@code JSONB AS JSON} alias
 * trick already employed by {@code ApiBehaviourCaptureSessionMultiPatchTest} /
 * {@code ApiBehaviourPersistenceTest} so the {@code JsonType}-bound column
 * persists without standing up a real PostgreSQL.</p>
 *
 * <p>Spec: Oracle Coverage Scoring (2026-06-17) -- Task Group 1.</p>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:apibehaviourcoveragedb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON",
    "app.features.include-database=true"
})
@Import(ApiBehaviourCaptureSessionService.class)
class ApiBehaviourCaptureSessionCoverageSummaryTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private ApiBehaviourCaptureSessionRepository repository;

    @Autowired
    private ApiBehaviourCaptureSessionService service;

    /**
     * A representative coverage-summary blob in the spec's snake_case shape:
     * overall + one per-endpoint operation with a happy_path achieved dimension
     * and a missed not_found dimension (with an honest reason), plus the single
     * project-level auth dimension.
     */
    private static Map<String, Object> coverageSummary(double overallScore) {
        return Map.of(
            "overall_score", overallScore,
            "dimensions_total", 3,
            "dimensions_achieved", 1,
            "per_endpoint", List.of(Map.of(
                "operation_id", "getWidgets",
                "method", "GET",
                "path", "/widgets",
                "score", 0.5,
                "dimensions", List.of(
                    Map.of(
                        "name", "happy_path",
                        "type", "happy_path",
                        "expected_status", "success",
                        "achieved", true,
                        "canonical_capture_id", "cap-1",
                        "reason", "ok"
                    ),
                    Map.of(
                        "name", "not_found_id",
                        "type", "not_found",
                        "expected_status", "not_found",
                        "achieved", false,
                        "reason", "no capture matched the intended not_found class"
                    )
                )
            )),
            "auth_coverage", Map.of(
                "achieved", false,
                "representative_operation_id", "getWidgets",
                "probes", List.of(
                    Map.of("name", "no_token", "expected", "401", "achieved", true),
                    Map.of("name", "bad_token", "expected", "401_or_403",
                        "achieved", false,
                        "reason", "bad_token: observed 200 (expected 401/403)")
                )
            )
        );
    }

    private ApiBehaviourCaptureSessionEntity seedRunningSession(UUID projectId, UUID architectureId) {
        ApiBehaviourCaptureSessionEntity seed = ApiBehaviourCaptureSessionEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .architectureId(architectureId)
            .name("seed")
            .status("running")
            .environmentName("non-prod")
            .apiBaseUrl("https://api.example.test")
            .authType("bearer")
            .mutatingCallsConfirmed(Boolean.FALSE)
            .build();
        repository.saveAndFlush(seed);
        entityManager.clear();
        return seed;
    }

    @Test
    @DisplayName("(a) PATCH that sets coverage_summary_json persists and reads back intact (nested JSONB round-trip)")
    @SuppressWarnings("unchecked")
    void patchSetsCoverageSummaryAndItRoundTrips() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();
        ApiBehaviourCaptureSessionEntity seed = seedRunningSession(projectId, architectureId);

        // Completion PATCH: set the coverage summary (mirrors the orchestrator's
        // final patchCaptureSession beside scenarios_attempted/completed/errored).
        ApiBehaviourCaptureSessionDto afterPatch = service.update(
            projectId, seed.getId(),
            new UpdateApiBehaviourCaptureSessionRequest(
                null, "completed", null, null, null,
                null, null, null, null,
                null,                 // mutatingCallsConfirmed
                null, null, null,     // startedAt / completedAt / errorMessage
                null, null,           // kind / sourceBaselineId
                5, 3, 2,              // scenarios attempted / completed / errored
                null,                 // scopeInterfaceIdsJson
                null, null, null,     // coverage-override trio
                coverageSummary(0.25) // coverageSummaryJson
            )
        );

        assertThat(afterPatch.coverageSummaryJson())
            .as("PATCH response carries the coverage summary")
            .isNotNull();
        assertThat(afterPatch.coverageSummaryJson().get("overall_score")).isEqualTo(0.25);
        assertThat(afterPatch.coverageSummaryJson().get("dimensions_total")).isEqualTo(3);
        entityManager.clear();

        // Reload the row directly and assert the nested structure survived.
        ApiBehaviourCaptureSessionEntity reloaded =
            repository.findById(seed.getId()).orElseThrow();
        Map<String, Object> summary = reloaded.getCoverageSummaryJson();
        assertThat(summary).isNotNull();
        assertThat(summary.get("overall_score")).isEqualTo(0.25);

        List<Map<String, Object>> perEndpoint =
            (List<Map<String, Object>>) summary.get("per_endpoint");
        assertThat(perEndpoint).hasSize(1);
        assertThat(perEndpoint.get(0).get("operation_id")).isEqualTo("getWidgets");

        List<Map<String, Object>> dims =
            (List<Map<String, Object>>) perEndpoint.get(0).get("dimensions");
        assertThat(dims).hasSize(2);
        Map<String, Object> missed = dims.get(1);
        assertThat(missed.get("achieved")).isEqualTo(Boolean.FALSE);
        assertThat(missed.get("reason"))
            .as("the missed dimension carries an honest reason verbatim")
            .isEqualTo("no capture matched the intended not_found class");

        Map<String, Object> auth = (Map<String, Object>) summary.get("auth_coverage");
        assertThat(auth.get("achieved")).isEqualTo(Boolean.FALSE);
        assertThat(auth.get("representative_operation_id")).isEqualTo("getWidgets");
    }

    @Test
    @DisplayName("(b) null-guarded PATCH apply: a PATCH that omits coverageSummaryJson MUST preserve the existing summary (never clobbers to null)")
    void patchOmittingCoverageSummaryPreservesExisting() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();
        ApiBehaviourCaptureSessionEntity seed = seedRunningSession(projectId, architectureId);

        // PATCH #1: record the coverage summary.
        service.update(
            projectId, seed.getId(),
            new UpdateApiBehaviourCaptureSessionRequest(
                null, null, null, null, null,
                null, null, null, null,
                null, null, null, null,
                null, null,
                null, null, null,
                null,
                null, null, null,
                coverageSummary(0.5)
            )
        );
        entityManager.clear();

        // PATCH #2: change only `name`; coverageSummaryJson OMITTED (binds null).
        // This is the critical assertion: the existing summary MUST survive.
        ApiBehaviourCaptureSessionDto afterPatch2 = service.update(
            projectId, seed.getId(),
            new UpdateApiBehaviourCaptureSessionRequest(
                "renamed",            // name -> change
                null, null, null, null,
                null, null, null, null,
                null, null, null, null,
                null, null,
                null, null, null,
                null,
                null, null, null,
                null                  // coverageSummaryJson OMITTED
            )
        );
        assertThat(afterPatch2.name()).isEqualTo("renamed");
        assertThat(afterPatch2.coverageSummaryJson())
            .as("PATCH #2 omitted coverageSummaryJson -- existing summary MUST be preserved")
            .isNotNull();
        assertThat(afterPatch2.coverageSummaryJson().get("overall_score")).isEqualTo(0.5);
        entityManager.clear();

        // Verify by reloading the row directly.
        ApiBehaviourCaptureSessionEntity reloaded =
            repository.findById(seed.getId()).orElseThrow();
        assertThat(reloaded.getCoverageSummaryJson())
            .as("column still carries the summary after the omitting PATCH")
            .isNotNull();
        assertThat(reloaded.getCoverageSummaryJson().get("overall_score")).isEqualTo(0.5);
        assertThat(reloaded.getName()).isEqualTo("renamed");
    }

    @Test
    @DisplayName("(c) snake_case wire: the DTO serialises coverageSummaryJson as coverage_summary_json (no @CamelCaseWire; AMS SNAKE_CASE default)")
    void dtoSerialisesCoverageSummaryAsSnakeCase() throws Exception {
        // Mirror the AMS global Jackson config: SNAKE_CASE property naming.
        ObjectMapper snakeMapper = new ObjectMapper();
        snakeMapper.setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);

        ApiBehaviourCaptureSessionDto dto = new ApiBehaviourCaptureSessionDto(
            UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
            "session", "completed",
            "non-prod", "https://api.example.test", "bearer",
            null, null, null, null,
            Boolean.FALSE,
            null, null, null,
            null, null
        );
        // Use the canonical record components via a derived copy that carries the summary.
        ApiBehaviourCaptureSessionDto withSummary = new ApiBehaviourCaptureSessionDto(
            dto.id(), dto.projectId(), dto.architectureId(),
            dto.name(), dto.status(),
            dto.environmentName(), dto.apiBaseUrl(), dto.authType(),
            null, null, null, null,
            dto.mutatingCallsConfirmed(),
            null, null, null,
            "current", null,
            null, null, null,
            null,
            null, null, null,
            coverageSummary(0.75),
            null, null
        );

        String json = snakeMapper.writeValueAsString(withSummary);

        assertThat(json)
            .as("DTO must emit the snake_case key under the AMS default strategy")
            .contains("\"coverage_summary_json\"");
        assertThat(json)
            .as("DTO must NOT emit a camelCase key (no @CamelCaseWire on this field)")
            .doesNotContain("\"coverageSummaryJson\"");
        // The nested keys are inside the JSONB map verbatim (already snake_case).
        assertThat(json).contains("\"overall_score\"");
        assertThat(json).contains("\"per_endpoint\"");
        assertThat(json).contains("\"auth_coverage\"");
    }
}
