package com.example.architecturemodel.repository.discovery;

import com.example.architecturemodel.model.entity.discovery.DiscoveryFindingEntity;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.core.io.ClassPathResource;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.util.StreamUtils;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Persistence-layer tests for the new {@code api_behaviour_diff_id} origin
 * on {@code discovery_findings} introduced by changeset 160.
 *
 * <p>Covers the load-bearing changes from Task Group 1 of the API Test
 * Harness — Findings Integration spec (2026-05-25):</p>
 *
 * <ol>
 *   <li>Round-trip of the new {@code api_behaviour_diff_id} field via the
 *       entity builder.</li>
 *   <li>The new {@code findByApiBehaviourDiffIdOrderByCreatedAtAsc(UUID)}
 *       finder returns only findings for the queried diff and orders by
 *       {@code created_at} ascending.</li>
 *   <li>The load-bearing
 *       {@code findByProjectIdAndArchitectureIdAndRunIdNotNull(UUID, UUID)}
 *       finder filters out diff-sourced findings (accepted Q7) -- needed by
 *       {@code MigrationSpecContextResolver.loadFindings} to avoid NPEs on
 *       {@code f.getRunId()}.</li>
 *   <li>Changeset 160 declares the FK CASCADE on {@code api_behaviour_diff_id}
 *       and the exactly-one-of-origin CHECK constraint (verified by SQL-text
 *       inspection because the H2 test DB schema is Hibernate-generated and
 *       does not honour FK actions or CHECK clauses expressed in
 *       Liquibase). Same pattern used by {@code ApiBehaviourDiffPersistenceTest}.</li>
 * </ol>
 *
 * <p>The runtime CHECK constraint behaviour (both-set / neither-set
 * rejection) is exercised in the service-layer test
 * {@code DiscoveryFindingOriginValidationTest} via the
 * {@code IllegalArgumentException} thrown by
 * {@code DiscoveryFindingService.persistFindingEntity} -- that mirror is
 * the user-visible enforcement, with the DB CHECK as the production
 * safety net.</p>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:discoveryfindingsdifforigindb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON",
    "spring.datasource.driver-class-name=org.h2.Driver",
    "spring.datasource.username=sa",
    "spring.datasource.password=",
    "spring.liquibase.enabled=false",
    "spring.jpa.hibernate.ddl-auto=create-drop",
    "spring.jpa.properties.hibernate.dialect=org.hibernate.dialect.H2Dialect"
})
class DiscoveryFindingApiBehaviourDiffOriginPersistenceTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private DiscoveryFindingRepository findingRepository;

    private DiscoveryFindingEntity diffSourcedFinding(UUID diffId, UUID projectId, UUID architectureId, String title) {
        return DiscoveryFindingEntity.builder()
            .id(UUID.randomUUID())
            .apiBehaviourDiffId(diffId)
            .projectId(projectId)
            .architectureId(architectureId)
            .findingType("api_behaviour_status_drift")
            .category("api_behaviour_drift")
            .severity("critical")
            .reviewStatus("pending_review")
            .title(title)
            .summary(title + " summary")
            .source("api_behaviour_diff")
            .createdByStage("diffRunner.findingEmission")
            .build();
    }

    private DiscoveryFindingEntity runSourcedFinding(UUID runId, UUID projectId, UUID architectureId, String title) {
        return DiscoveryFindingEntity.builder()
            .id(UUID.randomUUID())
            .runId(runId)
            .projectId(projectId)
            .architectureId(architectureId)
            .findingType("low_confidence_candidate")
            .category("ambiguity")
            .severity("medium")
            .reviewStatus("pending_review")
            .title(title)
            .source("discovery")
            .createdByStage("discoveryV3Pipeline.postMerge.lowConfidence")
            .build();
    }

    @Test
    @DisplayName("findByApiBehaviourDiffIdOrderByCreatedAtAsc returns only findings for the queried diff, ordered by created_at ASC")
    void findByApiBehaviourDiffIdOrders() throws Exception {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();
        UUID diffA = UUID.randomUUID();
        UUID diffB = UUID.randomUUID();

        // Three findings under diffA, two under diffB. Persist with small
        // sleeps so created_at strictly orders.
        DiscoveryFindingEntity a1 = findingRepository.saveAndFlush(
            diffSourcedFinding(diffA, projectId, architectureId, "A first"));
        Thread.sleep(5);
        DiscoveryFindingEntity a2 = findingRepository.saveAndFlush(
            diffSourcedFinding(diffA, projectId, architectureId, "A second"));
        Thread.sleep(5);
        DiscoveryFindingEntity a3 = findingRepository.saveAndFlush(
            diffSourcedFinding(diffA, projectId, architectureId, "A third"));
        findingRepository.saveAndFlush(
            diffSourcedFinding(diffB, projectId, architectureId, "B first"));
        findingRepository.saveAndFlush(
            diffSourcedFinding(diffB, projectId, architectureId, "B second"));
        entityManager.clear();

        List<DiscoveryFindingEntity> forA =
            findingRepository.findByApiBehaviourDiffIdOrderByCreatedAtAsc(diffA);
        assertThat(forA)
            .hasSize(3)
            .extracting(DiscoveryFindingEntity::getId)
            .containsExactly(a1.getId(), a2.getId(), a3.getId());

        List<DiscoveryFindingEntity> forB =
            findingRepository.findByApiBehaviourDiffIdOrderByCreatedAtAsc(diffB);
        assertThat(forB).hasSize(2);
        assertThat(forB).allSatisfy(f -> {
            assertThat(f.getApiBehaviourDiffId()).isEqualTo(diffB);
            assertThat(f.getRunId()).isNull();
        });

        List<DiscoveryFindingEntity> unknown = findingRepository
            .findByApiBehaviourDiffIdOrderByCreatedAtAsc(UUID.randomUUID());
        assertThat(unknown).isEmpty();
    }

    @Test
    @DisplayName("findByProjectIdAndArchitectureIdAndRunIdNotNull filters diff-sourced findings out -- preserves migration spec semantics (accepted Q7)")
    void runIdNotNullFinderFiltersDiffSourcedOut() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        UUID diffId = UUID.randomUUID();

        DiscoveryFindingEntity runSourced = findingRepository.saveAndFlush(
            runSourcedFinding(runId, projectId, architectureId, "run-sourced"));
        DiscoveryFindingEntity diffSourced = findingRepository.saveAndFlush(
            diffSourcedFinding(diffId, projectId, architectureId, "diff-sourced"));
        entityManager.clear();

        // The "both origins" finder (existing, pre-2026-05-25 behaviour)
        // returns BOTH findings.
        List<DiscoveryFindingEntity> both = findingRepository
            .findByProjectIdAndArchitectureId(projectId, architectureId);
        assertThat(both).hasSize(2);

        // The new RunIdNotNull finder returns ONLY the run-sourced one. This
        // is what MigrationSpecContextResolver.loadFindings now calls -- if
        // the finder leaked diff-sourced findings through, the resolver
        // would NPE on f.getRunId() being null when populating the
        // FindingHighlight record.
        List<DiscoveryFindingEntity> runOnly = findingRepository
            .findByProjectIdAndArchitectureIdAndRunIdNotNull(projectId, architectureId);
        assertThat(runOnly)
            .hasSize(1)
            .extracting(DiscoveryFindingEntity::getId)
            .containsExactly(runSourced.getId());
        assertThat(runOnly.get(0).getRunId()).isNotNull();
        // And critically, the diff-sourced finding is NOT in the result --
        // its id appears nowhere.
        assertThat(runOnly).extracting(DiscoveryFindingEntity::getId)
            .doesNotContain(diffSourced.getId());
    }

    @Test
    @DisplayName("Liquibase changeset 160 declares ON DELETE CASCADE on api_behaviour_diff_id and the exactly-one-of-origin CHECK constraint")
    void changeset160DeclaresCascadeAndCheck() throws Exception {
        // Production source of truth is the Liquibase SQL applied against
        // PostgreSQL; the H2 test DB schema is Hibernate-generated under
        // @DataJpaTest so the FK CASCADE on api_behaviour_diff_id and the
        // CHECK constraint discovery_finding_exactly_one_origin are NOT
        // enforced here. Inspect the changeset text directly -- same
        // pattern as ApiBehaviourDiffPersistenceTest.
        String sql = StreamUtils.copyToString(
            new ClassPathResource(
                "db/changelog/sql/160-discovery-findings-api-behaviour-diff-origin.sql")
                .getInputStream(),
            StandardCharsets.UTF_8);
        String compact = sql.replaceAll("\\s+", " ").toLowerCase();

        // run_id is RELAXED from NOT NULL.
        assertThat(compact)
            .as("Changeset 160 must drop NOT NULL on run_id (existing column relaxed)")
            .contains("alter table discovery_findings alter column run_id drop not null");
        // api_behaviour_diff_id is ADDED as nullable UUID with FK CASCADE.
        assertThat(compact)
            .as("Changeset 160 must add api_behaviour_diff_id with FK CASCADE")
            .contains("add column api_behaviour_diff_id uuid null")
            .contains("references api_behaviour_diffs(id) on delete cascade");
        // Partial index for the new origin column.
        assertThat(compact)
            .as("Changeset 160 must declare the partial index on api_behaviour_diff_id")
            .contains("create index idx_discovery_finding_api_behaviour_diff_id")
            .contains("where api_behaviour_diff_id is not null");
        // Exactly-one-of-origin CHECK constraint -- rejects both-set AND
        // neither-set (verified at the service layer in
        // DiscoveryFindingOriginValidationTest).
        assertThat(compact)
            .as("Changeset 160 must declare the exactly-one-of-origin CHECK constraint")
            .contains("constraint discovery_finding_exactly_one_origin")
            .contains("check ((run_id is not null)::int + (api_behaviour_diff_id is not null)::int = 1)");
    }
}
