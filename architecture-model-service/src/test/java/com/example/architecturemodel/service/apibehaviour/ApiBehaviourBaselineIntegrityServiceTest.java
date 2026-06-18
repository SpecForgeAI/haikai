package com.example.architecturemodel.service.apibehaviour;

import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourBaselineDto;
import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourBaselineIntegrityDto;
import com.example.architecturemodel.model.dto.apibehaviour.UpdateApiBehaviourBaselineRequest;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourBaselineEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourBaselineItemEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourCaptureSessionEntity;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourBaselineItemRepository;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourBaselineRepository;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourCaptureSessionRepository;
import com.example.architecturemodel.util.BaselineContentHashUtil;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Service-layer integration tests for the Baseline Integrity &amp; Provenance
 * spec (2026-06-17) — Task Group 1. Drives the real
 * {@link ApiBehaviourBaselineService} against a real (H2 PostgreSQL-mode)
 * repository (the {@code JSONB AS JSON} alias trick lets the {@code JsonType}-
 * bound {@code provenance_json} / {@code response_json} columns persist without
 * a real PostgreSQL — same approach as
 * {@link ApiBehaviourCaptureSessionCoverageSummaryTest}).
 *
 * <p>Critical behaviours (within the 2-8 focused-test budget):</p>
 * <ol>
 *   <li>Hash determinism: the SAME item set in DIFFERENT insertion order (and
 *       with JSON object keys in different order) produces the IDENTICAL hash.</li>
 *   <li>Stamp-at-activate: a draft has null hash + null provenance; the
 *       draft→active PATCH stamps both, and provenance carries the coverage
 *       score read from the session.</li>
 *   <li>Verify endpoint: intact active baseline → {@code integrity_verified}
 *       true; after a stored item is tampered → false with a differing
 *       recomputed hash.</li>
 *   <li>Null-hash baseline (draft / never-activated) → neutral
 *       ({@code content_hash: null}, {@code integrity_verified: false}), NOT a
 *       mismatch.</li>
 * </ol>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:apibehintegritydb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON",
    "app.features.include-database=true"
})
@Import(ApiBehaviourBaselineService.class)
class ApiBehaviourBaselineIntegrityServiceTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private ApiBehaviourBaselineService service;

    @Autowired
    private ApiBehaviourBaselineRepository baselineRepository;

    @Autowired
    private ApiBehaviourBaselineItemRepository itemRepository;

    @Autowired
    private ApiBehaviourCaptureSessionRepository sessionRepository;

    private UUID projectId;
    private UUID architectureId;
    private UUID sessionId;

    @BeforeEach
    void seed() {
        projectId = UUID.randomUUID();
        architectureId = UUID.randomUUID();
    }

    private UUID seedSession(Double overallScore) {
        ApiBehaviourCaptureSessionEntity session = ApiBehaviourCaptureSessionEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .architectureId(architectureId)
            .name("seed session")
            .status("completed")
            .environmentName("non-prod")
            .apiBaseUrl("https://api.example.test")
            .authType("bearer")
            .mutatingCallsConfirmed(Boolean.FALSE)
            .kind("current")
            .coverageSummaryJson(overallScore == null ? null : Map.of(
                "overall_score", overallScore,
                "dimensions_total", 3,
                "dimensions_achieved", 1))
            .build();
        sessionRepository.saveAndFlush(session);
        return session.getId();
    }

    private ApiBehaviourBaselineEntity seedDraftBaseline(String kind, UUID sessId) {
        ApiBehaviourBaselineEntity baseline = ApiBehaviourBaselineEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .architectureId(architectureId)
            .sessionId(sessId)
            .name("draft baseline")
            .status("draft")
            .acceptedCaptureCount(2)
            .operationCount(2)
            .kind(kind)
            .build();
        baselineRepository.saveAndFlush(baseline);
        return baseline;
    }

    private ApiBehaviourBaselineItemEntity item(
            UUID baselineId, String method, String path, String scenario,
            int status, Map<String, Object> responseBody) {
        Map<String, Object> requestJson = new LinkedHashMap<>();
        requestJson.put("query", Map.of("page", 1));
        Map<String, Object> responseJson = new LinkedHashMap<>();
        responseJson.put("headers", Map.of("content-type", "application/json"));
        responseJson.put("body", responseBody);
        return ApiBehaviourBaselineItemEntity.builder()
            .id(UUID.randomUUID())
            .baselineId(baselineId)
            .captureId(UUID.randomUUID())
            .operationId(UUID.randomUUID())
            .scenarioId(UUID.randomUUID())
            .method(method)
            .path(path)
            .scenarioName(scenario)
            .requestJson(requestJson)
            .responseStatus(status)
            .responseJson(responseJson)
            .build();
    }

    // ----------------------------------------------------------------------

    @Test
    @DisplayName("(a) hash determinism: the same item set in different insertion / key order produces the identical content hash")
    void hashIsDeterministicRegardlessOfOrder() {
        // Item B body with keys in one order.
        Map<String, Object> bodyOrderA = new LinkedHashMap<>();
        bodyOrderA.put("alpha", 1);
        bodyOrderA.put("beta", 2);
        // Same logical body, keys in a different insertion order.
        Map<String, Object> bodyOrderB = new LinkedHashMap<>();
        bodyOrderB.put("beta", 2);
        bodyOrderB.put("alpha", 1);

        ApiBehaviourBaselineItemEntity i1 =
            item(UUID.randomUUID(), "GET", "/a", "happy", 200, bodyOrderA);
        ApiBehaviourBaselineItemEntity i2 =
            item(UUID.randomUUID(), "POST", "/b", "create", 201, Map.of("id", "x"));

        // First ordering: [i1, i2] with body key order A.
        String hash1 = BaselineContentHashUtil.computeContentHash(List.of(i1, i2));

        // Re-create the same items in REVERSED order, and i1's body keys in
        // order B (different insertion order, same content).
        ApiBehaviourBaselineItemEntity i1b =
            item(i1.getId(), "GET", "/a", "happy", 200, bodyOrderB);
        ApiBehaviourBaselineItemEntity i2b =
            item(i2.getId(), "POST", "/b", "create", 201, Map.of("id", "x"));
        String hash2 = BaselineContentHashUtil.computeContentHash(List.of(i2b, i1b));

        assertThat(hash2)
            .as("identical item set in any insertion / key order -> identical hash")
            .isEqualTo(hash1);
        assertThat(hash1).hasSize(64); // SHA-256 hex
        assertThat(hash1).matches("[0-9a-f]{64}");
    }

    @Test
    @DisplayName("(b) stamp-at-activate: a draft carries null hash + null provenance; draft->active PATCH stamps both and provenance carries the session coverage score")
    void draftHasNoHashUntilActivated() {
        sessionId = seedSession(0.42);
        ApiBehaviourBaselineEntity draft = seedDraftBaseline("current", sessionId);
        itemRepository.saveAndFlush(item(draft.getId(), "GET", "/a", "happy", 200, Map.of("ok", true)));
        itemRepository.saveAndFlush(item(draft.getId(), "POST", "/b", "create", 201, Map.of("id", "x")));
        entityManager.clear();

        // Draft has neither hash nor provenance.
        ApiBehaviourBaselineEntity asDraft =
            baselineRepository.findById(draft.getId()).orElseThrow();
        assertThat(asDraft.getContentHash()).isNull();
        assertThat(asDraft.getProvenanceJson()).isNull();

        // Activate via PATCH status=active.
        ApiBehaviourBaselineDto activated = service.update(
            projectId, draft.getId(),
            new UpdateApiBehaviourBaselineRequest(null, "active", null, null, null));

        assertThat(activated.contentHash())
            .as("activate stamps the content hash")
            .isNotNull()
            .matches("[0-9a-f]{64}");
        Map<String, Object> prov = activated.provenanceJson();
        assertThat(prov).isNotNull();
        assertThat(prov.get("session_id")).isEqualTo(sessionId.toString());
        assertThat(prov.get("environment_name")).isEqualTo("non-prod");
        assertThat(prov.get("coverage_score"))
            .as("provenance carries Spec A's overall_score from the session")
            .isEqualTo(0.42);
        assertThat(prov.get("hash_algo")).isEqualTo("sha256");
        assertThat(prov.get("canonical_version")).isEqualTo(1);
        assertThat(prov.get("accepted_capture_count")).isEqualTo(2);
        assertThat(prov.get("activated_at")).isNotNull();
    }

    @Test
    @DisplayName("(b2) null-safe coverage: a session with no coverage_summary_json stamps coverage_score null (never fabricated)")
    void coverageScoreNullWhenSessionHasNoSummary() {
        sessionId = seedSession(null);
        ApiBehaviourBaselineEntity draft = seedDraftBaseline("current", sessionId);
        itemRepository.saveAndFlush(item(draft.getId(), "GET", "/a", "happy", 200, Map.of("ok", true)));
        entityManager.clear();

        ApiBehaviourBaselineDto activated = service.update(
            projectId, draft.getId(),
            new UpdateApiBehaviourBaselineRequest(null, "active", null, null, null));

        assertThat(activated.contentHash()).isNotNull();
        Map<String, Object> prov = activated.provenanceJson();
        assertThat(prov.get("coverage_score")).isNull();
        assertThat(prov.get("coverage_summary")).isNull();
    }

    @Test
    @DisplayName("(c) verify: intact active baseline -> integrity_verified true; a tampered stored item -> false with a differing recomputed hash")
    void verifyDetectsTampering() {
        sessionId = seedSession(0.5);
        ApiBehaviourBaselineEntity draft = seedDraftBaseline("current", sessionId);
        ApiBehaviourBaselineItemEntity itemA =
            item(draft.getId(), "GET", "/a", "happy", 200, Map.of("ok", true));
        itemRepository.saveAndFlush(itemA);
        itemRepository.saveAndFlush(item(draft.getId(), "POST", "/b", "create", 201, Map.of("id", "x")));
        entityManager.clear();

        // Activate to stamp the hash.
        service.update(projectId, draft.getId(),
            new UpdateApiBehaviourBaselineRequest(null, "active", null, null, null));
        entityManager.clear();

        // Intact -> verified true, hashes equal.
        ApiBehaviourBaselineIntegrityDto intact =
            service.verifyIntegrity(projectId, draft.getId());
        assertThat(intact.contentHash()).isNotNull();
        assertThat(intact.recomputedHash()).isEqualTo(intact.contentHash());
        assertThat(intact.integrityVerified()).isTrue();

        // Tamper: mutate a stored item's response body directly in the DB.
        ApiBehaviourBaselineItemEntity reloaded =
            itemRepository.findById(itemA.getId()).orElseThrow();
        Map<String, Object> mutated = new LinkedHashMap<>(reloaded.getResponseJson());
        mutated.put("body", Map.of("ok", false)); // changed value
        reloaded.setResponseJson(mutated);
        itemRepository.saveAndFlush(reloaded);
        entityManager.clear();

        ApiBehaviourBaselineIntegrityDto tampered =
            service.verifyIntegrity(projectId, draft.getId());
        assertThat(tampered.contentHash())
            .as("stamped hash unchanged")
            .isEqualTo(intact.contentHash());
        assertThat(tampered.recomputedHash())
            .as("recomputed hash differs after tamper")
            .isNotEqualTo(tampered.contentHash());
        assertThat(tampered.integrityVerified()).isFalse();
    }

    @Test
    @DisplayName("(d) null-hash baseline (never activated) -> neutral verify result (content_hash null, integrity_verified false), NOT a mismatch")
    void nullHashBaselineIsNeutral() {
        sessionId = seedSession(0.5);
        ApiBehaviourBaselineEntity draft = seedDraftBaseline("current", sessionId);
        itemRepository.saveAndFlush(item(draft.getId(), "GET", "/a", "happy", 200, Map.of("ok", true)));
        entityManager.clear();

        ApiBehaviourBaselineIntegrityDto neutral =
            service.verifyIntegrity(projectId, draft.getId());
        assertThat(neutral.contentHash())
            .as("no hash recorded (draft / never activated)")
            .isNull();
        // recomputed is still produced, but with a null stored hash the verdict
        // is false — the consumer treats null-hash as "no hash recorded".
        assertThat(neutral.recomputedHash()).isNotNull();
        assertThat(neutral.integrityVerified())
            .as("null stored hash is neutral (false), not a mismatch")
            .isFalse();
    }

    @Test
    @DisplayName("(e) current-only: activating a kind='target' baseline does NOT stamp a hash or provenance")
    void targetBaselineIsNotStamped() {
        sessionId = seedSession(0.5);
        // A current source for the pairing invariant.
        ApiBehaviourBaselineEntity source = ApiBehaviourBaselineEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .architectureId(architectureId)
            .sessionId(sessionId)
            .name("source current")
            .status("active")
            .kind("current")
            .build();
        baselineRepository.saveAndFlush(source);

        ApiBehaviourBaselineEntity targetDraft = ApiBehaviourBaselineEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .architectureId(architectureId)
            .sessionId(sessionId)
            .name("target replay")
            .status("draft")
            .kind("target")
            .pairedWithBaselineId(source.getId())
            .build();
        baselineRepository.saveAndFlush(targetDraft);
        itemRepository.saveAndFlush(item(targetDraft.getId(), "GET", "/a", "happy", 200, Map.of("ok", true)));
        entityManager.clear();

        ApiBehaviourBaselineDto activated = service.update(
            projectId, targetDraft.getId(),
            new UpdateApiBehaviourBaselineRequest(null, "active", null, null, null));

        assertThat(activated.kind()).isEqualTo("target");
        assertThat(activated.contentHash())
            .as("target baselines are out of scope (R8) — never stamped")
            .isNull();
        assertThat(activated.provenanceJson()).isNull();
    }
}
