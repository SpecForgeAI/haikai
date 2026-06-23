package com.example.architecturemodel.service.apibehaviour;

import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourCaptureSessionDto;
import com.example.architecturemodel.model.dto.apibehaviour.UpdateApiBehaviourCaptureSessionRequest;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourCaptureSessionEntity;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourCaptureSessionRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Focused round-trip tests for the {@code behaviour_semantics_config_json} field
 * added by the Semantics-aware API Behaviour Baseline coverage spec (2026-06-23)
 * -- Task Group 4 (config-persistence seam, changeset 196).
 *
 * <p>This is the ONE new nullable JSONB column on
 * {@code api_behaviour_capture_sessions} holding the operator's per-API
 * response-semantics config as a structured JSON object (mirroring the
 * validation service's {@code ResponseSemanticsConfig}). Persisted by the
 * capture wizard's new semantics step via the existing PATCH path; read by the
 * validation service orchestrator and fed into {@code classifyObservedBehaviour}.
 * {@code null} (the whole column) = no config recorded = "use the built-in
 * default vocabulary" -- the valid empty state; FORWARD-ONLY, no backfill.</p>
 *
 * <p>Two critical behaviours only (per the spec's 2-8 focused-test budget),
 * mirroring {@code ApiBehaviourCaptureSessionDataTypeDefaultsTest}:</p>
 * <ol>
 *   <li><b>Round-trip preserves a nested structured config</b> -- a config that
 *       includes a status-bucket map, a marker override, and the
 *       {@code fiveXxIsBadInput} flag survives save + reload intact (nested
 *       objects NOT flattened or dropped).</li>
 *   <li><b>Null-guarded PATCH apply</b> -- a later PATCH that OMITS
 *       {@code behaviourSemanticsConfigJson} (binds to {@code null}) MUST
 *       preserve the existing config; it must never clobber a
 *       previously-recorded config back to {@code null} (per
 *       {@code project_primitive_double_dto_overwrite.md}).</li>
 * </ol>
 *
 * <p>The H2 PostgreSQL-mode test DB uses the same {@code JSONB AS JSON} alias
 * trick already employed by {@code ApiBehaviourCaptureSessionDataTypeDefaultsTest}
 * / {@code ApiBehaviourCaptureSessionCoverageSummaryTest} so the
 * {@code JsonType}-bound column persists without standing up a real
 * PostgreSQL.</p>
 *
 * <p>Spec: Semantics-aware API Behaviour Baseline coverage (2026-06-23) -- Task
 * Group 4.</p>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:apibehavioursemanticsconfigdb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON",
    "app.features.include-database=true"
})
@Import(ApiBehaviourCaptureSessionService.class)
class ApiBehaviourCaptureSessionBehaviourSemanticsConfigTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private ApiBehaviourCaptureSessionRepository repository;

    @Autowired
    private ApiBehaviourCaptureSessionService service;

    /**
     * A representative response-semantics config in the spec's shape: a
     * status-bucket override, a marker-vocabulary extension, and the
     * {@code fiveXxIsBadInput} flag. Modeled as the JSONB {@code Map<String,Object>}
     * the entity persists (the validation service's {@code ResponseSemanticsConfig}
     * serialized).
     */
    private static Map<String, Object> semanticsConfig() {
        Map<String, Object> cfg = new HashMap<>();
        cfg.put("fiveXxIsBadInput", Boolean.TRUE);
        Map<String, Object> statusBucketOverride = new HashMap<>();
        statusBucketOverride.put("200", "not_found");
        cfg.put("statusBucketOverride", statusBucketOverride);
        Map<String, Object> badRequestMarkers = new HashMap<>();
        badRequestMarkers.put("mode", "extend");
        badRequestMarkers.put("markers", List.of("boom", "kaboom"));
        cfg.put("badRequestMarkers", badRequestMarkers);
        return cfg;
    }

    private ApiBehaviourCaptureSessionEntity seedDraftSession(UUID projectId, UUID architectureId) {
        ApiBehaviourCaptureSessionEntity seed = ApiBehaviourCaptureSessionEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .architectureId(architectureId)
            .name("seed")
            .status("draft")
            .environmentName("non-prod")
            .apiBaseUrl("https://api.example.test")
            .authType("bearer")
            .mutatingCallsConfirmed(Boolean.FALSE)
            .build();
        repository.saveAndFlush(seed);
        entityManager.clear();
        return seed;
    }

    private static UpdateApiBehaviourCaptureSessionRequest patchWithSemantics(
            String name, Map<String, Object> cfg) {
        // Canonical 25-arg PATCH request: only `name` (optional) and the new
        // behaviourSemanticsConfigJson are set; every other field omitted (null).
        return new UpdateApiBehaviourCaptureSessionRequest(
            name, null, null, null, null,
            null, null, null, null,
            null,                   // mutatingCallsConfirmed
            null, null, null,       // startedAt / completedAt / errorMessage
            null, null,             // kind / sourceBaselineId
            null, null, null,       // scenarios attempted / completed / errored
            null,                   // scopeInterfaceIdsJson
            null, null, null,       // coverage-override trio
            null,                   // coverageSummaryJson
            null,                   // dataTypeDefaultsJson
            cfg                     // behaviourSemanticsConfigJson
        );
    }

    @Test
    @DisplayName("(a) PATCH that sets behaviour_semantics_config_json round-trips the nested structured config (status map + marker override + flag preserved)")
    void patchSetsSemanticsConfigAndRoundTrips() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();
        ApiBehaviourCaptureSessionEntity seed = seedDraftSession(projectId, architectureId);

        ApiBehaviourCaptureSessionDto afterPatch = service.update(
            projectId, seed.getId(), patchWithSemantics(null, semanticsConfig()));

        Map<String, Object> fromPatch = afterPatch.behaviourSemanticsConfigJson();
        assertThat(fromPatch)
            .as("PATCH response carries the response-semantics config")
            .isNotNull();
        assertThat(fromPatch.get("fiveXxIsBadInput")).isEqualTo(Boolean.TRUE);
        assertThat(fromPatch).containsKey("statusBucketOverride");
        assertThat(fromPatch).containsKey("badRequestMarkers");
        entityManager.clear();

        // Reload the row directly and assert the nested config survived the JSONB
        // round-trip into the persisted column.
        ApiBehaviourCaptureSessionEntity reloaded =
            repository.findById(seed.getId()).orElseThrow();
        Map<String, Object> reloadedCfg = reloaded.getBehaviourSemanticsConfigJson();
        assertThat(reloadedCfg).isNotNull();
        assertThat(reloadedCfg.get("fiveXxIsBadInput")).isEqualTo(Boolean.TRUE);
        assertThat(reloadedCfg)
            .as("nested statusBucketOverride survived the round-trip")
            .containsKey("statusBucketOverride");
        @SuppressWarnings("unchecked")
        Map<String, Object> reloadedStatus =
            (Map<String, Object>) reloadedCfg.get("statusBucketOverride");
        assertThat(reloadedStatus.get("200")).isEqualTo("not_found");
        @SuppressWarnings("unchecked")
        Map<String, Object> reloadedMarkers =
            (Map<String, Object>) reloadedCfg.get("badRequestMarkers");
        assertThat(reloadedMarkers.get("mode")).isEqualTo("extend");
        @SuppressWarnings("unchecked")
        List<String> reloadedMarkerList = (List<String>) reloadedMarkers.get("markers");
        assertThat(reloadedMarkerList).containsExactly("boom", "kaboom");
    }

    @Test
    @DisplayName("(b) null-guarded PATCH apply: a PATCH that omits behaviourSemanticsConfigJson MUST preserve the existing config (never clobbers to null)")
    void patchOmittingSemanticsConfigPreservesExisting() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();
        ApiBehaviourCaptureSessionEntity seed = seedDraftSession(projectId, architectureId);

        // PATCH #1: record the semantics config.
        service.update(projectId, seed.getId(), patchWithSemantics(null, semanticsConfig()));
        entityManager.clear();

        // PATCH #2: change only `name`; behaviourSemanticsConfigJson OMITTED
        // (binds null). Critical assertion: the existing config MUST survive.
        ApiBehaviourCaptureSessionDto afterPatch2 = service.update(
            projectId, seed.getId(), patchWithSemantics("renamed", null));

        assertThat(afterPatch2.name()).isEqualTo("renamed");
        assertThat(afterPatch2.behaviourSemanticsConfigJson())
            .as("PATCH #2 omitted behaviourSemanticsConfigJson -- existing config MUST be preserved")
            .isNotNull();
        assertThat(afterPatch2.behaviourSemanticsConfigJson().get("fiveXxIsBadInput"))
            .isEqualTo(Boolean.TRUE);
        entityManager.clear();

        // Verify by reloading the row directly.
        ApiBehaviourCaptureSessionEntity reloaded =
            repository.findById(seed.getId()).orElseThrow();
        assertThat(reloaded.getBehaviourSemanticsConfigJson())
            .as("column still carries the config after the omitting PATCH")
            .isNotNull();
        assertThat(reloaded.getBehaviourSemanticsConfigJson().get("fiveXxIsBadInput"))
            .isEqualTo(Boolean.TRUE);
        assertThat(reloaded.getName()).isEqualTo("renamed");
    }
}
