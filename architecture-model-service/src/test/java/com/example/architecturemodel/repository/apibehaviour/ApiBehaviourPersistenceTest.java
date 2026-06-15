package com.example.architecturemodel.repository.apibehaviour;

import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourBaselineEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourBaselineItemEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourCaptureEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourCaptureSessionEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourDiagnosticEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourOperationEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourScenarioEntity;
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
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Persistence-layer slice tests for the seven {@code api_behaviour_*} tables.
 *
 * <p>Covers Task Group 1.1 of the API Behaviour Baseline Capture Service spec
 * (2026-05-15):</p>
 * <ol>
 *   <li>Round-trip on {@code ApiBehaviourCaptureSessionEntity}: insert →
 *       findByProjectIdAndArchitectureIdOrderByCreatedAtDesc → status update.</li>
 *   <li>JSONB round-trip on {@code auth_config_redacted_json} — proves the
 *       JsonType binding survives serialize/deserialize without data loss.</li>
 *   <li>Cascade-delete declarations on the four session-owned changesets
 *       ({@code 129} operations, {@code 130} scenarios, {@code 131} captures,
 *       {@code 132} diagnostics). Verified by inspecting the Liquibase SQL
 *       text — the H2 PostgreSQL-compat test DB that backs {@code @DataJpaTest}
 *       runs Hibernate's generated DDL (not Liquibase), so FK action verbs
 *       like {@code ON DELETE CASCADE} are not enforced in test. Production
 *       PostgreSQL applies the changeset SQL verbatim. This is the same
 *       changeset-text-inspection pattern documented by
 *       {@code ServiceTechHintsResolvedPersistenceTest}.</li>
 *   <li>Baseline + items round-trip with {@code findByBaselineIdOrderByCreatedAtAsc}.</li>
 *   <li>Boxed-{@link Boolean} {@code mutating_calls_confirmed} round-trip
 *       (PATCH-safety guard for the spec's primitive-double pitfall).</li>
 *   <li>Sessions ordered correctly by
 *       {@code findByProjectIdAndArchitectureIdOrderByCreatedAtDesc}.</li>
 * </ol>
 *
 * <p>The H2 PostgreSQL-mode test DB does not natively understand JSONB, so a
 * {@code CREATE DOMAIN JSONB AS JSON} INIT alias is registered on the JDBC
 * URL — same pattern used by {@code ServiceTechHintsResolvedPersistenceTest}.
 * In production this code targets PostgreSQL where JSONB is native.</p>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:apibehaviourdb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
})
class ApiBehaviourPersistenceTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private ApiBehaviourCaptureSessionRepository sessionRepository;

    @Autowired
    private ApiBehaviourOperationRepository operationRepository;

    @Autowired
    private ApiBehaviourScenarioRepository scenarioRepository;

    @Autowired
    private ApiBehaviourCaptureRepository captureRepository;

    @Autowired
    private ApiBehaviourDiagnosticRepository diagnosticRepository;

    @Autowired
    private ApiBehaviourBaselineRepository baselineRepository;

    @Autowired
    private ApiBehaviourBaselineItemRepository baselineItemRepository;

    private ApiBehaviourCaptureSessionEntity newSession(UUID projectId, UUID architectureId,
                                                        String name, String status) {
        return ApiBehaviourCaptureSessionEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .architectureId(architectureId)
            .name(name)
            .status(status)
            .environmentName("non-prod")
            .apiBaseUrl("https://api.example.test")
            .authType("bearer")
            .mutatingCallsConfirmed(Boolean.FALSE)
            .build();
    }

    @Test
    @DisplayName("CaptureSession round-trips: insert -> findByProjectIdAndArchitectureIdOrderByCreatedAtDesc -> status update")
    void captureSessionRoundTrip() throws Exception {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();

        ApiBehaviourCaptureSessionEntity older = newSession(projectId, architectureId,
            "older", "draft");
        sessionRepository.saveAndFlush(older);
        // Sleep is the simplest portable way to guarantee distinct createdAt
        // timestamps under H2's millisecond resolution; spec test pattern
        // adopted from ArchitectureElementMappingRepositoryTest.
        Thread.sleep(10);
        ApiBehaviourCaptureSessionEntity newer = newSession(projectId, architectureId,
            "newer", "draft");
        sessionRepository.saveAndFlush(newer);
        entityManager.clear();

        List<ApiBehaviourCaptureSessionEntity> found = sessionRepository
            .findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(projectId, architectureId);
        assertThat(found).hasSize(2);
        assertThat(found).extracting(ApiBehaviourCaptureSessionEntity::getName)
            .containsExactly("newer", "older");

        // Status update must persist.
        ApiBehaviourCaptureSessionEntity reloaded = sessionRepository
            .findById(newer.getId()).orElseThrow();
        reloaded.setStatus("configured");
        sessionRepository.saveAndFlush(reloaded);
        entityManager.clear();

        ApiBehaviourCaptureSessionEntity rereloaded = sessionRepository
            .findById(newer.getId()).orElseThrow();
        assertThat(rereloaded.getStatus()).isEqualTo("configured");
        // updatedAt must have advanced via @PreUpdate.
        assertThat(rereloaded.getUpdatedAt().toEpochMilli())
            .isGreaterThanOrEqualTo(rereloaded.getCreatedAt().toEpochMilli());
    }

    @Test
    @DisplayName("auth_config_redacted_json (JSONB) round-trips through JsonType binding without data loss")
    void authConfigRedactedJsonRoundTrips() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();

        Map<String, Object> redactedAuth = new HashMap<>();
        redactedAuth.put("authType", "bearer");
        redactedAuth.put("tokenHeader", "Authorization");
        redactedAuth.put("tokenValue", "[REDACTED]");
        redactedAuth.put("nested", Map.of("k1", "v1", "k2", List.of("a", "b")));

        ApiBehaviourCaptureSessionEntity entity = newSession(projectId, architectureId,
            "auth-roundtrip", "draft");
        entity.setAuthConfigRedactedJson(redactedAuth);

        ApiBehaviourCaptureSessionEntity saved = sessionRepository.saveAndFlush(entity);
        entityManager.clear();

        ApiBehaviourCaptureSessionEntity reloaded = sessionRepository
            .findById(saved.getId()).orElseThrow();
        Map<String, Object> reloadedAuth = reloaded.getAuthConfigRedactedJson();
        assertThat(reloadedAuth).isNotNull();
        assertThat(reloadedAuth.get("authType")).isEqualTo("bearer");
        assertThat(reloadedAuth.get("tokenHeader")).isEqualTo("Authorization");
        assertThat(reloadedAuth.get("tokenValue")).isEqualTo("[REDACTED]");
        assertThat(reloadedAuth.get("nested")).isInstanceOf(Map.class);
        @SuppressWarnings("unchecked")
        Map<String, Object> nested = (Map<String, Object>) reloadedAuth.get("nested");
        assertThat(nested.get("k1")).isEqualTo("v1");
        assertThat(nested.get("k2")).isInstanceOf(List.class);
    }

    @Test
    @DisplayName("Liquibase changesets 129-132 declare ON DELETE CASCADE on session_id FK so child rows are removed when a capture session is deleted")
    void sessionOwnedChangesetsDeclareOnDeleteCascade() throws Exception {
        // Production source of truth is the Liquibase SQL applied against
        // PostgreSQL; H2's create-drop schema doesn't honour FK actions
        // expressed in changeset SQL because Hibernate's generated DDL drives
        // the test schema, not Liquibase. We therefore inspect the changeset
        // text directly -- same pattern documented in
        // ServiceTechHintsResolvedPersistenceTest for similar Liquibase-only
        // assertions.
        assertChangesetCascade(
            "db/changelog/sql/129-api-behaviour-operations.sql",
            "fk_api_behaviour_operation_session");
        assertChangesetCascade(
            "db/changelog/sql/130-api-behaviour-scenarios.sql",
            "fk_api_behaviour_scenario_session");
        assertChangesetCascade(
            "db/changelog/sql/131-api-behaviour-captures.sql",
            "fk_api_behaviour_capture_session");
        assertChangesetCascade(
            "db/changelog/sql/132-api-behaviour-diagnostics.sql",
            "fk_api_behaviour_diagnostic_session");
    }

    private void assertChangesetCascade(String classpathSql, String constraintName)
            throws Exception {
        String sql = StreamUtils.copyToString(
            new ClassPathResource(classpathSql).getInputStream(),
            StandardCharsets.UTF_8);
        // Strip whitespace so a multi-line constraint definition still
        // matches the substring assertions.
        String compact = sql.replaceAll("\\s+", " ").toLowerCase();
        assertThat(compact)
            .as("Changeset %s must declare constraint %s", classpathSql, constraintName)
            .contains("constraint " + constraintName);
        assertThat(compact)
            .as("Changeset %s must include 'on delete cascade' on session_id FK",
                classpathSql)
            .contains("references api_behaviour_capture_sessions(id) on delete cascade");
    }

    @Test
    @DisplayName("Baseline + items round-trip: insert baseline + items, retrieve items ordered by created_at")
    void baselineAndItemsRoundTrip() throws Exception {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();
        UUID sessionId = UUID.randomUUID();

        // Persist a parent session so the soft FK (no-cascade) is satisfied.
        ApiBehaviourCaptureSessionEntity session = newSession(projectId, architectureId,
            "session-for-baseline", "completed");
        session.setId(sessionId);
        session.setStartedAt(Instant.now());
        session.setCompletedAt(Instant.now());
        sessionRepository.saveAndFlush(session);

        ApiBehaviourBaselineEntity baseline = ApiBehaviourBaselineEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .architectureId(architectureId)
            .sessionId(sessionId)
            .name("v1 baseline")
            .status("active")
            .acceptedCaptureCount(2)
            .operationCount(1)
            .build();
        baselineRepository.saveAndFlush(baseline);

        ApiBehaviourBaselineItemEntity itemA = ApiBehaviourBaselineItemEntity.builder()
            .id(UUID.randomUUID())
            .baselineId(baseline.getId())
            .captureId(UUID.randomUUID())
            .operationId(UUID.randomUUID())
            .scenarioId(UUID.randomUUID())
            .method("GET")
            .path("/widgets")
            .scenarioName("happy")
            .requestJson(Map.of("query", Map.of("limit", 10)))
            .responseStatus(200)
            .responseJson(Map.of("items", List.of(Map.of("id", "w1"))))
            .build();
        baselineItemRepository.saveAndFlush(itemA);
        Thread.sleep(10);
        ApiBehaviourBaselineItemEntity itemB = ApiBehaviourBaselineItemEntity.builder()
            .id(UUID.randomUUID())
            .baselineId(baseline.getId())
            .captureId(UUID.randomUUID())
            .operationId(UUID.randomUUID())
            .scenarioId(UUID.randomUUID())
            .method("GET")
            .path("/widgets/{id}")
            .scenarioName("not_found")
            .requestJson(Map.of("path", Map.of("id", "missing")))
            .responseStatus(404)
            .responseJson(Map.of("error", "not found"))
            .build();
        baselineItemRepository.saveAndFlush(itemB);
        entityManager.clear();

        List<ApiBehaviourBaselineItemEntity> items = baselineItemRepository
            .findByBaselineIdOrderByCreatedAtAsc(baseline.getId());
        assertThat(items).hasSize(2);
        assertThat(items).extracting(ApiBehaviourBaselineItemEntity::getPath)
            .containsExactly("/widgets", "/widgets/{id}");

        // JSONB body content survives the round-trip on the items.
        @SuppressWarnings("unchecked")
        Map<String, Object> firstResponse = (Map<String, Object>) items.get(0).getResponseJson();
        assertThat(firstResponse.get("items")).isInstanceOf(List.class);

        // The baseline list lookup by (project, architecture) finds it.
        List<ApiBehaviourBaselineEntity> baselines = baselineRepository
            .findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(projectId, architectureId);
        assertThat(baselines).hasSize(1);
        assertThat(baselines.get(0).getName()).isEqualTo("v1 baseline");
        assertThat(baselines.get(0).getAcceptedCaptureCount()).isEqualTo(2);
    }

    @Test
    @DisplayName("mutating_calls_confirmed (boxed Boolean) round-trips both true and false correctly")
    void mutatingCallsConfirmedBoxedBooleanRoundTrips() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();

        ApiBehaviourCaptureSessionEntity confirmed = newSession(projectId, architectureId,
            "confirmed", "draft");
        confirmed.setMutatingCallsConfirmed(Boolean.TRUE);
        sessionRepository.saveAndFlush(confirmed);

        ApiBehaviourCaptureSessionEntity unconfirmed = newSession(projectId, architectureId,
            "unconfirmed", "draft");
        unconfirmed.setMutatingCallsConfirmed(Boolean.FALSE);
        sessionRepository.saveAndFlush(unconfirmed);

        entityManager.clear();

        ApiBehaviourCaptureSessionEntity reloadedConfirmed = sessionRepository
            .findById(confirmed.getId()).orElseThrow();
        ApiBehaviourCaptureSessionEntity reloadedUnconfirmed = sessionRepository
            .findById(unconfirmed.getId()).orElseThrow();

        assertThat(reloadedConfirmed.getMutatingCallsConfirmed()).isTrue();
        assertThat(reloadedUnconfirmed.getMutatingCallsConfirmed()).isFalse();
    }

    @Test
    @DisplayName("Operations and diagnostics persist for a session and surface via the OrderByCreatedAtAsc finder")
    void operationsAndDiagnosticsRoundTripBySession() throws Exception {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();

        ApiBehaviourCaptureSessionEntity session = newSession(projectId, architectureId,
            "ops-roundtrip", "running");
        sessionRepository.saveAndFlush(session);

        ApiBehaviourOperationEntity opA = ApiBehaviourOperationEntity.builder()
            .id(UUID.randomUUID())
            .sessionId(session.getId())
            .method("GET")
            .path("/a")
            .included(Boolean.TRUE)
            .safeToExecute(Boolean.TRUE)
            .oasOperationJson(Map.of("operationId", "getA"))
            .build();
        operationRepository.saveAndFlush(opA);
        Thread.sleep(10);
        ApiBehaviourOperationEntity opB = ApiBehaviourOperationEntity.builder()
            .id(UUID.randomUUID())
            .sessionId(session.getId())
            .method("POST")
            .path("/b")
            .included(Boolean.FALSE)
            .safeToExecute(Boolean.FALSE)
            .oasOperationJson(Map.of("operationId", "postB"))
            .build();
        operationRepository.saveAndFlush(opB);

        ApiBehaviourDiagnosticEntity diag = ApiBehaviourDiagnosticEntity.builder()
            .id(UUID.randomUUID())
            .sessionId(session.getId())
            .diagnosticType("endpoint_skipped")
            .message("mutating not confirmed")
            .detailJson(Map.of("path", "/b"))
            .build();
        diagnosticRepository.saveAndFlush(diag);
        entityManager.clear();

        List<ApiBehaviourOperationEntity> ops =
            operationRepository.findBySessionIdOrderByCreatedAtAsc(session.getId());
        assertThat(ops).hasSize(2);
        assertThat(ops).extracting(ApiBehaviourOperationEntity::getPath)
            .containsExactly("/a", "/b");
        assertThat(ops.get(1).getIncluded()).isFalse();
        assertThat(ops.get(1).getSafeToExecute()).isFalse();

        List<ApiBehaviourDiagnosticEntity> diags =
            diagnosticRepository.findBySessionIdOrderByCreatedAtAsc(session.getId());
        assertThat(diags).hasSize(1);
        assertThat(diags.get(0).getDiagnosticType()).isEqualTo("endpoint_skipped");
        assertThat(diags.get(0).getDetailJson().get("path")).isEqualTo("/b");
    }
}
