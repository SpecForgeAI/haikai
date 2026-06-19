package com.example.architecturemodel.service.apibehaviour;

import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourCaptureDto;
import com.example.architecturemodel.model.dto.apibehaviour.CreateApiBehaviourCaptureRequest;
import com.example.architecturemodel.model.dto.apibehaviour.UpdateApiBehaviourCaptureRequest;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourCaptureEntity;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourCaptureRepository;
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
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Service-layer test for the capture-review "Reviewer" column bug fix
 * (Spec: Capture-Review Reviewer Column Bug Fix, 2026-06-19).
 *
 * <p>BUG: a freshly-captured {@code api_behaviour_captures} row defaulted to
 * {@code accepted = FALSE}, so the capture-review "Reviewer" column rendered
 * the row as "rejected" before any human/auto review. The correct pre-review
 * state is UN-REVIEWED ({@code null} -&gt; blank in the UI), distinct from an
 * explicit reviewer rejection ({@code FALSE}).</p>
 *
 * <p>This test drives the real
 * {@code ApiBehaviourCaptureService.create(...)} / {@code update(...)} methods
 * against a real repository and asserts:</p>
 * <ol>
 *   <li>A create request that OMITS {@code accepted} persists {@code null}
 *       (un-reviewed) -- NOT {@code false}.</li>
 *   <li>A PATCH setting {@code accepted=true} then {@code accepted=false}
 *       still flips the column correctly.</li>
 *   <li>The save-as-baseline eligibility query
 *       ({@code findBySessionIdAndAcceptedTrueOrderByCapturedAtAsc}) treats a
 *       {@code null} (un-reviewed) row as NOT-accepted -- {@code null} never
 *       leaks into a baseline.</li>
 * </ol>
 *
 * <p>Mirrors {@code ApiBehaviourCaptureSessionMultiPatchTest}'s H2
 * PostgreSQL-mode + {@code JSONB AS JSON} alias harness so the entity's
 * {@code JsonType}-bound columns persist without a real PostgreSQL.</p>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:apibehaviourcaptureaccepteddb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON",
    "app.features.include-database=true"
})
@Import(ApiBehaviourCaptureService.class)
class ApiBehaviourCaptureAcceptedNullableTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private ApiBehaviourCaptureRepository repository;

    @Autowired
    private ApiBehaviourCaptureService service;

    private CreateApiBehaviourCaptureRequest createRequest(UUID sessionId, Boolean accepted) {
        return new CreateApiBehaviourCaptureRequest(
            sessionId,
            UUID.randomUUID(),  // scenarioId
            UUID.randomUUID(),  // operationId
            null,               // attemptNumber -> defaults to 1
            "GET",              // requestMethod
            "https://api.example.test/widgets",  // requestUrlRedacted
            "/widgets",         // requestPath
            null, null, null,   // request query/headers/body json
            200,                // responseStatus
            null, null,         // response headers/body json
            null,               // durationMs
            null, null,         // errorType / errorMessage
            null,               // capturedAt -> defaults to now()
            accepted,           // accepted (under test)
            null,               // acceptedAt
            null,               // reviewerNotes
            null                // volatilePathsJson
        );
    }

    @Test
    @DisplayName("create() without `accepted` persists NULL (un-reviewed), not FALSE")
    void createWithoutAcceptedPersistsNull() {
        UUID sessionId = UUID.randomUUID();

        ApiBehaviourCaptureDto created =
            service.create(createRequest(sessionId, null));
        entityManager.clear();

        assertThat(created.accepted())
            .as("A freshly-captured row must be un-reviewed (null), not false")
            .isNull();

        ApiBehaviourCaptureEntity reloaded =
            repository.findById(created.id()).orElseThrow();
        assertThat(reloaded.getAccepted())
            .as("Persisted accepted column must be NULL after a create that omits it")
            .isNull();
    }

    @Test
    @DisplayName("PATCH accepted=true then accepted=false still flips the column")
    void patchAcceptedTrueThenFalse() {
        UUID sessionId = UUID.randomUUID();

        ApiBehaviourCaptureDto created =
            service.create(createRequest(sessionId, null));
        assertThat(created.accepted()).isNull();
        entityManager.clear();

        // ---- PATCH #1: accept ----------------------------------------------
        ApiBehaviourCaptureDto accepted = service.update(
            created.id(),
            new UpdateApiBehaviourCaptureRequest(
                null, null, null, null,
                null, null, null,
                null, null, null,
                null, null, null, null,
                Boolean.TRUE,   // accepted -> TRUE
                null, null
            )
        );
        assertThat(accepted.accepted())
            .as("PATCH accepted=true must set the column TRUE")
            .isTrue();
        entityManager.clear();

        // ---- PATCH #2: reject ----------------------------------------------
        ApiBehaviourCaptureDto rejected = service.update(
            created.id(),
            new UpdateApiBehaviourCaptureRequest(
                null, null, null, null,
                null, null, null,
                null, null, null,
                null, null, null, null,
                Boolean.FALSE,  // accepted -> FALSE (explicit reject)
                null, null
            )
        );
        assertThat(rejected.accepted())
            .as("PATCH accepted=false must flip the column FALSE")
            .isFalse();

        ApiBehaviourCaptureEntity reloaded =
            repository.findById(created.id()).orElseThrow();
        assertThat(reloaded.getAccepted()).isFalse();
    }

    @Test
    @DisplayName("save-as-baseline eligibility query treats NULL (un-reviewed) as NOT-accepted")
    void acceptedTrueQueryExcludesUnreviewedNullRows() {
        UUID sessionId = UUID.randomUUID();

        // One un-reviewed (null) row, one explicitly rejected (false) row,
        // one accepted (true) row -- all in the same session.
        ApiBehaviourCaptureDto unreviewed =
            service.create(createRequest(sessionId, null));
        ApiBehaviourCaptureDto explicitlyRejected =
            service.create(createRequest(sessionId, Boolean.FALSE));
        ApiBehaviourCaptureDto acceptedRow =
            service.create(createRequest(sessionId, Boolean.TRUE));
        entityManager.clear();

        List<ApiBehaviourCaptureEntity> eligible =
            repository.findBySessionIdAndAcceptedTrueOrderByCapturedAtAsc(sessionId);

        assertThat(eligible)
            .as("Only the accepted=TRUE row is eligible; NULL and FALSE are excluded")
            .extracting(ApiBehaviourCaptureEntity::getId)
            .containsExactly(acceptedRow.id())
            .doesNotContain(unreviewed.id(), explicitlyRejected.id());
    }
}
