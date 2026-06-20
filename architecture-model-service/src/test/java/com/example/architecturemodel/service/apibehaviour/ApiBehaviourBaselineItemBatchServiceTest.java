package com.example.architecturemodel.service.apibehaviour;

import com.example.architecturemodel.model.dto.apibehaviour.BatchCreateApiBehaviourBaselineItemsResponse;
import com.example.architecturemodel.model.dto.apibehaviour.CreateApiBehaviourBaselineItemRequest;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourBaselineItemEntity;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourBaselineItemRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Service-layer test for the best-effort, NON-atomic baseline-items batch
 * create ({@code ApiBehaviourBaselineItemService.createBatch}).
 *
 * <p>Spec: Baseline Save &amp; Review -- Batch + Activate + Table Detail +
 * Postman Export (2026-06-20) -- Task Group 1 (R1). Mirrors the H2
 * PostgreSQL-mode + {@code JSONB AS JSON} alias harness used by
 * {@code ApiBehaviourCaptureAcceptedNullableTest} so the entity's
 * {@code JsonType}-bound columns persist without a real PostgreSQL.</p>
 *
 * <p>Load-bearing behaviours under test:</p>
 * <ol>
 *   <li>A batch with a bad item persists ALL the valid items and returns one
 *       {@code failed[]} entry (index + capture_id + reason) for the bad item
 *       WITHOUT aborting the rest or rolling back the survivors.</li>
 *   <li>{@code create} still behaves identically after the {@code buildEntity}
 *       extraction (same row persisted; same validation exception).</li>
 *   <li>The per-call cap of 500 is enforced with an
 *       {@link IllegalArgumentException} (mapped to HTTP 400 by the global
 *       handler).</li>
 * </ol>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:apibehaviourbaselinebatchdb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON",
    "app.features.include-database=true"
})
@Import(ApiBehaviourBaselineItemService.class)
class ApiBehaviourBaselineItemBatchServiceTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private ApiBehaviourBaselineItemRepository repository;

    @Autowired
    private ApiBehaviourBaselineItemService service;

    /** A fully-valid create request for the given baseline. */
    private CreateApiBehaviourBaselineItemRequest validItem(UUID baselineId) {
        return new CreateApiBehaviourBaselineItemRequest(
            baselineId,
            UUID.randomUUID(),               // captureId
            UUID.randomUUID(),               // operationId
            UUID.randomUUID(),               // scenarioId
            "GET",                           // method
            "/widgets",                      // path
            "list widgets",                  // scenarioName
            Map.of("query", Map.of()),       // requestJson
            200,                             // responseStatus
            Map.of("body", Map.of()),        // responseJson
            null,                            // volatilePathsJson
            null                             // businessNotes
        );
    }

    @Test
    @DisplayName("createBatch persists every valid item and reports invalid ones in failed[] without aborting the rest")
    void createBatchIsBestEffortNonAtomic() {
        UUID baselineId = UUID.randomUUID();

        // Two valid items, one invalid (missing method) sandwiched in the middle,
        // and one more valid -- proving a bad item does NOT abort the later ones.
        CreateApiBehaviourBaselineItemRequest valid0 = validItem(baselineId);
        UUID badCaptureId = UUID.randomUUID();
        CreateApiBehaviourBaselineItemRequest bad1 = new CreateApiBehaviourBaselineItemRequest(
            baselineId,
            badCaptureId,                    // captureId carried into failed[]
            UUID.randomUUID(),
            UUID.randomUUID(),
            null,                            // method MISSING -> validation failure
            "/widgets",
            "bad scenario",
            Map.of("query", Map.of()),
            200,
            Map.of("body", Map.of()),
            null,
            null
        );
        CreateApiBehaviourBaselineItemRequest valid2 = validItem(baselineId);

        BatchCreateApiBehaviourBaselineItemsResponse response =
            service.createBatch(UUID.randomUUID(), List.of(valid0, bad1, valid2));
        entityManager.clear();

        // Survivors: both valid items persisted; the bad one did not.
        assertThat(response.created())
            .as("Both valid items must persist; the bad item must not abort them")
            .hasSize(2);
        assertThat(response.failed())
            .as("Exactly one failure recorded for the bad item")
            .hasSize(1);

        BatchCreateApiBehaviourBaselineItemsResponse.FailedItem failure =
            response.failed().get(0);
        assertThat(failure.index())
            .as("failed[] preserves the bad item's position in the submitted list")
            .isEqualTo(1);
        assertThat(failure.captureId())
            .as("failed[] preserves the bad item's capture_id for the UI warning")
            .isEqualTo(badCaptureId);
        assertThat(failure.reason())
            .as("failed[] carries the validation reason")
            .contains("method");

        // The persisted rows really exist for this baseline.
        List<ApiBehaviourBaselineItemEntity> persisted =
            repository.findByBaselineIdOrderByCreatedAtAsc(baselineId);
        assertThat(persisted)
            .as("Successes are durably committed despite the sibling failure")
            .hasSize(2);
    }

    @Test
    @DisplayName("create still behaves identically after the buildEntity extraction (persists a row; same validation)")
    void singleCreateStillPersistsAndValidates() {
        UUID baselineId = UUID.randomUUID();

        var created = service.create(validItem(baselineId));
        entityManager.clear();
        assertThat(repository.findById(created.id()))
            .as("Single create still persists exactly one row")
            .isPresent();

        // The extracted validation still throws the same message via create().
        assertThatThrownBy(() -> service.create(new CreateApiBehaviourBaselineItemRequest(
            baselineId, UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
            null, "/x", "s", Map.of(), 200, Map.of(), null, null)))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("method");
    }

    @Test
    @DisplayName("createBatch enforces the per-call cap of 500 with a clear IllegalArgumentException (HTTP 400)")
    void createBatchEnforcesCap() {
        UUID baselineId = UUID.randomUUID();
        List<CreateApiBehaviourBaselineItemRequest> overCap = new ArrayList<>();
        for (int i = 0; i < 501; i++) {
            overCap.add(validItem(baselineId));
        }

        assertThatThrownBy(() -> service.createBatch(UUID.randomUUID(), overCap))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("500");

        // Nothing was persisted -- the cap check fires before the loop.
        entityManager.clear();
        assertThat(repository.findByBaselineIdOrderByCreatedAtAsc(baselineId))
            .as("Over-cap request persists nothing")
            .isEmpty();
    }
}
