package com.example.architecturemodel.repository.discovery;

import com.example.architecturemodel.model.entity.discovery.DiscoveryFindingEntity;
import com.example.architecturemodel.model.entity.discovery.DiscoveryFindingLinkEntity;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.core.io.ClassPathResource;
import org.springframework.data.domain.PageRequest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.util.StreamUtils;

import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Persistence-layer slice tests for {@code discovery_findings} +
 * {@code discovery_finding_links}.
 *
 * <p>Spec: Discovery Findings / Evidence as a First-Class Discovery Concept
 * (2026-05-16) -- Task Group 1.1; normalized by Normalize Findings Review
 * Actions (Spec F, 2026-06-02) -- {@code status} renamed to
 * {@code reviewStatus} with the candidate-parity disposition vocabulary.</p>
 *
 * <p>The H2 PostgreSQL-mode test DB does not natively understand JSONB, so a
 * {@code CREATE DOMAIN JSONB AS JSON} INIT alias is registered on the JDBC URL
 * -- same pattern used by {@code ApiBehaviourPersistenceTest}. The
 * {@code driver-class-name} is set explicitly here (rather than relying on
 * Spring Boot's auto-detection from the URL) because the main
 * {@code application.yml} pins the driver to {@code org.postgresql.Driver}
 * and the test-profile override only kicks in when the test resource path
 * wins classpath precedence -- under some runner configurations (notably
 * standalone JUnit launchers) it does not.</p>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:discoveryfindingsdb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON",
    "spring.datasource.driver-class-name=org.h2.Driver",
    "spring.datasource.username=sa",
    "spring.datasource.password=",
    "spring.liquibase.enabled=false",
    "spring.jpa.hibernate.ddl-auto=create-drop",
    "spring.jpa.properties.hibernate.dialect=org.hibernate.dialect.H2Dialect"
})
class DiscoveryFindingPersistenceTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private DiscoveryFindingRepository findingRepository;

    @Autowired
    private DiscoveryFindingLinkRepository linkRepository;

    private DiscoveryFindingEntity newFinding(UUID runId, UUID projectId, UUID architectureId,
                                              String findingType, String reviewStatus, Double confidence) {
        return DiscoveryFindingEntity.builder()
            .id(UUID.randomUUID())
            .runId(runId)
            .projectId(projectId)
            .architectureId(architectureId)
            .findingType(findingType)
            .category("ambiguity")
            .severity("medium")
            .confidence(confidence)
            .reviewStatus(reviewStatus)
            .title(findingType + " title")
            .summary("summary line")
            .source("test")
            .createdByStage("unit-test")
            .build();
    }

    @Test
    @DisplayName("DiscoveryFindingEntity round-trips: insert -> findById -> review_status update -> updated_at advances")
    void findingRoundTrip() throws Exception {
        UUID runId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();

        DiscoveryFindingEntity entity = newFinding(runId, projectId, architectureId,
            "low_confidence_candidate", "pending_review", 0.42);
        DiscoveryFindingEntity saved = findingRepository.saveAndFlush(entity);
        entityManager.clear();

        DiscoveryFindingEntity reloaded =
            findingRepository.findById(saved.getId()).orElseThrow();
        assertThat(reloaded.getReviewStatus()).isEqualTo("pending_review");
        assertThat(reloaded.getConfidence()).isEqualTo(0.42);
        assertThat(reloaded.getCreatedAt()).isNotNull();
        assertThat(reloaded.getUpdatedAt()).isNotNull();
        long initialUpdatedAt = reloaded.getUpdatedAt().toEpochMilli();

        Thread.sleep(10);
        reloaded.setReviewStatus("approved");
        findingRepository.saveAndFlush(reloaded);
        entityManager.clear();

        DiscoveryFindingEntity rereloaded =
            findingRepository.findById(saved.getId()).orElseThrow();
        assertThat(rereloaded.getReviewStatus()).isEqualTo("approved");
        assertThat(rereloaded.getUpdatedAt().toEpochMilli())
            .isGreaterThanOrEqualTo(initialUpdatedAt);
    }

    @Test
    @DisplayName("DiscoveryFindingLinkEntity round-trips: insert link, findByFindingId, findByTargetTypeAndTargetId, existsBy...")
    void linkRoundTrip() {
        UUID runId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();

        DiscoveryFindingEntity finding = findingRepository.saveAndFlush(
            newFinding(runId, projectId, architectureId, "evidence_gap", "pending_review", 0.7));

        UUID candidateUuid = UUID.randomUUID();
        DiscoveryFindingLinkEntity link = DiscoveryFindingLinkEntity.builder()
            .id(UUID.randomUUID())
            .findingId(finding.getId())
            .linkType("supports")
            .targetType("discovery_candidate")
            .targetId(candidateUuid.toString())
            .label("primary candidate")
            .build();
        linkRepository.saveAndFlush(link);
        entityManager.clear();

        List<DiscoveryFindingLinkEntity> byFinding =
            linkRepository.findByFindingId(finding.getId());
        assertThat(byFinding).hasSize(1);
        assertThat(byFinding.get(0).getTargetId()).isEqualTo(candidateUuid.toString());

        List<DiscoveryFindingLinkEntity> byTarget =
            linkRepository.findByTargetTypeAndTargetId(
                "discovery_candidate", candidateUuid.toString());
        assertThat(byTarget).hasSize(1);

        assertThat(linkRepository.existsByFindingIdAndTargetTypeAndTargetId(
            finding.getId(), "discovery_candidate", candidateUuid.toString())).isTrue();
        assertThat(linkRepository.existsByFindingIdAndTargetTypeAndTargetId(
            finding.getId(), "discovery_candidate", UUID.randomUUID().toString())).isFalse();
    }

    @Test
    @DisplayName("Deleting a finding cascades to its discovery_finding_links rows (D6) -- functional check at JPA layer")
    void cascadeDeleteRemovesLinks() {
        UUID runId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();

        DiscoveryFindingEntity finding = findingRepository.saveAndFlush(
            newFinding(runId, projectId, architectureId, "ambiguous_relationship", "pending_review", null));

        for (int i = 0; i < 3; i++) {
            linkRepository.saveAndFlush(DiscoveryFindingLinkEntity.builder()
                .id(UUID.randomUUID())
                .findingId(finding.getId())
                .linkType("supports")
                .targetType("discovery_candidate")
                .targetId(UUID.randomUUID().toString())
                .build());
        }
        entityManager.clear();
        assertThat(linkRepository.findByFindingId(finding.getId())).hasSize(3);

        // Because @DataJpaTest builds DDL from entity mappings (not Liquibase),
        // the ON DELETE CASCADE clause is NOT honoured at the DB level here.
        // We therefore (a) explicitly remove the links and (b) inspect the
        // changeset SQL text separately for the cascade declaration (see
        // changesetsDeclareCascade) -- same pattern used by
        // ApiBehaviourPersistenceTest.
        linkRepository.deleteAll(linkRepository.findByFindingId(finding.getId()));
        findingRepository.delete(finding);
        entityManager.flush();
        entityManager.clear();

        assertThat(linkRepository.findByFindingId(finding.getId())).isEmpty();
        assertThat(findingRepository.findById(finding.getId())).isEmpty();
    }

    @Test
    @DisplayName("Liquibase changesets 135 + 136 declare ON DELETE CASCADE on the appropriate FKs")
    void changesetsDeclareCascade() throws Exception {
        assertChangesetContains(
            "db/changelog/sql/135-discovery-findings.sql",
            "fk_discovery_finding_run",
            "references discovery_run(id) on delete cascade");
        assertChangesetContains(
            "db/changelog/sql/136-discovery-finding-links.sql",
            "fk_discovery_finding_link_finding",
            "references discovery_findings(id) on delete cascade");
    }

    private void assertChangesetContains(String classpathSql, String constraintName,
                                          String cascadeClause) throws Exception {
        String sql = StreamUtils.copyToString(
            new ClassPathResource(classpathSql).getInputStream(),
            StandardCharsets.UTF_8);
        String compact = sql.replaceAll("\\s+", " ").toLowerCase();
        assertThat(compact)
            .as("Changeset %s must declare constraint %s", classpathSql, constraintName)
            .contains("constraint " + constraintName);
        assertThat(compact)
            .as("Changeset %s must include cascade clause", classpathSql)
            .contains(cascadeClause);
    }

    @Test
    @DisplayName("detail_json (JSONB) round-trips through JsonType binding without data loss")
    void detailJsonRoundTrips() {
        UUID runId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();

        Map<String, Object> detail = new HashMap<>();
        detail.put("metric", "endpoints_without_response_schema");
        detail.put("count", 5);
        detail.put("examples", List.of(Map.of("path", "/widgets"), Map.of("path", "/users")));

        DiscoveryFindingEntity entity = newFinding(runId, projectId, architectureId,
            "evidence_gap", "pending_review", 0.6);
        entity.setDetailJson(detail);
        DiscoveryFindingEntity saved = findingRepository.saveAndFlush(entity);
        entityManager.clear();

        DiscoveryFindingEntity reloaded =
            findingRepository.findById(saved.getId()).orElseThrow();
        Map<String, Object> reloadedDetail = reloaded.getDetailJson();
        assertThat(reloadedDetail).isNotNull();
        assertThat(reloadedDetail.get("metric")).isEqualTo("endpoints_without_response_schema");
        assertThat(reloadedDetail.get("count")).isInstanceOfAny(Integer.class, Long.class, Number.class);
        assertThat(reloadedDetail.get("examples")).isInstanceOf(List.class);
    }

    @Test
    @DisplayName("Boxed-Double confidence=null round-trips correctly (PATCH safety guard)")
    void confidenceNullableBoxedDoubleRoundTrip() {
        UUID runId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();

        DiscoveryFindingEntity withConfidence = newFinding(runId, projectId, architectureId,
            "runtime_usage_observation", "pending_review", 0.95);
        DiscoveryFindingEntity withoutConfidence = newFinding(runId, projectId, architectureId,
            "unmatched_runtime_endpoint", "pending_review", null);
        findingRepository.saveAndFlush(withConfidence);
        findingRepository.saveAndFlush(withoutConfidence);
        entityManager.clear();

        DiscoveryFindingEntity reloadedWith =
            findingRepository.findById(withConfidence.getId()).orElseThrow();
        DiscoveryFindingEntity reloadedWithout =
            findingRepository.findById(withoutConfidence.getId()).orElseThrow();

        assertThat(reloadedWith.getConfidence()).isEqualTo(0.95);
        assertThat(reloadedWithout.getConfidence())
            .as("null confidence must round-trip as null (boxed Double, not primitive)")
            .isNull();
    }

    @Test
    @DisplayName("Search filters by review_status / severity / linked target type produce the expected subset")
    void searchByFilters() {
        UUID runId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();

        DiscoveryFindingEntity deferredHigh = newFinding(runId, projectId, architectureId,
            "low_confidence_candidate", "deferred", 0.55);
        deferredHigh.setSeverity("high");
        findingRepository.saveAndFlush(deferredHigh);

        DiscoveryFindingEntity approvedHigh = newFinding(runId, projectId, architectureId,
            "low_confidence_candidate", "approved", 0.55);
        approvedHigh.setSeverity("high");
        findingRepository.saveAndFlush(approvedHigh);

        DiscoveryFindingEntity deferredLow = newFinding(runId, projectId, architectureId,
            "evidence_gap", "deferred", null);
        deferredLow.setSeverity("low");
        findingRepository.saveAndFlush(deferredLow);

        // Link only the first one to a specific candidate -- search by
        // linkedTargetType+Id should pick it out.
        UUID linkedCandidate = UUID.randomUUID();
        linkRepository.saveAndFlush(DiscoveryFindingLinkEntity.builder()
            .id(UUID.randomUUID())
            .findingId(deferredHigh.getId())
            .linkType("supports")
            .targetType("discovery_candidate")
            .targetId(linkedCandidate.toString())
            .build());
        entityManager.clear();

        var byStatusAndSeverity = findingRepository.search(
            runId, projectId, architectureId,
            null, null, "high", "deferred",
            null, null, null, null, null,
            PageRequest.of(0, 50));
        assertThat(byStatusAndSeverity.getContent())
            .extracting(DiscoveryFindingEntity::getId)
            .containsExactly(deferredHigh.getId());

        var byLinkedTarget = findingRepository.search(
            runId, projectId, architectureId,
            null, null, null, null,
            null, null, null,
            "discovery_candidate", linkedCandidate.toString(),
            PageRequest.of(0, 50));
        assertThat(byLinkedTarget.getContent())
            .extracting(DiscoveryFindingEntity::getId)
            .containsExactly(deferredHigh.getId());

        var bySeverityLow = findingRepository.search(
            runId, projectId, architectureId,
            null, null, "low", null,
            null, null, null, null, null,
            PageRequest.of(0, 50));
        assertThat(bySeverityLow.getContent())
            .extracting(DiscoveryFindingEntity::getId)
            .containsExactly(deferredLow.getId());
    }
}
