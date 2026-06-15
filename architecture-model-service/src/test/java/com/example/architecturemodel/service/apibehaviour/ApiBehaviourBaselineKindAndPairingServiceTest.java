package com.example.architecturemodel.service.apibehaviour;

import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourBaselineDto;
import com.example.architecturemodel.model.dto.apibehaviour.CreateApiBehaviourBaselineRequest;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourBaselineEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourCaptureSessionEntity;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourBaselineRepository;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourCaptureSessionRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Service-layer integration tests for the {@code kind} discriminator + the
 * FK-pairing invariant on {@link ApiBehaviourBaselineService}.
 *
 * <p>Covers Task Group 2.1 of the API Test Harness — Target-Side Capture spec
 * (2026-05-25). Drives the real service against a real (H2 PostgreSQL-mode)
 * repository — no Mockito stubs — so the invariant + the FK lookup of the
 * paired source baseline both exercise the actual database query path.</p>
 *
 * <p>Scenarios:</p>
 * <ol>
 *   <li>{@code kind="target"} with {@code pairedWithBaselineId=null} is
 *       rejected (target requires a non-null pair).</li>
 *   <li>{@code kind="target"} with a {@code pairedWithBaselineId} pointing at
 *       an existing {@code kind="current"} baseline succeeds; the new row
 *       round-trips with both new fields populated.</li>
 *   <li>{@code kind="current"} with a non-null {@code pairedWithBaselineId} is
 *       rejected (current must have it null).</li>
 *   <li>{@code kind="target"} with a {@code pairedWithBaselineId} pointing at
 *       another {@code kind="target"} baseline is rejected (chaining target
 *       at target is not a valid pairing — sources must be current-state).</li>
 * </ol>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:apibehbaselinekinddb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON",
    "app.features.include-database=true"
})
@Import(ApiBehaviourBaselineService.class)
class ApiBehaviourBaselineKindAndPairingServiceTest {

    @Autowired
    private ApiBehaviourBaselineService service;

    @Autowired
    private ApiBehaviourBaselineRepository baselineRepository;

    @Autowired
    private ApiBehaviourCaptureSessionRepository sessionRepository;

    private UUID projectId;
    private UUID architectureId;
    private UUID sessionId;
    private UUID sourceCurrentBaselineId;

    @BeforeEach
    void seed() {
        projectId = UUID.randomUUID();
        architectureId = UUID.randomUUID();

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
            .build();
        sessionRepository.saveAndFlush(session);
        this.sessionId = session.getId();

        ApiBehaviourBaselineEntity sourceCurrent = ApiBehaviourBaselineEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .architectureId(architectureId)
            .sessionId(session.getId())
            .name("source current")
            .status("active")
            .acceptedCaptureCount(3)
            .operationCount(2)
            .kind("current")
            .build();
        baselineRepository.saveAndFlush(sourceCurrent);
        this.sourceCurrentBaselineId = sourceCurrent.getId();
    }

    @Test
    @DisplayName("Create kind='target' with null pairedWithBaselineId is rejected (IllegalArgumentException → 400)")
    void createTargetWithoutSourceFails() {
        CreateApiBehaviourBaselineRequest req = new CreateApiBehaviourBaselineRequest(
            architectureId, sessionId, "target replay", "active",
            1, 1, null,
            "target", null
        );
        assertThatThrownBy(() -> service.create(projectId, req))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("kind='target' baselines require a non-null pairedWithBaselineId");
    }

    @Test
    @DisplayName("Create kind='target' pointing at an existing kind='current' baseline succeeds and round-trips")
    void createTargetWithValidSourceSucceeds() {
        CreateApiBehaviourBaselineRequest req = new CreateApiBehaviourBaselineRequest(
            architectureId, sessionId, "target replay", "active",
            1, 1, null,
            "target", sourceCurrentBaselineId
        );
        ApiBehaviourBaselineDto created = service.create(projectId, req);
        assertThat(created.kind()).isEqualTo("target");
        assertThat(created.pairedWithBaselineId()).isEqualTo(sourceCurrentBaselineId);

        ApiBehaviourBaselineEntity reloaded = baselineRepository
            .findById(created.id()).orElseThrow();
        assertThat(reloaded.getKind()).isEqualTo("target");
        assertThat(reloaded.getPairedWithBaselineId()).isEqualTo(sourceCurrentBaselineId);
    }

    @Test
    @DisplayName("Create kind='current' with a non-null pairedWithBaselineId is rejected")
    void createCurrentWithSourceFails() {
        CreateApiBehaviourBaselineRequest req = new CreateApiBehaviourBaselineRequest(
            architectureId, sessionId, "current illegal", "active",
            1, 1, null,
            "current", sourceCurrentBaselineId
        );
        assertThatThrownBy(() -> service.create(projectId, req))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("kind='current' baselines MUST NOT carry a pairedWithBaselineId");
    }

    @Test
    @DisplayName("Create kind='target' pointing at another target baseline is rejected (source must be kind='current')")
    void createTargetPointingAtAnotherTargetFails() {
        // First create a valid target baseline.
        CreateApiBehaviourBaselineRequest firstTarget =
            new CreateApiBehaviourBaselineRequest(
                architectureId, sessionId, "first target", "active",
                1, 1, null,
                "target", sourceCurrentBaselineId
            );
        ApiBehaviourBaselineDto firstCreated = service.create(projectId, firstTarget);

        // Now attempt to create a SECOND target pointing at the first target —
        // chaining is not allowed; sources MUST be kind='current'.
        CreateApiBehaviourBaselineRequest chainedTarget =
            new CreateApiBehaviourBaselineRequest(
                architectureId, sessionId, "chained target", "active",
                1, 1, null,
                "target", firstCreated.id()
            );
        assertThatThrownBy(() -> service.create(projectId, chainedTarget))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("must point at a kind='current' baseline");
    }
}
