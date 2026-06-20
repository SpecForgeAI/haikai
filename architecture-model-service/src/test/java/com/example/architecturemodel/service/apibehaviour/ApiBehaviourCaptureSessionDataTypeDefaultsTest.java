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
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Focused round-trip tests for the {@code data_type_defaults_json} field added by
 * the Capture data-type format defaults spec (2026-06-20) -- Task Group 1.
 *
 * <p>This is the ONE new nullable JSONB column on
 * {@code api_behaviour_capture_sessions} holding the operator's per-data-type
 * format defaults as a plain map {@code category -> format string}, where a
 * non-null string = the operator default, a {@code null} VALUE = an explicit
 * "no default", and an ABSENT key = untouched. Persisted by the capture wizard's
 * "Data-type formats" step via the existing PATCH path.</p>
 *
 * <p>Two critical behaviours only (per the spec's 2-8 focused-test budget),
 * mirroring {@code ApiBehaviourCaptureSessionCoverageSummaryTest}:</p>
 * <ol>
 *   <li><b>Round-trip preserves a {@code null} map value</b> -- a map that
 *       includes a {@code null} value (e.g. {@code {"date":"dd-MMM-yyyy",
 *       "enum":null}}) survives save + reload with the {@code null} key intact:
 *       NOT dropped, NOT coerced to a string. This is the load-bearing
 *       behaviour -- the {@code null} value carries the "no default" decision.</li>
 *   <li><b>Null-guarded PATCH apply</b> -- a later PATCH that OMITS
 *       {@code dataTypeDefaultsJson} (binds to {@code null}) MUST preserve the
 *       existing map; it must never clobber a previously-recorded set of
 *       defaults back to {@code null} (per
 *       {@code project_primitive_double_dto_overwrite.md}).</li>
 * </ol>
 *
 * <p>The H2 PostgreSQL-mode test DB uses the same {@code JSONB AS JSON} alias
 * trick already employed by {@code ApiBehaviourCaptureSessionCoverageSummaryTest}
 * / {@code ApiBehaviourPersistenceTest} so the {@code JsonType}-bound column
 * persists without standing up a real PostgreSQL.</p>
 *
 * <p>Spec: Capture data-type format defaults (2026-06-20) -- Task Group 1.</p>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:apibehaviourdatatypedefaultsdb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON",
    "app.features.include-database=true"
})
@Import(ApiBehaviourCaptureSessionService.class)
class ApiBehaviourCaptureSessionDataTypeDefaultsTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private ApiBehaviourCaptureSessionRepository repository;

    @Autowired
    private ApiBehaviourCaptureSessionService service;

    /**
     * A representative data-type-defaults map in the spec's shape: one category
     * with a concrete operator default and one category with an explicit
     * "no default" expressed as a {@code null} VALUE. {@link HashMap} (NOT
     * {@code Map.of}) is required because {@code Map.of} forbids null values.
     */
    private static Map<String, String> dataTypeDefaultsWithNull() {
        Map<String, String> m = new HashMap<>();
        m.put("date", "dd-MMM-yyyy");
        m.put("enum", null); // explicit "no default" -- MUST survive the round-trip
        return m;
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

    @Test
    @DisplayName("(a) PATCH that sets data_type_defaults_json round-trips a map with a null VALUE -- the null key is preserved (not dropped, not coerced)")
    void patchSetsDataTypeDefaultsAndNullValueRoundTrips() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();
        ApiBehaviourCaptureSessionEntity seed = seedDraftSession(projectId, architectureId);

        // Wizard "Data-type formats" PATCH: set the per-data-type defaults map,
        // including an explicit "no default" (null) for enum.
        ApiBehaviourCaptureSessionDto afterPatch = service.update(
            projectId, seed.getId(),
            new UpdateApiBehaviourCaptureSessionRequest(
                null, null, null, null, null,
                null, null, null, null,
                null,                   // mutatingCallsConfirmed
                null, null, null,       // startedAt / completedAt / errorMessage
                null, null,             // kind / sourceBaselineId
                null, null, null,       // scenarios attempted / completed / errored
                null,                   // scopeInterfaceIdsJson
                null, null, null,       // coverage-override trio
                null,                   // coverageSummaryJson
                dataTypeDefaultsWithNull() // dataTypeDefaultsJson
            )
        );

        Map<String, String> fromPatch = afterPatch.dataTypeDefaultsJson();
        assertThat(fromPatch)
            .as("PATCH response carries the data-type defaults map")
            .isNotNull();
        assertThat(fromPatch.get("date")).isEqualTo("dd-MMM-yyyy");
        assertThat(fromPatch)
            .as("the explicit 'no default' key survives as a null value (key present, value null)")
            .containsKey("enum");
        assertThat(fromPatch.get("enum"))
            .as("the 'no default' value is null, not coerced to a string")
            .isNull();
        entityManager.clear();

        // Reload the row directly and assert the null value survived the JSONB
        // round-trip into the persisted column.
        ApiBehaviourCaptureSessionEntity reloaded =
            repository.findById(seed.getId()).orElseThrow();
        Map<String, String> reloadedMap = reloaded.getDataTypeDefaultsJson();
        assertThat(reloadedMap).isNotNull();
        assertThat(reloadedMap.get("date")).isEqualTo("dd-MMM-yyyy");
        assertThat(reloadedMap)
            .as("reloaded column still carries the 'no default' key")
            .containsKey("enum");
        assertThat(reloadedMap.get("enum"))
            .as("reloaded 'no default' value is still null (the null was NOT dropped)")
            .isNull();
    }

    @Test
    @DisplayName("(b) null-guarded PATCH apply: a PATCH that omits dataTypeDefaultsJson MUST preserve the existing map (never clobbers to null)")
    void patchOmittingDataTypeDefaultsPreservesExisting() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();
        ApiBehaviourCaptureSessionEntity seed = seedDraftSession(projectId, architectureId);

        // PATCH #1: record the data-type defaults (with the null 'no default').
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
                null,
                dataTypeDefaultsWithNull()
            )
        );
        entityManager.clear();

        // PATCH #2: change only `name`; dataTypeDefaultsJson OMITTED (binds null).
        // Critical assertion: the existing map (incl. the null value) MUST survive.
        ApiBehaviourCaptureSessionDto afterPatch2 = service.update(
            projectId, seed.getId(),
            new UpdateApiBehaviourCaptureSessionRequest(
                "renamed",              // name -> change
                null, null, null, null,
                null, null, null, null,
                null, null, null, null,
                null, null,
                null, null, null,
                null,
                null, null, null,
                null,
                null                    // dataTypeDefaultsJson OMITTED
            )
        );
        assertThat(afterPatch2.name()).isEqualTo("renamed");
        assertThat(afterPatch2.dataTypeDefaultsJson())
            .as("PATCH #2 omitted dataTypeDefaultsJson -- existing map MUST be preserved")
            .isNotNull();
        assertThat(afterPatch2.dataTypeDefaultsJson().get("date")).isEqualTo("dd-MMM-yyyy");
        assertThat(afterPatch2.dataTypeDefaultsJson())
            .as("the preserved map still carries the explicit 'no default' key")
            .containsKey("enum");
        assertThat(afterPatch2.dataTypeDefaultsJson().get("enum")).isNull();
        entityManager.clear();

        // Verify by reloading the row directly.
        ApiBehaviourCaptureSessionEntity reloaded =
            repository.findById(seed.getId()).orElseThrow();
        assertThat(reloaded.getDataTypeDefaultsJson())
            .as("column still carries the defaults after the omitting PATCH")
            .isNotNull();
        assertThat(reloaded.getDataTypeDefaultsJson().get("date")).isEqualTo("dd-MMM-yyyy");
        assertThat(reloaded.getName()).isEqualTo("renamed");
    }
}
