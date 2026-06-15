package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.targetstate.CreateTargetStateCapturedDecisionRequest;
import com.example.architecturemodel.model.entity.TargetStateCapturedDecisionEntity;
import com.example.architecturemodel.repository.entity.TargetStateCapturedDecisionRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Service-layer tests for {@link TargetStateCapturedDecisionService}.
 *
 * <p>Spec: Target State Captured Decisions -- Data Plane
 * (2026-05-24-target-state-captured-decisions-data-plane) -- Task Group 2.1.</p>
 *
 * <p>Covers the four load-bearing service guarantees per the task list:</p>
 * <ol>
 *   <li>{@code createDecision} performed twice for the same tuple sets the
 *       prior row's {@code superseded_by_id} to the new row's id atomically
 *       within a single {@code @Transactional} boundary; both rows persist.</li>
 *   <li>{@link TargetStateCapturedDecisionService#listLatestDecisions}
 *       excludes superseded rows; {@link TargetStateCapturedDecisionService#listAllDecisions}
 *       includes them.</li>
 *   <li>{@link TargetStateCapturedDecisionService#findByDecisionCode}
 *       returns latest rows across multiple scopes for one code.</li>
 *   <li>{@link TargetStateCapturedDecisionService#findById} returns the row
 *       when {@code project_id} + {@code target_architecture_id} match;
 *       returns {@link Optional#empty()} (controller maps to 404) when they
 *       do not -- cross-project leak guard.</li>
 * </ol>
 *
 * <p>Per Q18 in {@code planning/requirements.md}, the test count is held at
 * 2-4 highly focused tests.</p>
 *
 * <p>Uses {@code @DataJpaTest} + {@code @Import(TargetStateCapturedDecisionService.class)}
 * so the real service drives the real repository against the H2 in-memory
 * database, exercising the actual supersession transaction (rather than
 * stubbing the repository, which would not verify the JPA write fan-out).</p>
 */
@DataJpaTest
@ActiveProfiles("test")
@Import(TargetStateCapturedDecisionService.class)
class TargetStateCapturedDecisionServiceTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private TargetStateCapturedDecisionRepository repository;

    @Autowired
    private TargetStateCapturedDecisionService service;

    private UUID projectId;
    private UUID targetArchitectureId;

    @BeforeEach
    void setUp() {
        projectId = UUID.randomUUID();
        targetArchitectureId = UUID.randomUUID();
    }

    private CreateTargetStateCapturedDecisionRequest archRequest(
            String decisionCode, String answerValue) {
        return new CreateTargetStateCapturedDecisionRequest(
            decisionCode,
            "architecture",
            null,
            null,
            answerValue,
            null,
            null,
            null,
            null,
            "architect-persona-conversation"
        );
    }

    private CreateTargetStateCapturedDecisionRequest serviceRequest(
            String decisionCode, String scopeRefId, String answerValue) {
        return new CreateTargetStateCapturedDecisionRequest(
            decisionCode,
            "service",
            null,
            scopeRefId,
            answerValue,
            null,
            null,
            null,
            null,
            "architect-persona-conversation"
        );
    }

    @Test
    @DisplayName("createDecision twice for same tuple supersedes prior row atomically in one transaction")
    void createDecisionAtomicallySupersedesPriorRow() {
        TargetStateCapturedDecisionEntity first =
            service.createDecision(projectId, targetArchitectureId,
                archRequest("db.engine", "MySQL 8"));
        TargetStateCapturedDecisionEntity second =
            service.createDecision(projectId, targetArchitectureId,
                archRequest("db.engine", "PostgreSQL 16"));

        entityManager.flush();
        entityManager.clear();

        // Both rows persist in the audit log.
        List<TargetStateCapturedDecisionEntity> allRows =
            repository.findAllForTarget(projectId, targetArchitectureId);
        assertThat(allRows)
            .as("Both the prior and superseding rows persist")
            .extracting(TargetStateCapturedDecisionEntity::getId)
            .containsExactlyInAnyOrder(first.getId(), second.getId());

        // The prior row carries superseded_by_id pointing at the new row.
        TargetStateCapturedDecisionEntity reloadedPrior =
            repository.findById(first.getId()).orElseThrow();
        assertThat(reloadedPrior.getSupersededById())
            .as("Prior row's superseded_by_id points at the new row's id")
            .isEqualTo(second.getId());

        // The new row is the latest (non-superseded) row for the tuple.
        TargetStateCapturedDecisionEntity reloadedNew =
            repository.findById(second.getId()).orElseThrow();
        assertThat(reloadedNew.getSupersededById())
            .as("New row has null superseded_by_id (it is the latest)")
            .isNull();

        // Tuple lookup at the repository confirms the invariant -- at most
        // one non-superseded row per tuple -- and the new row is the hit.
        Optional<TargetStateCapturedDecisionEntity> tupleHit =
            repository.findLatestNonSupersededByTuple(
                projectId, targetArchitectureId, "db.engine", "architecture", null);
        assertThat(tupleHit)
            .as("Exactly one non-superseded row exists for the tuple, and it is the new row")
            .isPresent();
        assertThat(tupleHit.get().getId()).isEqualTo(second.getId());
    }

    @Test
    @DisplayName("listLatestDecisions excludes superseded rows; listAllDecisions includes them")
    void listLatestExcludesSupersededAndListAllIncludesThem() {
        // Three writes total: two architecture-scope versions of db.engine
        // (the first will be superseded) + one service-scope api.protocol.
        service.createDecision(projectId, targetArchitectureId,
            archRequest("db.engine", "MySQL 8"));
        TargetStateCapturedDecisionEntity latestArch =
            service.createDecision(projectId, targetArchitectureId,
                archRequest("db.engine", "PostgreSQL 16"));
        TargetStateCapturedDecisionEntity serviceOverride =
            service.createDecision(projectId, targetArchitectureId,
                serviceRequest("api.protocol", "service-A-id", "gRPC"));

        entityManager.flush();
        entityManager.clear();

        List<TargetStateCapturedDecisionEntity> latest =
            service.listLatestDecisions(projectId, targetArchitectureId);
        assertThat(latest)
            .as("listLatestDecisions surfaces only non-superseded rows")
            .extracting(TargetStateCapturedDecisionEntity::getId)
            .containsExactlyInAnyOrder(latestArch.getId(), serviceOverride.getId());

        List<TargetStateCapturedDecisionEntity> all =
            service.listAllDecisions(projectId, targetArchitectureId);
        assertThat(all)
            .as("listAllDecisions surfaces every row including superseded entries")
            .hasSize(3);
    }

    @Test
    @DisplayName("findByDecisionCode returns the latest rows across multiple scopes for one code")
    void findByDecisionCodeAcrossScopes() {
        // Architecture-scope: superseded prior + latest.
        service.createDecision(projectId, targetArchitectureId,
            archRequest("api.protocol", "REST"));
        TargetStateCapturedDecisionEntity latestArch =
            service.createDecision(projectId, targetArchitectureId,
                archRequest("api.protocol", "gRPC"));

        // Service-scope override -- different scope, latest by construction.
        TargetStateCapturedDecisionEntity serviceOverride =
            service.createDecision(projectId, targetArchitectureId,
                serviceRequest("api.protocol", "service-legacy-id", "SOAP (legacy)"));

        // Different decision code on the same target -- must NOT come back.
        service.createDecision(projectId, targetArchitectureId,
            archRequest("db.engine", "PostgreSQL 16"));

        entityManager.flush();
        entityManager.clear();

        List<TargetStateCapturedDecisionEntity> hits =
            service.findByDecisionCode(projectId, targetArchitectureId, "api.protocol");
        assertThat(hits)
            .extracting(TargetStateCapturedDecisionEntity::getId)
            .as("Latest architecture-wide + service override; superseded prior and unrelated code excluded")
            .containsExactlyInAnyOrder(latestArch.getId(), serviceOverride.getId());
    }

    @Test
    @DisplayName("findById returns the row when project + target match; empty (HTTP 404) on cross-project mismatch")
    void findByIdEnforcesCrossProjectLeakGuard() {
        TargetStateCapturedDecisionEntity row =
            service.createDecision(projectId, targetArchitectureId,
                archRequest("db.engine", "PostgreSQL 16"));

        entityManager.flush();
        entityManager.clear();

        // Happy path: matching project + target architecture returns the row.
        Optional<TargetStateCapturedDecisionEntity> hit =
            service.findById(projectId, targetArchitectureId, row.getId());
        assertThat(hit).isPresent();
        assertThat(hit.get().getId()).isEqualTo(row.getId());

        // Cross-project: different project id returns empty (not 403).
        UUID foreignProjectId = UUID.randomUUID();
        Optional<TargetStateCapturedDecisionEntity> foreignProjectMiss =
            service.findById(foreignProjectId, targetArchitectureId, row.getId());
        assertThat(foreignProjectMiss)
            .as("Cross-project guard returns empty so the controller emits HTTP 404 (not 403)")
            .isEmpty();

        // Cross-architecture: same project but different target architecture id.
        UUID foreignArchitectureId = UUID.randomUUID();
        Optional<TargetStateCapturedDecisionEntity> foreignArchMiss =
            service.findById(projectId, foreignArchitectureId, row.getId());
        assertThat(foreignArchMiss)
            .as("Cross-target-architecture guard returns empty so the controller emits HTTP 404 (not 403)")
            .isEmpty();
    }
}
