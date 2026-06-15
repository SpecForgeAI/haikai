package com.example.architecturemodel.repository.apibehaviour;

import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourBaselineEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourCaptureSessionEntity;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Persistence-layer slice tests for the {@code kind} discriminator + the
 * {@code paired_with_baseline_id} / {@code source_baseline_id} self-FK
 * additions on {@code api_behaviour_baselines} and
 * {@code api_behaviour_capture_sessions}.
 *
 * <p>Covers Task Group 1 of the API Test Harness — Target-Side Capture spec
 * (2026-05-25):</p>
 * <ol>
 *   <li>Insert a current-state baseline + a paired target baseline; retrieve
 *       the target via
 *       {@code findByPairedWithBaselineIdOrderByCreatedAtDesc(sourceId)}.
 *       Verify both the new {@code kind} and {@code pairedWithBaselineId}
 *       fields round-trip.</li>
 *   <li>Insert mixed-kind baselines; verify
 *       {@code findByProjectIdAndArchitectureIdAndKindOrderByCreatedAtDesc}
 *       filters correctly.</li>
 *   <li>Symmetric kind-filter check on the capture-session repository.</li>
 *   <li>Default kind round-trip: a baseline / session inserted without
 *       setting {@code kind} ends up with {@code kind='current'} (via the
 *       Lombok {@code @Builder.Default} which mirrors the DB column DEFAULT
 *       — this preserves the legacy contract for pre-migration callers).</li>
 * </ol>
 *
 * <p>Uses the same H2-in-PostgreSQL-compat-mode pattern as
 * {@link ApiBehaviourPersistenceTest}.</p>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:apibehaviourkinddb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
})
class ApiBehaviourKindAndPairingPersistenceTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private ApiBehaviourCaptureSessionRepository sessionRepository;

    @Autowired
    private ApiBehaviourBaselineRepository baselineRepository;

    private ApiBehaviourCaptureSessionEntity newSession(UUID projectId, UUID architectureId,
                                                        String name, String status,
                                                        String kind, UUID sourceBaselineId) {
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
            .kind(kind)
            .sourceBaselineId(sourceBaselineId)
            .build();
    }

    private ApiBehaviourBaselineEntity newBaseline(UUID projectId, UUID architectureId,
                                                   UUID sessionId, String name, String status,
                                                   String kind, UUID pairedWithBaselineId) {
        return ApiBehaviourBaselineEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .architectureId(architectureId)
            .sessionId(sessionId)
            .name(name)
            .status(status)
            .acceptedCaptureCount(1)
            .operationCount(1)
            .kind(kind)
            .pairedWithBaselineId(pairedWithBaselineId)
            .build();
    }

    @Test
    @DisplayName("Paired target baseline round-trips: source current baseline + paired target baseline; findByPairedWithBaselineIdOrderByCreatedAtDesc returns just the target")
    void pairedTargetBaselineRoundTrips() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();

        // Parent session for both baselines (soft FK to session, no cascade).
        ApiBehaviourCaptureSessionEntity session = newSession(projectId, architectureId,
            "session-for-pair", "completed", "current", null);
        sessionRepository.saveAndFlush(session);

        ApiBehaviourBaselineEntity sourceCurrent = newBaseline(projectId, architectureId,
            session.getId(), "current-state v1", "active", "current", null);
        baselineRepository.saveAndFlush(sourceCurrent);

        ApiBehaviourBaselineEntity pairedTarget = newBaseline(projectId, architectureId,
            session.getId(), "target replay v1", "active", "target", sourceCurrent.getId());
        baselineRepository.saveAndFlush(pairedTarget);

        // A second unrelated baseline (different project) -- proves the
        // finder really filters by paired_with_baseline_id and isn't just
        // picking up "any target baseline".
        UUID otherProjectId = UUID.randomUUID();
        ApiBehaviourCaptureSessionEntity otherSession = newSession(otherProjectId, architectureId,
            "other-session", "completed", "current", null);
        sessionRepository.saveAndFlush(otherSession);
        ApiBehaviourBaselineEntity otherCurrent = newBaseline(otherProjectId, architectureId,
            otherSession.getId(), "other current", "active", "current", null);
        baselineRepository.saveAndFlush(otherCurrent);
        ApiBehaviourBaselineEntity otherTarget = newBaseline(otherProjectId, architectureId,
            otherSession.getId(), "other target", "active", "target", otherCurrent.getId());
        baselineRepository.saveAndFlush(otherTarget);

        entityManager.clear();

        List<ApiBehaviourBaselineEntity> paired = baselineRepository
            .findByPairedWithBaselineIdOrderByCreatedAtDesc(sourceCurrent.getId());
        assertThat(paired).hasSize(1);
        assertThat(paired.get(0).getId()).isEqualTo(pairedTarget.getId());
        assertThat(paired.get(0).getKind()).isEqualTo("target");
        assertThat(paired.get(0).getPairedWithBaselineId()).isEqualTo(sourceCurrent.getId());

        // The unrelated other target baseline is NOT returned -- its
        // paired_with_baseline_id is a different UUID.
        List<ApiBehaviourBaselineEntity> nothingPairedToOtherCurrent = baselineRepository
            .findByPairedWithBaselineIdOrderByCreatedAtDesc(UUID.randomUUID());
        assertThat(nothingPairedToOtherCurrent).isEmpty();
    }

    @Test
    @DisplayName("findByProjectIdAndArchitectureIdAndKindOrderByCreatedAtDesc filters baselines by kind")
    void baselineKindFilterRoundTrips() throws Exception {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();

        ApiBehaviourCaptureSessionEntity session = newSession(projectId, architectureId,
            "session-for-kind-filter", "completed", "current", null);
        sessionRepository.saveAndFlush(session);

        ApiBehaviourBaselineEntity currentA = newBaseline(projectId, architectureId,
            session.getId(), "current A", "active", "current", null);
        baselineRepository.saveAndFlush(currentA);
        Thread.sleep(10);
        ApiBehaviourBaselineEntity currentB = newBaseline(projectId, architectureId,
            session.getId(), "current B", "active", "current", null);
        baselineRepository.saveAndFlush(currentB);
        Thread.sleep(10);
        ApiBehaviourBaselineEntity targetA = newBaseline(projectId, architectureId,
            session.getId(), "target A", "active", "target", currentA.getId());
        baselineRepository.saveAndFlush(targetA);

        entityManager.clear();

        List<ApiBehaviourBaselineEntity> currents = baselineRepository
            .findByProjectIdAndArchitectureIdAndKindOrderByCreatedAtDesc(
                projectId, architectureId, "current");
        assertThat(currents).hasSize(2);
        // Newest-first ordering: currentB created after currentA.
        assertThat(currents).extracting(ApiBehaviourBaselineEntity::getName)
            .containsExactly("current B", "current A");

        List<ApiBehaviourBaselineEntity> targets = baselineRepository
            .findByProjectIdAndArchitectureIdAndKindOrderByCreatedAtDesc(
                projectId, architectureId, "target");
        assertThat(targets).hasSize(1);
        assertThat(targets.get(0).getName()).isEqualTo("target A");
        assertThat(targets.get(0).getPairedWithBaselineId()).isEqualTo(currentA.getId());
    }

    @Test
    @DisplayName("findByProjectIdAndArchitectureIdAndKindOrderByCreatedAtDesc filters sessions by kind")
    void sessionKindFilterRoundTrips() throws Exception {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();

        // First a current-state baseline so the target session has a real
        // sourceBaselineId to point at (FK-pairing invariant lives at the
        // service layer, but a non-null FK-able row is the realistic shape).
        ApiBehaviourCaptureSessionEntity currentSession = newSession(projectId, architectureId,
            "current session", "completed", "current", null);
        sessionRepository.saveAndFlush(currentSession);
        ApiBehaviourBaselineEntity sourceBaseline = newBaseline(projectId, architectureId,
            currentSession.getId(), "source baseline", "active", "current", null);
        baselineRepository.saveAndFlush(sourceBaseline);

        Thread.sleep(10);
        ApiBehaviourCaptureSessionEntity targetSession = newSession(projectId, architectureId,
            "target session", "running", "target", sourceBaseline.getId());
        sessionRepository.saveAndFlush(targetSession);

        entityManager.clear();

        List<ApiBehaviourCaptureSessionEntity> currents = sessionRepository
            .findByProjectIdAndArchitectureIdAndKindOrderByCreatedAtDesc(
                projectId, architectureId, "current");
        assertThat(currents).hasSize(1);
        assertThat(currents.get(0).getName()).isEqualTo("current session");
        assertThat(currents.get(0).getSourceBaselineId()).isNull();

        List<ApiBehaviourCaptureSessionEntity> targets = sessionRepository
            .findByProjectIdAndArchitectureIdAndKindOrderByCreatedAtDesc(
                projectId, architectureId, "target");
        assertThat(targets).hasSize(1);
        assertThat(targets.get(0).getName()).isEqualTo("target session");
        assertThat(targets.get(0).getSourceBaselineId()).isEqualTo(sourceBaseline.getId());
    }

    @Test
    @DisplayName("Baseline + session default to kind='current' when builder omits the field (legacy-caller contract)")
    void defaultKindRoundTrips() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();

        // Build WITHOUT setting kind -- mimics legacy callers that predate
        // changeset 156/157.
        ApiBehaviourCaptureSessionEntity session = ApiBehaviourCaptureSessionEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .architectureId(architectureId)
            .name("legacy-shape session")
            .status("draft")
            .mutatingCallsConfirmed(Boolean.FALSE)
            .build();
        sessionRepository.saveAndFlush(session);

        ApiBehaviourBaselineEntity baseline = ApiBehaviourBaselineEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .architectureId(architectureId)
            .sessionId(session.getId())
            .name("legacy-shape baseline")
            .status("active")
            .acceptedCaptureCount(1)
            .operationCount(1)
            .build();
        baselineRepository.saveAndFlush(baseline);

        entityManager.clear();

        ApiBehaviourCaptureSessionEntity reloadedSession = sessionRepository
            .findById(session.getId()).orElseThrow();
        assertThat(reloadedSession.getKind()).isEqualTo("current");
        assertThat(reloadedSession.getSourceBaselineId()).isNull();

        ApiBehaviourBaselineEntity reloadedBaseline = baselineRepository
            .findById(baseline.getId()).orElseThrow();
        assertThat(reloadedBaseline.getKind()).isEqualTo("current");
        assertThat(reloadedBaseline.getPairedWithBaselineId()).isNull();
    }
}
