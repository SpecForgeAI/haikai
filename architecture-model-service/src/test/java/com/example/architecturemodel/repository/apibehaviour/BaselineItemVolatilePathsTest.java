package com.example.architecturemodel.repository.apibehaviour;

import com.example.architecturemodel.mapper.apibehaviour.ApiBehaviourMapper;
import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourBaselineItemDto;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourBaselineItemEntity;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
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
 * Task Group 1.1 tests for the new {@code volatile_paths_json} volatility
 * envelope on {@code api_behaviour_baseline_items} (Reconcile-Time Determinism
 * &amp; Volatile-Value Handling, 2026-06-16 -- Task Group 1).
 *
 * <p>Mirrors the {@code ApiBehaviourPersistenceTest} harness (the
 * {@code @DataJpaTest} + H2 PostgreSQL-mode + {@code CREATE DOMAIN JSONB AS
 * JSON} idiom) for the JPA-mapping round-trip, and the
 * {@code MigrationReconciliationBreakLiquibaseSmokeTest} static-text idiom for
 * the changeset 187 + master-registration check. It does NOT re-test the other
 * baseline-item columns.</p>
 *
 * <p>Focused tests (3 -- within the 2-8 budget per task 1.1):</p>
 * <ol>
 *   <li>the {@code volatile_paths_json} JSONB envelope round-trips through the
 *       JPA mapping AND the {@code toDto} converter ({@code { paths,
 *       volatility_source, k }} survives), proving the column applied;</li>
 *   <li>a {@code null} envelope round-trips as {@code null} (the
 *       strict-comparison backward-compatible default; distinguishable from a
 *       {@code non_json} envelope);</li>
 *   <li>changeset 187 adds {@code volatile_paths_json jsonb NULL} with a
 *       {@code not.columnExists} precondition (idempotent re-run) and is
 *       registered AFTER 186 with 186 untouched.</li>
 * </ol>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:baselinevolatiledb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
})
class BaselineItemVolatilePathsTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private ApiBehaviourBaselineItemRepository baselineItemRepository;

    private static ApiBehaviourBaselineItemEntity.ApiBehaviourBaselineItemEntityBuilder baseItem() {
        return ApiBehaviourBaselineItemEntity.builder()
            .id(UUID.randomUUID())
            .baselineId(UUID.randomUUID())
            .captureId(UUID.randomUUID())
            .operationId(UUID.randomUUID())
            .scenarioId(UUID.randomUUID())
            .method("GET")
            .path("/widgets")
            .scenarioName("happy")
            .requestJson(Map.of("query", Map.of("limit", 10)))
            .responseStatus(200)
            .responseJson(Map.of("items", List.of(Map.of("id", "w1"))));
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
    @DisplayName("volatile_paths_json envelope { paths, volatility_source, k } round-trips through JSONB + toDto")
    void volatilePathsEnvelopeRoundTrips() {
        // The probe-shaped envelope: a differing leaf + a flagged array, the
        // taxonomy tag, and the completed-repeat count.
        Map<String, Object> envelope = new LinkedHashMap<>();
        envelope.put("paths", List.of("/createdAt", "/items"));
        envelope.put("volatility_source", "probed");
        envelope.put("k", 3);

        ApiBehaviourBaselineItemEntity item = baseItem()
            .volatilePathsJson(envelope)
            .build();
        baselineItemRepository.saveAndFlush(item);
        entityManager.clear();

        ApiBehaviourBaselineItemEntity reloaded = baselineItemRepository
            .findById(item.getId()).orElseThrow();
        assertThat(reloaded.getVolatilePathsJson())
            .as("the volatility envelope survives the JSONB round-trip without data loss")
            .containsEntry("volatility_source", "probed")
            .containsEntry("k", 3);
        assertThat(reloaded.getVolatilePathsJson().get("paths"))
            .as("the normalised JSON-Pointer path list survives as a list")
            .isInstanceOf(List.class);

        // The DTO surfaces the same envelope (snake_case wire field name
        // volatile_paths_json -> volatilePathsJson record component).
        ApiBehaviourBaselineItemDto dto = ApiBehaviourMapper.toDto(reloaded);
        assertThat(dto.volatilePathsJson())
            .as("toDto surfaces the envelope on the DTO")
            .containsEntry("volatility_source", "probed")
            .containsEntry("k", 3);
    }

    @Test
    @DisplayName("a null volatile_paths_json round-trips as null (strict-comparison backward-compatible default)")
    void nullVolatilePathsRoundTripsAsNull() {
        // No volatility recorded -> the column is left null (today's behaviour,
        // and the state of every already-pinned baseline -- no backfill).
        ApiBehaviourBaselineItemEntity item = baseItem().build();
        baselineItemRepository.saveAndFlush(item);
        entityManager.clear();

        ApiBehaviourBaselineItemEntity reloaded = baselineItemRepository
            .findById(item.getId()).orElseThrow();
        assertThat(reloaded.getVolatilePathsJson())
            .as("null means no volatility recorded -> strict comparison")
            .isNull();

        ApiBehaviourBaselineItemDto dto = ApiBehaviourMapper.toDto(reloaded);
        assertThat(dto.volatilePathsJson())
            .as("null round-trips as null on the DTO too")
            .isNull();
    }

    @Test
    @DisplayName("changeset 187 adds volatile_paths_json jsonb NULL with a not.columnExists precondition, registered AFTER 186 (186 untouched)")
    void changeset187DeclaresVolatilePathsColumn() throws Exception {
        String sql = readClasspathResource(
            "db/changelog/sql/187-baseline-item-volatile-paths.sql");

        assertThat(sql)
            .as("187 adds the nullable JSONB column to the baseline items table")
            .contains("ALTER TABLE api_behaviour_baseline_items ADD COLUMN volatile_paths_json jsonb NULL");

        String master = readClasspathResource("db/changelog/db.changelog-master.yaml");

        // 187 registered with its sqlFile path + the not.columnExists precondition idiom.
        assertThat(master)
            .as("changeset 187 must be registered with its sqlFile path")
            .contains("id: 187-baseline-item-volatile-paths")
            .contains("db/changelog/sql/187-baseline-item-volatile-paths.sql");
        assertThat(master)
            .as("the not.columnExists precondition makes the re-run idempotent")
            .contains("columnName: volatile_paths_json")
            .contains("tableName: api_behaviour_baseline_items");

        // 186 (the previous highest) must still be present and registered BEFORE 187.
        assertThat(master)
            .as("changeset 186 anchor must still be present -- verifies we did not edit it")
            .contains("id: 186-work-item-provenance")
            .contains("db/changelog/sql/186-work-item-provenance.sql");
        int idx186 = master.indexOf("id: 186-work-item-provenance");
        int idx187 = master.indexOf("id: 187-baseline-item-volatile-paths");
        assertThat(idx186).isGreaterThan(-1);
        assertThat(idx187)
            .as("changeset 187 must be registered AFTER 186")
            .isGreaterThan(idx186);
    }
}
