package com.example.architecturemodel.repository.apibehaviour;

import com.example.architecturemodel.mapper.apibehaviour.ApiBehaviourMapper;
import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourBaselineItemDto;
import com.example.architecturemodel.model.dto.apibehaviour.CreateApiBehaviourBaselineItemRequest;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourBaselineItemEntity;
import com.example.architecturemodel.service.apibehaviour.ApiBehaviourBaselineItemService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Task Group 1.1 tests for the new {@code sequence_json} pinned-chain column on
 * {@code api_behaviour_baseline_items} (Stateful Sequence Scenarios, 2026-06-18
 * — Task Group 1). Mirrors {@link BaselineItemVolatilePathsTest} (the
 * {@code @DataJpaTest} + H2 PostgreSQL-mode + {@code CREATE DOMAIN JSONB AS
 * JSON} idiom + the static-text changeset check).
 *
 * <p>Focused tests (within the 2-8 budget per task 1.1):</p>
 * <ol>
 *   <li>a {@code sequence_json} created via the real
 *       {@link ApiBehaviourBaselineItemService#create} round-trips through the
 *       JPA mapping and {@code toDto} intact (write-once at create, like
 *       {@code volatile_paths_json});</li>
 *   <li>a single-shot create (no {@code sequenceJson}) round-trips as
 *       {@code null} — today's behaviour, zero regression;</li>
 *   <li>changeset 192 adds {@code sequence_json jsonb NULL} with a
 *       {@code not.columnExists} precondition and is registered AFTER 191 (191
 *       untouched).</li>
 * </ol>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:baselinesequencedb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON",
    "app.features.include-database=true"
})
@Import(ApiBehaviourBaselineItemService.class)
class BaselineItemSequenceTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private ApiBehaviourBaselineItemRepository baselineItemRepository;

    @Autowired
    private ApiBehaviourBaselineItemService service;

    private static Map<String, Object> sampleSequence() {
        // The R1/R2 shape: one setup step (POST creating a filter) -> the act
        // step (submitForReview) referencing the setup's generated id via $0.id.
        Map<String, Object> setup = new LinkedHashMap<>();
        setup.put("index", 0);
        setup.put("role", "setup");
        setup.put("kind", "http");
        setup.put("request", Map.of("method", "POST", "path", "/filters",
            "body", Map.of("name", "draft")));
        setup.put("expected_status", 201);
        setup.put("response_refs", List.of());

        Map<String, Object> ref = new LinkedHashMap<>();
        ref.put("ref", "$0.id");
        ref.put("from_step", 0);
        ref.put("json_path", "id");

        Map<String, Object> act = new LinkedHashMap<>();
        act.put("index", 1);
        act.put("role", "act");
        act.put("kind", "http");
        act.put("request", Map.of("method", "POST", "path", "/filters/$0.id/submitForReview"));
        act.put("expected_status", 200);
        act.put("response_refs", List.of(ref));

        Map<String, Object> sequence = new LinkedHashMap<>();
        sequence.put("steps", List.of(setup, act));
        sequence.put("act_step_index", 1);
        sequence.put("cleanup_best_effort", true);
        return sequence;
    }

    private static CreateApiBehaviourBaselineItemRequest createRequest(Map<String, Object> sequenceJson) {
        return new CreateApiBehaviourBaselineItemRequest(
            UUID.randomUUID(), // baselineId
            UUID.randomUUID(), // captureId
            UUID.randomUUID(), // operationId
            UUID.randomUUID(), // scenarioId
            "POST",
            "/filters/{id}/submitForReview",
            "submit-for-review-needs-private-filter",
            Map.of("body", Map.of("name", "draft")),
            200,
            Map.of("headers", Map.of("content-type", "application/json"),
                   "body", Map.of("status", "in_review")),
            null,          // volatilePathsJson
            sequenceJson,  // sequenceJson (canonical 13-arg ctor)
            "needs a private un-promoted filter to exist first");
    }

    private String readClasspathResource(String path) throws Exception {
        try (var stream = Objects.requireNonNull(
            getClass().getClassLoader().getResourceAsStream(path),
            "missing classpath resource: " + path);
             var reader = new BufferedReader(
                 new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line).append('\n');
            }
            return sb.toString();
        }
    }

    @Test
    @DisplayName("(a) sequence_json created via service.create round-trips through JSONB + toDto intact (write-once at create)")
    void sequenceJsonRoundTripsThroughCreateAndDto() {
        ApiBehaviourBaselineItemDto created = service.create(createRequest(sampleSequence()));
        entityManager.clear();

        // create -> DTO carries the assembled sequence
        assertThat(created.sequenceJson())
            .as("create surfaces sequence_json on the DTO")
            .isNotNull()
            .containsEntry("act_step_index", 1)
            .containsEntry("cleanup_best_effort", true);
        assertThat(created.sequenceJson().get("steps"))
            .as("the ordered step list survives")
            .isInstanceOf(List.class);

        // entity round-trip: the column applied + JSONB persisted the chain
        ApiBehaviourBaselineItemEntity reloaded = baselineItemRepository
            .findById(created.id()).orElseThrow();
        assertThat(reloaded.getSequenceJson())
            .as("sequence_json survives the JSONB round-trip without data loss")
            .containsEntry("act_step_index", 1)
            .containsEntry("cleanup_best_effort", true);

        // toDto surfaces the same chain (snake_case wire field sequence_json)
        ApiBehaviourBaselineItemDto dto = ApiBehaviourMapper.toDto(reloaded);
        assertThat(dto.sequenceJson())
            .as("toDto surfaces sequence_json on the DTO")
            .containsEntry("act_step_index", 1);
    }

    @Test
    @DisplayName("(a2) a single-shot create (no sequenceJson) round-trips as null — today's behaviour, zero regression")
    void singleShotCreateRoundTripsAsNull() {
        // The backward-compatible 12-arg delegating ctor: no sequenceJson.
        CreateApiBehaviourBaselineItemRequest singleShot = new CreateApiBehaviourBaselineItemRequest(
            UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
            "GET", "/widgets", "happy",
            Map.of("query", Map.of("limit", 10)),
            200,
            Map.of("items", List.of(Map.of("id", "w1"))),
            null,   // volatilePathsJson
            "noted");

        ApiBehaviourBaselineItemDto created = service.create(singleShot);
        entityManager.clear();

        assertThat(created.sequenceJson())
            .as("a single-shot item has a null sequence_json")
            .isNull();

        ApiBehaviourBaselineItemEntity reloaded = baselineItemRepository
            .findById(created.id()).orElseThrow();
        assertThat(reloaded.getSequenceJson())
            .as("null round-trips as null (single-shot path unchanged)")
            .isNull();
        assertThat(ApiBehaviourMapper.toDto(reloaded).sequenceJson()).isNull();
    }

    @Test
    @DisplayName("(d-changeset) changeset 192 adds sequence_json jsonb NULL with a not.columnExists precondition, registered AFTER 191 (191 untouched)")
    void changeset192DeclaresSequenceColumn() throws Exception {
        String sql = readClasspathResource(
            "db/changelog/sql/192-baseline-item-sequence.sql");
        assertThat(sql)
            .as("192 adds the nullable JSONB column to the baseline items table")
            .contains("ALTER TABLE api_behaviour_baseline_items ADD COLUMN sequence_json jsonb NULL");

        String master = readClasspathResource("db/changelog/db.changelog-master.yaml");
        assertThat(master)
            .as("changeset 192 must be registered with its sqlFile path")
            .contains("id: 192-baseline-item-sequence")
            .contains("db/changelog/sql/192-baseline-item-sequence.sql");
        assertThat(master)
            .as("the not.columnExists precondition makes the re-run idempotent")
            .contains("columnName: sequence_json")
            .contains("tableName: api_behaviour_baseline_items");

        // 191 (the previous highest) must still be present and registered BEFORE 192.
        assertThat(master)
            .as("changeset 191 anchor must still be present — verifies we did not edit it")
            .contains("id: 191-baseline-content-hash-provenance")
            .contains("db/changelog/sql/191-baseline-content-hash-provenance.sql");
        int idx191 = master.indexOf("id: 191-baseline-content-hash-provenance");
        int idx192 = master.indexOf("id: 192-baseline-item-sequence");
        assertThat(idx191).isGreaterThan(-1);
        assertThat(idx192)
            .as("changeset 192 must be registered AFTER 191")
            .isGreaterThan(idx191);
    }
}
