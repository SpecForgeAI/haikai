package com.example.architecturemodel.service.apibehaviour;

import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourCaptureSessionDto;
import com.example.architecturemodel.model.dto.apibehaviour.CreateApiBehaviourCaptureSessionRequest;
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
 * FK-pairing invariant on {@link ApiBehaviourCaptureSessionService}.
 *
 * <p>Covers Task Group 2.1 of the API Test Harness — Target-Side Capture spec
 * (2026-05-25). Mirrors the baseline service test but for capture sessions —
 * a target session MUST carry a {@code sourceBaselineId} pointing at an
 * existing {@code kind="current"} baseline in the same project + architecture.</p>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:apibehsessionkinddb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON",
    "app.features.include-database=true"
})
@Import(ApiBehaviourCaptureSessionService.class)
class ApiBehaviourCaptureSessionKindAndPairingServiceTest {

    @Autowired
    private ApiBehaviourCaptureSessionService service;

    @Autowired
    private ApiBehaviourBaselineRepository baselineRepository;

    @Autowired
    private ApiBehaviourCaptureSessionRepository sessionRepository;

    private UUID projectId;
    private UUID architectureId;
    private UUID sourceCurrentBaselineId;
    private UUID targetBaselineId;

    @BeforeEach
    void seed() {
        projectId = UUID.randomUUID();
        architectureId = UUID.randomUUID();

        ApiBehaviourCaptureSessionEntity seedSession =
            ApiBehaviourCaptureSessionEntity.builder()
                .id(UUID.randomUUID())
                .projectId(projectId)
                .architectureId(architectureId)
                .name("seed session for baseline")
                .status("completed")
                .environmentName("non-prod")
                .apiBaseUrl("https://api.example.test")
                .authType("bearer")
                .mutatingCallsConfirmed(Boolean.FALSE)
                .kind("current")
                .build();
        sessionRepository.saveAndFlush(seedSession);

        ApiBehaviourBaselineEntity sourceCurrent = ApiBehaviourBaselineEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .architectureId(architectureId)
            .sessionId(seedSession.getId())
            .name("source current baseline")
            .status("active")
            .acceptedCaptureCount(3)
            .operationCount(2)
            .kind("current")
            .build();
        baselineRepository.saveAndFlush(sourceCurrent);
        this.sourceCurrentBaselineId = sourceCurrent.getId();

        // Also seed an unrelated target baseline so we can test that a
        // capture session cannot point at a target baseline as its source.
        ApiBehaviourBaselineEntity targetBaseline = ApiBehaviourBaselineEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .architectureId(architectureId)
            .sessionId(seedSession.getId())
            .name("target baseline already")
            .status("active")
            .acceptedCaptureCount(3)
            .operationCount(2)
            .kind("target")
            .pairedWithBaselineId(sourceCurrent.getId())
            .build();
        baselineRepository.saveAndFlush(targetBaseline);
        this.targetBaselineId = targetBaseline.getId();
    }

    @Test
    @DisplayName("Create kind='target' session with null sourceBaselineId is rejected")
    void createTargetSessionWithoutSourceFails() {
        CreateApiBehaviourCaptureSessionRequest req =
            new CreateApiBehaviourCaptureSessionRequest(
                architectureId, "target session", null,
                "non-prod", "https://target.example.test", "bearer",
                null, null, null, null,
                Boolean.FALSE,
                "target", null
            );
        assertThatThrownBy(() -> service.create(projectId, req))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("kind='target' capture sessions require a non-null sourceBaselineId");
    }

    @Test
    @DisplayName("Create kind='target' session pointing at an existing kind='current' baseline succeeds and round-trips")
    void createTargetSessionWithValidSourceSucceeds() {
        CreateApiBehaviourCaptureSessionRequest req =
            new CreateApiBehaviourCaptureSessionRequest(
                architectureId, "target session", null,
                "non-prod", "https://target.example.test", "bearer",
                null, null, null, null,
                Boolean.FALSE,
                "target", sourceCurrentBaselineId
            );
        ApiBehaviourCaptureSessionDto created = service.create(projectId, req);
        assertThat(created.kind()).isEqualTo("target");
        assertThat(created.sourceBaselineId()).isEqualTo(sourceCurrentBaselineId);

        ApiBehaviourCaptureSessionEntity reloaded = sessionRepository
            .findById(created.id()).orElseThrow();
        assertThat(reloaded.getKind()).isEqualTo("target");
        assertThat(reloaded.getSourceBaselineId()).isEqualTo(sourceCurrentBaselineId);
    }

    @Test
    @DisplayName("Create kind='current' session with non-null sourceBaselineId is rejected")
    void createCurrentSessionWithSourceFails() {
        CreateApiBehaviourCaptureSessionRequest req =
            new CreateApiBehaviourCaptureSessionRequest(
                architectureId, "illegal current with source", null,
                "non-prod", "https://api.example.test", "bearer",
                null, null, null, null,
                Boolean.FALSE,
                "current", sourceCurrentBaselineId
            );
        assertThatThrownBy(() -> service.create(projectId, req))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("kind='current' capture sessions MUST NOT carry a sourceBaselineId");
    }

    @Test
    @DisplayName("Create kind='target' session pointing at a kind='target' baseline is rejected (source must be current)")
    void createTargetSessionPointingAtTargetBaselineFails() {
        CreateApiBehaviourCaptureSessionRequest req =
            new CreateApiBehaviourCaptureSessionRequest(
                architectureId, "target pointing at target", null,
                "non-prod", "https://target.example.test", "bearer",
                null, null, null, null,
                Boolean.FALSE,
                "target", targetBaselineId
            );
        assertThatThrownBy(() -> service.create(projectId, req))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("must point at a kind='current' baseline");
    }
}
