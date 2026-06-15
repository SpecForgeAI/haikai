package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.TargetStateCapturedDecisionEntity;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.test.context.ActiveProfiles;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Repository slice tests for
 * {@link TargetStateCapturedDecisionRepository}.
 *
 * <p>Spec: Target State Captured Decisions -- Data Plane
 * (2026-05-24-target-state-captured-decisions-data-plane) -- Task Group 1.1.</p>
 *
 * <p>Covers three load-bearing guarantees per the task list:</p>
 * <ol>
 *   <li>Save / find round-trip preserves all UUID / {@link Instant} / nullable
 *       fields, including the self-FK {@code supersededById} column.</li>
 *   <li>{@link TargetStateCapturedDecisionRepository#findLatestNonSupersededByTuple}
 *       returns the latest non-superseded row for a given
 *       {@code (project, target_architecture, decision_code, scope_kind,
 *       scope_ref_id)} tuple, with NULL-safe matching on
 *       {@code scope_ref_id} for architecture-scope rows.</li>
 *   <li>{@link TargetStateCapturedDecisionRepository#findLatestNonSupersededByDecisionCode}
 *       returns rows across multiple scopes for a single {@code decision_code}.</li>
 * </ol>
 *
 * <p>Per Q18 in {@code planning/requirements.md}, the test count is held at
 * 2-4 highly focused tests; no exhaustive column-by-column coverage.</p>
 */
@DataJpaTest
@ActiveProfiles("test")
class TargetStateCapturedDecisionRepositoryTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private TargetStateCapturedDecisionRepository repository;

    private TargetStateCapturedDecisionEntity buildArchitectureScopeDecision(
            UUID projectId,
            UUID targetArchitectureId,
            String decisionCode,
            String answerValue) {
        return TargetStateCapturedDecisionEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .targetArchitectureId(targetArchitectureId)
            .decisionCode(decisionCode)
            .scopeKind("architecture")
            .scopeRefType(null)
            .scopeRefId(null)
            .answerValue(answerValue)
            .answerSummary(null)
            .standardsLookupRef(null)
            .conversationThreadId(null)
            .conversationTurnRef(null)
            .createdByTask("architect-persona-conversation")
            .supersededById(null)
            .build();
    }

    private TargetStateCapturedDecisionEntity buildServiceScopeDecision(
            UUID projectId,
            UUID targetArchitectureId,
            String decisionCode,
            String scopeRefId,
            String answerValue) {
        return TargetStateCapturedDecisionEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .targetArchitectureId(targetArchitectureId)
            .decisionCode(decisionCode)
            .scopeKind("service")
            .scopeRefType(null)
            .scopeRefId(scopeRefId)
            .answerValue(answerValue)
            .answerSummary(null)
            .standardsLookupRef(null)
            .conversationThreadId(null)
            .conversationTurnRef(null)
            .createdByTask("architect-persona-conversation")
            .supersededById(null)
            .build();
    }

    @Test
    @DisplayName("save / findById round-trip preserves UUID / Instant / nullable fields including supersededById")
    void roundTripPreservesAllFields() {
        UUID projectId = UUID.randomUUID();
        UUID targetArchitectureId = UUID.randomUUID();

        // First row: a fully populated architecture-scope decision with
        // every optional field set so we can prove round-trip on each.
        UUID supersedingRowId = UUID.randomUUID();
        TargetStateCapturedDecisionEntity originalRow = TargetStateCapturedDecisionEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .targetArchitectureId(targetArchitectureId)
            .decisionCode("db.engine")
            .scopeKind("architecture")
            .scopeRefType(null)
            .scopeRefId(null)
            .answerValue("PostgreSQL 16 for all services")
            .answerSummary("PostgreSQL 16")
            .standardsLookupRef("standards:db.engine:postgres-16")
            .conversationThreadId("thread-architect-001")
            .conversationTurnRef("turn-3")
            .createdByTask("architect-persona-conversation")
            .build();

        TargetStateCapturedDecisionEntity savedOriginal = repository.save(originalRow);

        // Second row: insert WITHOUT supersededById so the FK is valid, then
        // set the original row's supersededById to point at it (mirrors the
        // service-layer atomic supersession flow we'll implement in Group 2).
        TargetStateCapturedDecisionEntity supersedingRow = buildArchitectureScopeDecision(
            projectId, targetArchitectureId, "db.engine", "PostgreSQL 16 with logical replication");
        supersedingRow.setId(supersedingRowId);
        repository.save(supersedingRow);

        savedOriginal.setSupersededById(supersedingRowId);
        repository.save(savedOriginal);

        entityManager.flush();
        entityManager.clear();

        Optional<TargetStateCapturedDecisionEntity> reloaded =
            repository.findById(savedOriginal.getId());
        assertThat(reloaded).isPresent();

        TargetStateCapturedDecisionEntity loaded = reloaded.get();
        assertThat(loaded.getProjectId()).isEqualTo(projectId);
        assertThat(loaded.getTargetArchitectureId()).isEqualTo(targetArchitectureId);
        assertThat(loaded.getDecisionCode()).isEqualTo("db.engine");
        assertThat(loaded.getScopeKind()).isEqualTo("architecture");
        assertThat(loaded.getScopeRefType()).isNull();
        assertThat(loaded.getScopeRefId()).isNull();
        assertThat(loaded.getAnswerValue()).isEqualTo("PostgreSQL 16 for all services");
        assertThat(loaded.getAnswerSummary()).isEqualTo("PostgreSQL 16");
        assertThat(loaded.getStandardsLookupRef()).isEqualTo("standards:db.engine:postgres-16");
        assertThat(loaded.getConversationThreadId()).isEqualTo("thread-architect-001");
        assertThat(loaded.getConversationTurnRef()).isEqualTo("turn-3");
        assertThat(loaded.getCreatedByTask()).isEqualTo("architect-persona-conversation");
        assertThat(loaded.getCreatedAt())
            .as("@PrePersist must have populated createdAt")
            .isNotNull();
        assertThat(loaded.getSupersededById())
            .as("Self-FK column round-trips as the superseding row's UUID")
            .isEqualTo(supersedingRowId);
    }

    @Test
    @DisplayName("findLatestNonSupersededByTuple returns the latest non-superseded row, NULL-safe on scope_ref_id")
    void findLatestNonSupersededByTupleLooksUpByTuple() {
        UUID projectId = UUID.randomUUID();
        UUID targetArchitectureId = UUID.randomUUID();

        // Architecture-scope: one prior (superseded) row + one latest row.
        TargetStateCapturedDecisionEntity priorArch = buildArchitectureScopeDecision(
            projectId, targetArchitectureId, "db.engine", "MySQL 8");
        TargetStateCapturedDecisionEntity latestArch = buildArchitectureScopeDecision(
            projectId, targetArchitectureId, "db.engine", "PostgreSQL 16");
        repository.save(priorArch);
        repository.save(latestArch);
        priorArch.setSupersededById(latestArch.getId());
        repository.save(priorArch);

        // Service-scope override for the same decision_code in a different scope --
        // must NOT match the architecture-scope tuple lookup below.
        TargetStateCapturedDecisionEntity serviceOverride = buildServiceScopeDecision(
            projectId, targetArchitectureId, "db.engine", "service-A-id", "Oracle for service A");
        repository.save(serviceOverride);

        // A different project's row -- cross-project leak guard at the repository
        // layer (the tuple lookup must not return rows for other projects).
        TargetStateCapturedDecisionEntity foreignProjectArch = buildArchitectureScopeDecision(
            UUID.randomUUID(), targetArchitectureId, "db.engine", "DB2 (other project)");
        repository.save(foreignProjectArch);

        entityManager.flush();
        entityManager.clear();

        // NULL-safe architecture-scope lookup: scopeRefId=null matches the
        // architecture-scope rows; the service-scope override and the foreign
        // project's row are both excluded.
        Optional<TargetStateCapturedDecisionEntity> archHit =
            repository.findLatestNonSupersededByTuple(
                projectId, targetArchitectureId, "db.engine", "architecture", null);
        assertThat(archHit).isPresent();
        assertThat(archHit.get().getId()).isEqualTo(latestArch.getId());
        assertThat(archHit.get().getAnswerValue()).isEqualTo("PostgreSQL 16");
        assertThat(archHit.get().getSupersededById()).isNull();

        // Service-scope lookup with a real scope_ref_id returns the service override.
        Optional<TargetStateCapturedDecisionEntity> serviceHit =
            repository.findLatestNonSupersededByTuple(
                projectId, targetArchitectureId, "db.engine", "service", "service-A-id");
        assertThat(serviceHit).isPresent();
        assertThat(serviceHit.get().getId()).isEqualTo(serviceOverride.getId());
        assertThat(serviceHit.get().getAnswerValue()).isEqualTo("Oracle for service A");

        // Service-scope lookup with a scope_ref_id that doesn't exist returns empty.
        Optional<TargetStateCapturedDecisionEntity> missingServiceHit =
            repository.findLatestNonSupersededByTuple(
                projectId, targetArchitectureId, "db.engine", "service", "service-not-present");
        assertThat(missingServiceHit).isEmpty();
    }

    @Test
    @DisplayName("findLatestNonSupersededByDecisionCode returns latest rows across multiple scopes for one code")
    void findByDecisionCodeAcrossScopes() {
        UUID projectId = UUID.randomUUID();
        UUID targetArchitectureId = UUID.randomUUID();

        // Architecture-scope: superseded prior + latest.
        TargetStateCapturedDecisionEntity priorArch = buildArchitectureScopeDecision(
            projectId, targetArchitectureId, "api.protocol", "REST");
        TargetStateCapturedDecisionEntity latestArch = buildArchitectureScopeDecision(
            projectId, targetArchitectureId, "api.protocol", "gRPC");
        repository.save(priorArch);
        repository.save(latestArch);
        priorArch.setSupersededById(latestArch.getId());
        repository.save(priorArch);

        // Service-scope override (latest, not superseded).
        TargetStateCapturedDecisionEntity serviceOverride = buildServiceScopeDecision(
            projectId, targetArchitectureId, "api.protocol", "service-legacy-id", "SOAP (legacy)");
        repository.save(serviceOverride);

        // A different decision_code on the same target must NOT come back.
        TargetStateCapturedDecisionEntity otherCode = buildArchitectureScopeDecision(
            projectId, targetArchitectureId, "db.engine", "PostgreSQL 16");
        repository.save(otherCode);

        entityManager.flush();
        entityManager.clear();

        List<TargetStateCapturedDecisionEntity> hits =
            repository.findLatestNonSupersededByDecisionCode(
                projectId, targetArchitectureId, "api.protocol");

        assertThat(hits)
            .extracting(TargetStateCapturedDecisionEntity::getId)
            .as("Both the architecture-wide latest and the service override appear; the superseded prior row and the unrelated decision_code do not")
            .containsExactlyInAnyOrder(latestArch.getId(), serviceOverride.getId());

        assertThat(hits)
            .allSatisfy(row -> assertThat(row.getSupersededById())
                .as("Every returned row must be non-superseded")
                .isNull());
    }
}
