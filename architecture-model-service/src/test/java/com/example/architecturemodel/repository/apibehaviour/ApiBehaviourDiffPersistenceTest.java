package com.example.architecturemodel.repository.apibehaviour;

import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourDiffEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourDiffItemEntity;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.core.io.ClassPathResource;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.util.StreamUtils;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Persistence-layer slice tests for {@link ApiBehaviourDiffEntity} +
 * {@link ApiBehaviourDiffItemEntity} from Task Group 1 of the API Test
 * Harness — Diff Engine spec (2026-05-25).
 *
 * <p>Covers:</p>
 * <ol>
 *   <li>Round-trip on diff + diff-item entities; verifies all fields
 *       (including the JSONB-mapped {@code body_diff_json}) persist and
 *       reload intact.</li>
 *   <li>Finders: {@code findByTargetBaselineId} returns the diff for that
 *       target; {@code findBySourceBaselineId} returns the list (one source
 *       can have many targets).</li>
 *   <li>Diff-item ordering: {@code findByDiffIdOrderByMethodAscPathAsc}
 *       returns items in deterministic (method, path) order.</li>
 *   <li>Unique-pair constraint:
 *       {@code (source_baseline_id, target_baseline_id)} cannot be
 *       duplicated.</li>
 *   <li>Liquibase changeset 158 declares ON DELETE CASCADE on both
 *       source_baseline_id and target_baseline_id; changeset 159 declares
 *       ON DELETE CASCADE on diff_id. Verified via Liquibase SQL text
 *       inspection (the H2 test DB schema is Hibernate-generated and does
 *       not honour FK actions expressed in Liquibase). Same pattern used
 *       by {@code ApiBehaviourPersistenceTest}.</li>
 * </ol>
 *
 * <p>Uses the same H2-in-PostgreSQL-compat-mode pattern as
 * {@code ApiBehaviourKindAndPairingPersistenceTest} -- {@code JSONB} is
 * registered as a domain alias for {@code JSON} so the JsonType binding
 * round-trips.</p>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:apibehaviourdiffdb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
})
class ApiBehaviourDiffPersistenceTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private ApiBehaviourDiffRepository diffRepository;

    @Autowired
    private ApiBehaviourDiffItemRepository diffItemRepository;

    private ApiBehaviourDiffEntity newDiff(UUID projectId, UUID architectureId,
                                            UUID sourceBaselineId, UUID targetBaselineId,
                                            String status) {
        return ApiBehaviourDiffEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .architectureId(architectureId)
            .sourceBaselineId(sourceBaselineId)
            .targetBaselineId(targetBaselineId)
            .status(status)
            .build();
    }

    private ApiBehaviourDiffItemEntity newDiffItem(UUID diffId, String method, String path,
                                                    String scenarioName,
                                                    String statusClassification,
                                                    String bodyClassification,
                                                    Integer sourceStatus, Integer targetStatus,
                                                    Map<String, Object> bodyDiffJson,
                                                    String notes) {
        return ApiBehaviourDiffItemEntity.builder()
            .id(UUID.randomUUID())
            .diffId(diffId)
            .method(method)
            .path(path)
            .scenarioName(scenarioName)
            .statusClassification(statusClassification)
            .bodyClassification(bodyClassification)
            .sourceResponseStatus(sourceStatus)
            .targetResponseStatus(targetStatus)
            .bodyDiffJson(bodyDiffJson)
            .notes(notes)
            .build();
    }

    @Test
    @DisplayName("Diff + diff-item round-trip: all fields including the JSONB body_diff_json persist and reload intact")
    void diffAndDiffItemRoundTrip() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();
        UUID sourceBaselineId = UUID.randomUUID();
        UUID targetBaselineId = UUID.randomUUID();

        ApiBehaviourDiffEntity diff = newDiff(projectId, architectureId,
            sourceBaselineId, targetBaselineId, "completed");
        diff.setMatchedCount(3);
        diff.setStatusDriftCount(1);
        diff.setBodyShapeDriftCount(1);
        diff.setBodyValueDriftCount(0);
        diff.setSourceOnlyCount(2);
        diff.setTargetOnlyCount(0);
        Instant computedAt = Instant.parse("2026-05-25T10:00:00Z");
        diff.setComputedAt(computedAt);
        diff.setSourceBaselineUpdatedAt(Instant.parse("2026-05-25T09:30:00Z"));
        diff.setTargetBaselineUpdatedAt(Instant.parse("2026-05-25T09:55:00Z"));
        diffRepository.saveAndFlush(diff);

        // Diff item with a populated body_diff_json (JSONB round-trip is the
        // non-trivial mapping here).
        Map<String, Object> bodyDiff = new HashMap<>();
        bodyDiff.put("/user/name", Map.of(
            "kind", "value_changed",
            "source", "alice",
            "target", "alicia"));
        bodyDiff.put("/user/email", Map.of(
            "kind", "key_added",
            "target", "alicia@example.com"));

        ApiBehaviourDiffItemEntity item = newDiffItem(
            diff.getId(), "GET", "/users/1", "happy-path",
            "status_match", "body_value_drift",
            200, 200,
            bodyDiff,
            null);
        diffItemRepository.saveAndFlush(item);

        entityManager.clear();

        // Reload diff -- assert every field round-trips.
        ApiBehaviourDiffEntity reloadedDiff = diffRepository.findById(diff.getId()).orElseThrow();
        assertThat(reloadedDiff.getProjectId()).isEqualTo(projectId);
        assertThat(reloadedDiff.getArchitectureId()).isEqualTo(architectureId);
        assertThat(reloadedDiff.getSourceBaselineId()).isEqualTo(sourceBaselineId);
        assertThat(reloadedDiff.getTargetBaselineId()).isEqualTo(targetBaselineId);
        assertThat(reloadedDiff.getStatus()).isEqualTo("completed");
        // All 6 count fields are BOXED Integer (not primitive int).
        assertThat(reloadedDiff.getMatchedCount()).isEqualTo(3);
        assertThat(reloadedDiff.getStatusDriftCount()).isEqualTo(1);
        assertThat(reloadedDiff.getBodyShapeDriftCount()).isEqualTo(1);
        assertThat(reloadedDiff.getBodyValueDriftCount()).isEqualTo(0);
        assertThat(reloadedDiff.getSourceOnlyCount()).isEqualTo(2);
        assertThat(reloadedDiff.getTargetOnlyCount()).isEqualTo(0);
        assertThat(reloadedDiff.getComputedAt()).isEqualTo(computedAt);
        assertThat(reloadedDiff.getCreatedAt()).isNotNull();
        assertThat(reloadedDiff.getUpdatedAt()).isNotNull();

        // Reload diff-item -- assert the JSONB body_diff_json survives.
        ApiBehaviourDiffItemEntity reloadedItem =
            diffItemRepository.findById(item.getId()).orElseThrow();
        assertThat(reloadedItem.getDiffId()).isEqualTo(diff.getId());
        assertThat(reloadedItem.getMethod()).isEqualTo("GET");
        assertThat(reloadedItem.getPath()).isEqualTo("/users/1");
        assertThat(reloadedItem.getScenarioName()).isEqualTo("happy-path");
        assertThat(reloadedItem.getStatusClassification()).isEqualTo("status_match");
        assertThat(reloadedItem.getBodyClassification()).isEqualTo("body_value_drift");
        // Boxed Integer round-trip (project_primitive_double_dto_overwrite.md
        // contract).
        assertThat(reloadedItem.getSourceResponseStatus()).isEqualTo(200);
        assertThat(reloadedItem.getTargetResponseStatus()).isEqualTo(200);
        assertThat(reloadedItem.getBodyDiffJson()).isNotNull();
        @SuppressWarnings("unchecked")
        Map<String, Object> reloadedNameDiff =
            (Map<String, Object>) reloadedItem.getBodyDiffJson().get("/user/name");
        assertThat(reloadedNameDiff.get("kind")).isEqualTo("value_changed");
        assertThat(reloadedNameDiff.get("source")).isEqualTo("alice");
        assertThat(reloadedNameDiff.get("target")).isEqualTo("alicia");
    }

    @Test
    @DisplayName("findByTargetBaselineId returns the diff; findBySourceBaselineId returns the list of all diffs for a source")
    void findersScopeCorrectly() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();
        UUID sharedSourceBaselineId = UUID.randomUUID();
        UUID targetA = UUID.randomUUID();
        UUID targetB = UUID.randomUUID();

        // Two diffs sharing the same source baseline but pointing at two
        // different target baselines. v1 won't naturally produce this (the
        // UI is 1:1 per target) but the schema + repo MUST support it for
        // the v2 reverse-lookup surface.
        ApiBehaviourDiffEntity diffA = newDiff(projectId, architectureId,
            sharedSourceBaselineId, targetA, "completed");
        diffA.setMatchedCount(5);
        diffRepository.saveAndFlush(diffA);

        ApiBehaviourDiffEntity diffB = newDiff(projectId, architectureId,
            sharedSourceBaselineId, targetB, "computing");
        diffRepository.saveAndFlush(diffB);

        entityManager.clear();

        // findByTargetBaselineId is the primary UI-lookup path -- returns
        // AT MOST one (UNIQUE pair constraint).
        Optional<ApiBehaviourDiffEntity> byTargetA =
            diffRepository.findByTargetBaselineId(targetA);
        assertThat(byTargetA).isPresent();
        assertThat(byTargetA.get().getId()).isEqualTo(diffA.getId());

        Optional<ApiBehaviourDiffEntity> byTargetB =
            diffRepository.findByTargetBaselineId(targetB);
        assertThat(byTargetB).isPresent();
        assertThat(byTargetB.get().getId()).isEqualTo(diffB.getId());

        // Unknown target returns empty.
        Optional<ApiBehaviourDiffEntity> byUnknown =
            diffRepository.findByTargetBaselineId(UUID.randomUUID());
        assertThat(byUnknown).isEmpty();

        // findBySourceBaselineId returns BOTH diffs.
        List<ApiBehaviourDiffEntity> bySource =
            diffRepository.findBySourceBaselineId(sharedSourceBaselineId);
        assertThat(bySource).hasSize(2);
        assertThat(bySource).extracting(ApiBehaviourDiffEntity::getId)
            .containsExactlyInAnyOrder(diffA.getId(), diffB.getId());
    }

    @Test
    @DisplayName("findByDiffIdOrderByMethodAscPathAsc returns items in deterministic (method, path) order")
    void diffItemFinderOrdersByMethodThenPath() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();
        ApiBehaviourDiffEntity diff = newDiff(projectId, architectureId,
            UUID.randomUUID(), UUID.randomUUID(), "completed");
        diffRepository.saveAndFlush(diff);

        // Insert in deliberately-shuffled order. Expected sorted output:
        // GET /a, GET /b, POST /a, POST /b.
        diffItemRepository.saveAndFlush(newDiffItem(diff.getId(), "POST", "/b", "scenario-1",
            "status_match", "body_match", 200, 200, null, null));
        diffItemRepository.saveAndFlush(newDiffItem(diff.getId(), "GET", "/b", "scenario-2",
            "status_match", "body_match", 200, 200, null, null));
        diffItemRepository.saveAndFlush(newDiffItem(diff.getId(), "POST", "/a", "scenario-3",
            "status_drift", null, 201, 500, null, null));
        diffItemRepository.saveAndFlush(newDiffItem(diff.getId(), "GET", "/a", "scenario-4",
            "status_match", "body_match", 200, 200, null, null));

        entityManager.clear();

        List<ApiBehaviourDiffItemEntity> items =
            diffItemRepository.findByDiffIdOrderByMethodAscPathAsc(diff.getId());
        assertThat(items).hasSize(4);
        assertThat(items).extracting(i ->
            i.getMethod() + " " + i.getPath())
            .containsExactly("GET /a", "GET /b", "POST /a", "POST /b");
    }

    @Test
    @DisplayName("UNIQUE (source_baseline_id, target_baseline_id) rejects duplicate pair inserts")
    void uniquePairConstraintRejectsDuplicates() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();
        UUID sourceBaselineId = UUID.randomUUID();
        UUID targetBaselineId = UUID.randomUUID();

        ApiBehaviourDiffEntity firstDiff = newDiff(projectId, architectureId,
            sourceBaselineId, targetBaselineId, "computing");
        diffRepository.saveAndFlush(firstDiff);

        ApiBehaviourDiffEntity duplicatePair = newDiff(projectId, architectureId,
            sourceBaselineId, targetBaselineId, "computing");

        assertThatThrownBy(() -> diffRepository.saveAndFlush(duplicatePair))
            .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("Liquibase changesets 158 + 159 declare ON DELETE CASCADE on source/target baseline FKs and on diff_id; deletion of the source baseline cascades the diff and its items in production")
    void changesetsDeclareOnDeleteCascade() throws Exception {
        // Production source of truth is the Liquibase SQL applied against
        // PostgreSQL; the H2 test DB schema is Hibernate-generated (not
        // Liquibase-driven under @DataJpaTest) so FK actions expressed in
        // changeset SQL are not enforced here. Inspect the changeset text
        // directly. Same pattern used by ApiBehaviourPersistenceTest.

        String diffsSql = StreamUtils.copyToString(
            new ClassPathResource("db/changelog/sql/158-api-behaviour-diffs.sql").getInputStream(),
            StandardCharsets.UTF_8);
        String diffsCompact = diffsSql.replaceAll("\\s+", " ").toLowerCase();

        // Source baseline FK with CASCADE.
        assertThat(diffsCompact)
            .contains("constraint fk_api_behaviour_diff_source")
            .contains("foreign key (source_baseline_id) references api_behaviour_baselines(id) on delete cascade");
        // Target baseline FK with CASCADE.
        assertThat(diffsCompact)
            .contains("constraint fk_api_behaviour_diff_target")
            .contains("foreign key (target_baseline_id) references api_behaviour_baselines(id) on delete cascade");
        // Project FK with CASCADE.
        assertThat(diffsCompact)
            .contains("foreign key (project_id) references project(id) on delete cascade");
        // UNIQUE pair constraint present in the SQL.
        assertThat(diffsCompact)
            .contains("unique (source_baseline_id, target_baseline_id)");

        String diffItemsSql = StreamUtils.copyToString(
            new ClassPathResource("db/changelog/sql/159-api-behaviour-diff-items.sql").getInputStream(),
            StandardCharsets.UTF_8);
        String diffItemsCompact = diffItemsSql.replaceAll("\\s+", " ").toLowerCase();

        // Diff-id FK with CASCADE -- closes the cleanup loop so deletion of
        // a source baseline removes the diff (via the 158 CASCADE) which in
        // turn removes the diff_items (via this 159 CASCADE).
        assertThat(diffItemsCompact)
            .contains("constraint fk_api_behaviour_diff_item_diff")
            .contains("foreign key (diff_id) references api_behaviour_diffs(id) on delete cascade");
    }
}
