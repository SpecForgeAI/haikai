package com.example.architecturemodel.service.apibehaviour;

import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourCaptureSessionDto;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourCaptureSessionEntity;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourCaptureSessionRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Cross-project list-by-status test for
 * {@link ApiBehaviourCaptureSessionService#listByStatus(String)} -- the global
 * query behind {@code GET /api/api-behaviour/capture-sessions?status=...}
 * ({@link com.example.architecturemodel.controller.apibehaviour.ApiBehaviourCaptureSessionGlobalController}).
 *
 * <p>The {@code api-migration-validation-service} relies on this for startup
 * orphan-session reconciliation and for resolving a target-replay session by id
 * without knowing the owning project up front. Mirrors the {@code @DataJpaTest}
 * H2-PostgreSQL-mode setup of {@link ApiBehaviourCaptureSessionMultiPatchTest}.</p>
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) -- Task Group 4
 * (completes the cross-project endpoint the validation service expects).</p>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:apibehaviourgloballistdb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON",
    "app.features.include-database=true"
})
@Import(ApiBehaviourCaptureSessionService.class)
class ApiBehaviourCaptureSessionGlobalListTest {

    @Autowired
    private ApiBehaviourCaptureSessionRepository repository;

    @Autowired
    private ApiBehaviourCaptureSessionService service;

    private ApiBehaviourCaptureSessionEntity session(UUID projectId, String name, String status) {
        return ApiBehaviourCaptureSessionEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .architectureId(UUID.randomUUID())
            .name(name)
            .status(status)
            .environmentName("non-prod")
            .apiBaseUrl("https://api.example.test")
            .authType("bearer")
            .mutatingCallsConfirmed(Boolean.FALSE)
            .build();
    }

    @Test
    @DisplayName("listByStatus returns every session in the given status across ALL projects")
    void listByStatusIsCrossProject() {
        UUID projectA = UUID.randomUUID();
        UUID projectB = UUID.randomUUID();

        ApiBehaviourCaptureSessionEntity runningA = session(projectA, "running-A", "running");
        ApiBehaviourCaptureSessionEntity runningB = session(projectB, "running-B", "running");
        repository.saveAndFlush(runningA);
        repository.saveAndFlush(runningB);
        // noise the query must exclude: other statuses, other projects
        repository.saveAndFlush(session(projectA, "draft-A", "draft"));
        repository.saveAndFlush(session(projectB, "completed-B", "completed"));

        List<ApiBehaviourCaptureSessionDto> running = service.listByStatus("running");

        assertThat(running)
            .as("only the two 'running' sessions, regardless of project")
            .extracting(ApiBehaviourCaptureSessionDto::id)
            .containsExactlyInAnyOrder(runningA.getId(), runningB.getId());
        assertThat(running)
            .extracting(ApiBehaviourCaptureSessionDto::status)
            .containsOnly("running");
        assertThat(running)
            .as("the running sessions span two different projects")
            .extracting(ApiBehaviourCaptureSessionDto::projectId)
            .containsExactlyInAnyOrder(projectA, projectB);
    }

    @Test
    @DisplayName("listByStatus returns an empty list when no session matches the status")
    void listByStatusEmptyWhenNoMatch() {
        repository.saveAndFlush(session(UUID.randomUUID(), "draft-only", "draft"));
        assertThat(service.listByStatus("running")).isEmpty();
    }

    @Test
    @DisplayName("listByStatus rejects a status outside the allowed lifecycle set")
    void listByStatusRejectsUnknownStatus() {
        assertThatThrownBy(() -> service.listByStatus("bogus"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("bogus");
    }
}
