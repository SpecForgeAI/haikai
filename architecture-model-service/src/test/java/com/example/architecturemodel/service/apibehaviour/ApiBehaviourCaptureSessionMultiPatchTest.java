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

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Multi-PATCH integration test for {@code ApiBehaviourCaptureSessionService}
 * (Task Group 11.3 gap-fill #3).
 *
 * <p>Spec: 2026-05-15 API Behaviour Baseline Capture Service — Task Group 11.</p>
 *
 * <p>Why this test exists in addition to the existing per-group coverage:</p>
 * <ul>
 *   <li>{@code ApiBehaviourPersistenceTest#mutatingCallsConfirmedBoxedBooleanRoundTrips}
 *       proves the column round-trips both {@code true} and {@code false} at
 *       the JPA layer.</li>
 *   <li>{@code ApiBehaviourControllerTest#patchPreservesBoxedBooleanWhenOmitted}
 *       proves the controller binds an omitted JSON key to {@code null} on the
 *       DTO and forwards it to a mocked service.</li>
 *   <li><b>This test</b> closes the loop: it drives the real
 *       {@code ApiBehaviourCaptureSessionService.update(...)} method against a
 *       real repository through a <b>multi-PATCH cycle</b> and asserts the
 *       boxed-{@link Boolean} {@code mutatingCallsConfirmed} value is
 *       preserved across an intermediate PATCH that omits it. This is the
 *       direct service-layer test for the lesson in
 *       {@code project_primitive_double_dto_overwrite.md}.</li>
 * </ul>
 *
 * <p>The test scenario:</p>
 * <ol>
 *   <li>PATCH #1: set {@code mutatingCallsConfirmed=true} (session is in
 *       {@code draft} so the field is editable).</li>
 *   <li>PATCH #2: change only {@code name} — the {@code mutatingCallsConfirmed}
 *       column MUST stay {@code true}. If the DTO had used a primitive
 *       boolean, this is where the column would silently flip to
 *       {@code false}.</li>
 *   <li>PATCH #3: set {@code mutatingCallsConfirmed=false} explicitly. The
 *       session is still in {@code draft}, so this is allowed and the column
 *       MUST flip to {@code false}.</li>
 * </ol>
 *
 * <p>The H2 PostgreSQL-mode test DB uses the same {@code JSONB AS JSON} alias
 * trick already employed by {@code ApiBehaviourPersistenceTest} — this lets
 * the entity's {@code JsonType}-bound columns persist without standing up a
 * real PostgreSQL.</p>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:apibehaviourpatchdb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON",
    "app.features.include-database=true"
})
@Import(ApiBehaviourCaptureSessionService.class)
class ApiBehaviourCaptureSessionMultiPatchTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private ApiBehaviourCaptureSessionRepository repository;

    @Autowired
    private ApiBehaviourCaptureSessionService service;

    @Test
    @DisplayName("Multi-PATCH cycle preserves mutatingCallsConfirmed when omitted, and flips it when explicitly provided (boxed-Boolean PATCH semantics)")
    void multiPatchPreservesBoxedBoolean() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();

        // Seed: a draft session with mutating_calls_confirmed=false (default).
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

        // ---- PATCH #1: flip mutating_calls_confirmed to TRUE ----------------
        ApiBehaviourCaptureSessionDto afterPatch1 = service.update(
            projectId, seed.getId(),
            new UpdateApiBehaviourCaptureSessionRequest(
                null,             // name
                null,             // status
                null,             // environmentName
                null,             // apiBaseUrl
                null,             // authType
                null, null, null, null,
                Boolean.TRUE,     // mutatingCallsConfirmed -> flip ON
                null, null, null
            )
        );
        assertThat(afterPatch1.mutatingCallsConfirmed())
            .as("After PATCH #1 the column must be TRUE")
            .isTrue();
        assertThat(afterPatch1.name())
            .as("Name was not touched and must still be 'seed'")
            .isEqualTo("seed");
        entityManager.clear();

        // ---- PATCH #2: change only `name` -- mutating_calls_confirmed OMITTED
        // This is the critical assertion: a PATCH that omits the boxed-Boolean
        // field MUST preserve the existing TRUE value. If the DTO had used a
        // primitive boolean (or the service skipped its null-guard), this
        // is where the column would silently flip back to FALSE.
        ApiBehaviourCaptureSessionDto afterPatch2 = service.update(
            projectId, seed.getId(),
            new UpdateApiBehaviourCaptureSessionRequest(
                "renamed",        // name -> change
                null,             // status
                null,             // environmentName
                null,             // apiBaseUrl
                null,             // authType
                null, null, null, null,
                null,             // mutatingCallsConfirmed OMITTED
                null, null, null
            )
        );
        assertThat(afterPatch2.name())
            .as("Name was changed by PATCH #2")
            .isEqualTo("renamed");
        assertThat(afterPatch2.mutatingCallsConfirmed())
            .as("PATCH #2 omitted mutatingCallsConfirmed -- column MUST stay TRUE (boxed-Boolean PATCH semantic)")
            .isTrue();
        entityManager.clear();

        // ---- PATCH #3: explicitly set mutatingCallsConfirmed FALSE ----------
        // The session is still in `draft`, so the mutating-confirmation lock
        // is not engaged; the explicit flip must take effect.
        ApiBehaviourCaptureSessionDto afterPatch3 = service.update(
            projectId, seed.getId(),
            new UpdateApiBehaviourCaptureSessionRequest(
                null,
                null,
                null,
                null,
                null,
                null, null, null, null,
                Boolean.FALSE,    // explicit flip OFF
                null, null, null
            )
        );
        assertThat(afterPatch3.mutatingCallsConfirmed())
            .as("Explicit FALSE in PATCH #3 must flip the column")
            .isFalse();
        // Name persisted from PATCH #2 untouched.
        assertThat(afterPatch3.name()).isEqualTo("renamed");

        // ---- Verify by reloading the row directly ---------------------------
        ApiBehaviourCaptureSessionEntity reloaded =
            repository.findById(seed.getId()).orElseThrow();
        assertThat(reloaded.getMutatingCallsConfirmed()).isFalse();
        assertThat(reloaded.getName()).isEqualTo("renamed");
        assertThat(reloaded.getStatus()).isEqualTo("draft");
    }
}
