package com.example.architecturemodel.service.apibehaviour;

import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourCaptureDto;
import com.example.architecturemodel.model.dto.apibehaviour.BatchUpdateApiBehaviourCapturesRequest;
import com.example.architecturemodel.model.dto.apibehaviour.BatchUpdateApiBehaviourCapturesResponse;
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

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Service-layer test for the best-effort, NON-atomic captures batch PATCH
 * ({@code ApiBehaviourCaptureService.updateBatch}).
 *
 * <p>Spec: Baseline Save &amp; Review -- Batch + Activate + Table Detail +
 * Postman Export (2026-06-20) -- Task Group 1 (R1). Mirrors the H2
 * PostgreSQL-mode + {@code JSONB AS JSON} alias harness used by
 * {@code ApiBehaviourCaptureAcceptedNullableTest}.</p>
 *
 * <p>Load-bearing behaviours under test:</p>
 * <ol>
 *   <li>An "Accept All" batch applies the same accept patch per id, returning
 *       every row in {@code updated}.</li>
 *   <li>A "Reject All" batch sends a DISTINCT notes-preserving patch per id and
 *       each row keeps its OWN {@code reviewer_notes} mask -- the {@code {id,
 *       patch}} shape is what makes that possible.</li>
 *   <li>A batch with an unknown id records that id in {@code failed[]} and still
 *       applies the patches for the valid ids (best-effort, non-atomic).</li>
 *   <li>The per-call cap of 500 is enforced with an
 *       {@link IllegalArgumentException} (HTTP 400).</li>
 * </ol>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:apibehaviourcapturebatchdb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON",
    "app.features.include-database=true"
})
@Import(ApiBehaviourCaptureService.class)
class ApiBehaviourCaptureBatchServiceTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private ApiBehaviourCaptureRepository repository;

    @Autowired
    private ApiBehaviourCaptureService service;

    /** Seed an un-reviewed capture row and return its id. */
    private UUID seedCapture(UUID sessionId) {
        ApiBehaviourCaptureEntity seed = ApiBehaviourCaptureEntity.builder()
            .id(UUID.randomUUID())
            .sessionId(sessionId)
            .scenarioId(UUID.randomUUID())
            .operationId(UUID.randomUUID())
            .attemptNumber(1)
            .requestMethod("GET")
            .requestUrlRedacted("https://api.example.test/widgets")
            .requestPath("/widgets")
            .responseStatus(200)
            .capturedAt(Instant.now())
            .build();
        repository.saveAndFlush(seed);
        return seed.getId();
    }

    /** The accept patch Accept-All sends per id. */
    private UpdateApiBehaviourCaptureRequest acceptPatch() {
        return new UpdateApiBehaviourCaptureRequest(
            null, null, null, null,
            null, null, null,
            null, null, null,
            null, null, null, null,
            Boolean.TRUE,        // accepted
            Instant.now(),       // acceptedAt
            null                 // reviewerNotes
        );
    }

    /** A reject patch carrying THIS row's own notes mask. */
    private UpdateApiBehaviourCaptureRequest rejectPatch(String notes) {
        return new UpdateApiBehaviourCaptureRequest(
            null, null, null, null,
            null, null, null,
            null, null, null,
            null, null, null, null,
            Boolean.FALSE,       // accepted
            null,                // acceptedAt cleared
            notes                // per-row reviewer_notes mask
        );
    }

    @Test
    @DisplayName("updateBatch Accept-All applies the same accept patch per id and returns every row in updated[]")
    void acceptAllBatchUpdatesEveryRow() {
        UUID sessionId = UUID.randomUUID();
        UUID id0 = seedCapture(sessionId);
        UUID id1 = seedCapture(sessionId);
        entityManager.clear();

        BatchUpdateApiBehaviourCapturesResponse response = service.updateBatch(
            UUID.randomUUID(),
            List.of(
                new BatchUpdateApiBehaviourCapturesRequest.ItemPatch(id0, acceptPatch()),
                new BatchUpdateApiBehaviourCapturesRequest.ItemPatch(id1, acceptPatch())
            ));
        entityManager.clear();

        assertThat(response.failed()).isEmpty();
        assertThat(response.updated())
            .extracting(ApiBehaviourCaptureDto::id)
            .containsExactlyInAnyOrder(id0, id1);
        assertThat(response.updated())
            .allSatisfy(dto -> assertThat(dto.accepted()).isTrue());

        assertThat(repository.findById(id0).orElseThrow().getAccepted()).isTrue();
        assertThat(repository.findById(id1).orElseThrow().getAccepted()).isTrue();
    }

    @Test
    @DisplayName("updateBatch Reject-All preserves each row's own reviewer_notes mask (per-{id,patch} shape)")
    void rejectAllBatchPreservesPerRowNotes() {
        UUID sessionId = UUID.randomUUID();
        UUID id0 = seedCapture(sessionId);
        UUID id1 = seedCapture(sessionId);
        entityManager.clear();

        BatchUpdateApiBehaviourCapturesResponse response = service.updateBatch(
            UUID.randomUUID(),
            List.of(
                new BatchUpdateApiBehaviourCapturesRequest.ItemPatch(id0, rejectPatch("notes-for-0")),
                new BatchUpdateApiBehaviourCapturesRequest.ItemPatch(id1, rejectPatch("notes-for-1"))
            ));
        entityManager.clear();

        assertThat(response.failed()).isEmpty();
        assertThat(response.updated()).hasSize(2);

        ApiBehaviourCaptureEntity row0 = repository.findById(id0).orElseThrow();
        ApiBehaviourCaptureEntity row1 = repository.findById(id1).orElseThrow();
        assertThat(row0.getAccepted()).isFalse();
        assertThat(row1.getAccepted()).isFalse();
        assertThat(row0.getReviewerNotes())
            .as("Row 0 keeps ITS OWN mask, not row 1's")
            .isEqualTo("notes-for-0");
        assertThat(row1.getReviewerNotes())
            .as("Row 1 keeps ITS OWN mask, not row 0's")
            .isEqualTo("notes-for-1");
    }

    @Test
    @DisplayName("updateBatch is best-effort: an unknown id lands in failed[] while valid ids still patch")
    void unknownIdRecordedInFailedRestStillApplied() {
        UUID sessionId = UUID.randomUUID();
        UUID good = seedCapture(sessionId);
        UUID missing = UUID.randomUUID();   // never seeded
        entityManager.clear();

        BatchUpdateApiBehaviourCapturesResponse response = service.updateBatch(
            UUID.randomUUID(),
            List.of(
                new BatchUpdateApiBehaviourCapturesRequest.ItemPatch(good, acceptPatch()),
                new BatchUpdateApiBehaviourCapturesRequest.ItemPatch(missing, acceptPatch())
            ));
        entityManager.clear();

        assertThat(response.updated())
            .extracting(ApiBehaviourCaptureDto::id)
            .containsExactly(good);
        assertThat(response.failed()).hasSize(1);
        assertThat(response.failed().get(0).id())
            .as("failed[] preserves the unknown capture id")
            .isEqualTo(missing);
        assertThat(response.failed().get(0).reason())
            .as("failed[] carries the not-found reason")
            .isNotBlank();

        // The valid row was committed despite the sibling failure.
        assertThat(repository.findById(good).orElseThrow().getAccepted()).isTrue();
    }

    @Test
    @DisplayName("updateBatch enforces the per-call cap of 500 with a clear IllegalArgumentException (HTTP 400)")
    void updateBatchEnforcesCap() {
        UUID sessionId = UUID.randomUUID();
        UUID id = seedCapture(sessionId);
        entityManager.clear();

        List<BatchUpdateApiBehaviourCapturesRequest.ItemPatch> overCap = new ArrayList<>();
        for (int i = 0; i < 501; i++) {
            overCap.add(new BatchUpdateApiBehaviourCapturesRequest.ItemPatch(id, acceptPatch()));
        }

        assertThatThrownBy(() -> service.updateBatch(UUID.randomUUID(), overCap))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("500");

        // The cap check fires before any patch is applied.
        entityManager.clear();
        assertThat(repository.findById(id).orElseThrow().getAccepted())
            .as("Over-cap request applies nothing")
            .isNull();
    }
}
