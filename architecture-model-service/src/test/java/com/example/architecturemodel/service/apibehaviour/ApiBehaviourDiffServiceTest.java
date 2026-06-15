package com.example.architecturemodel.service.apibehaviour;

import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourDiffDto;
import com.example.architecturemodel.model.dto.apibehaviour.CreateApiBehaviourDiffRequest;
import com.example.architecturemodel.model.dto.apibehaviour.UpdateApiBehaviourDiffRequest;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourBaselineEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourCaptureSessionEntity;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourBaselineRepository;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourCaptureSessionRepository;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourDiffRepository;
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
 * Service-layer integration tests for {@link ApiBehaviourDiffService}.
 *
 * <p>Covers Task Group 2.1 of the API Test Harness — Diff Engine spec
 * (2026-05-25):</p>
 * <ol>
 *   <li>FK-pairing invariant rejects mismatched pairs (source not current,
 *       target not target, target not paired with the source).</li>
 *   <li>Happy-path create succeeds with valid pairing; row round-trips.</li>
 *   <li>PATCH null-guards every field -- a missing {@code matchedCount}
 *       field in the request does NOT wipe the existing value to {@code 0}
 *       (regression test for {@code project_primitive_double_dto_overwrite.md}
 *       on this surface).</li>
 * </ol>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:apibehdiffservicedb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON",
    "app.features.include-database=true"
})
@Import(ApiBehaviourDiffService.class)
class ApiBehaviourDiffServiceTest {

    @Autowired
    private ApiBehaviourDiffService service;

    @Autowired
    private ApiBehaviourDiffRepository diffRepository;

    @Autowired
    private ApiBehaviourBaselineRepository baselineRepository;

    @Autowired
    private ApiBehaviourCaptureSessionRepository sessionRepository;

    private UUID projectId;
    private UUID architectureId;
    private UUID sessionId;
    private UUID sourceCurrentBaselineId;
    private UUID targetBaselineId;

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

        // Source = kind='current'.
        ApiBehaviourBaselineEntity sourceCurrent = ApiBehaviourBaselineEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .architectureId(architectureId)
            .sessionId(sessionId)
            .name("source current")
            .status("active")
            .acceptedCaptureCount(3)
            .operationCount(2)
            .kind("current")
            .build();
        baselineRepository.saveAndFlush(sourceCurrent);
        this.sourceCurrentBaselineId = sourceCurrent.getId();

        // Target = kind='target', paired with the source.
        ApiBehaviourBaselineEntity target = ApiBehaviourBaselineEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .architectureId(architectureId)
            .sessionId(sessionId)
            .name("target replay")
            .status("active")
            .acceptedCaptureCount(3)
            .operationCount(2)
            .kind("target")
            .pairedWithBaselineId(sourceCurrentBaselineId)
            .build();
        baselineRepository.saveAndFlush(target);
        this.targetBaselineId = target.getId();
    }

    @Test
    @DisplayName("create rejects when sourceBaselineId points at a kind='target' baseline (source must be current)")
    void createRejectsSourceNotCurrent() {
        // Swap roles -- use the target baseline as the supposed source.
        CreateApiBehaviourDiffRequest req = new CreateApiBehaviourDiffRequest(
            architectureId, targetBaselineId, targetBaselineId);
        assertThatThrownBy(() -> service.create(projectId, req))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("must point at a kind='current' baseline");
    }

    @Test
    @DisplayName("create rejects when targetBaselineId points at a kind='current' baseline (target must be target)")
    void createRejectsTargetNotTarget() {
        // Use the source baseline as the supposed target.
        CreateApiBehaviourDiffRequest req = new CreateApiBehaviourDiffRequest(
            architectureId, sourceCurrentBaselineId, sourceCurrentBaselineId);
        assertThatThrownBy(() -> service.create(projectId, req))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("must point at a kind='target' baseline");
    }

    @Test
    @DisplayName("create rejects when target's pairedWithBaselineId does not match the diff's sourceBaselineId")
    void createRejectsMismatchedPair() {
        // Seed a second 'current' baseline so the target's paired_with is
        // different from the source we'll pass in.
        ApiBehaviourBaselineEntity unrelatedSource = ApiBehaviourBaselineEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .architectureId(architectureId)
            .sessionId(sessionId)
            .name("unrelated source")
            .status("active")
            .acceptedCaptureCount(1)
            .operationCount(1)
            .kind("current")
            .build();
        baselineRepository.saveAndFlush(unrelatedSource);

        // Source argument != target.pairedWithBaselineId.
        CreateApiBehaviourDiffRequest req = new CreateApiBehaviourDiffRequest(
            architectureId, unrelatedSource.getId(), targetBaselineId);
        assertThatThrownBy(() -> service.create(projectId, req))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("must be paired with sourceBaselineId");
    }

    @Test
    @DisplayName("create succeeds with valid (current, target, paired) triple; row round-trips with status='computing'")
    void createHappyPath() {
        CreateApiBehaviourDiffRequest req = new CreateApiBehaviourDiffRequest(
            architectureId, sourceCurrentBaselineId, targetBaselineId);

        ApiBehaviourDiffDto created = service.create(projectId, req);
        assertThat(created.id()).isNotNull();
        assertThat(created.projectId()).isEqualTo(projectId);
        assertThat(created.architectureId()).isEqualTo(architectureId);
        assertThat(created.sourceBaselineId()).isEqualTo(sourceCurrentBaselineId);
        assertThat(created.targetBaselineId()).isEqualTo(targetBaselineId);
        assertThat(created.status()).isEqualTo("computing");
        assertThat(created.createdAt()).isNotNull();
        assertThat(created.updatedAt()).isNotNull();

        // Reload and confirm.
        var reloaded = diffRepository.findById(created.id()).orElseThrow();
        assertThat(reloaded.getSourceBaselineId()).isEqualTo(sourceCurrentBaselineId);
        assertThat(reloaded.getTargetBaselineId()).isEqualTo(targetBaselineId);
        assertThat(reloaded.getStatus()).isEqualTo("computing");
    }

    @Test
    @DisplayName("PATCH null-guards every field: omitted matchedCount does NOT wipe existing value to 0 (project_primitive_double_dto_overwrite.md)")
    void patchPreservesOmittedCount() {
        // Create.
        CreateApiBehaviourDiffRequest createReq = new CreateApiBehaviourDiffRequest(
            architectureId, sourceCurrentBaselineId, targetBaselineId);
        ApiBehaviourDiffDto created = service.create(projectId, createReq);

        // First PATCH -- populate matchedCount + status.
        UpdateApiBehaviourDiffRequest firstPatch = new UpdateApiBehaviourDiffRequest(
            "completed",
            42,        // matchedCount
            null, null, null, null, null,
            null, null, null, null
        );
        ApiBehaviourDiffDto afterFirst = service.update(projectId, created.id(), firstPatch);
        assertThat(afterFirst.matchedCount()).isEqualTo(42);
        assertThat(afterFirst.status()).isEqualTo("completed");

        // Second PATCH -- omit matchedCount, change only errorMessage. Per the
        // PATCH-safety contract, matchedCount MUST be preserved (not wiped to
        // 0 / null) since the JSON field is missing.
        UpdateApiBehaviourDiffRequest secondPatch = new UpdateApiBehaviourDiffRequest(
            null, null, null, null, null, null, null,
            null, null, null,
            "diff aborted by user"  // errorMessage only
        );
        ApiBehaviourDiffDto afterSecond = service.update(projectId, created.id(), secondPatch);
        assertThat(afterSecond.matchedCount())
            .as("matchedCount must survive a PATCH that omits it (boxed-Integer + null-guard contract)")
            .isEqualTo(42);
        assertThat(afterSecond.status())
            .as("status must survive too (was set in the first PATCH)")
            .isEqualTo("completed");
        assertThat(afterSecond.errorMessage()).isEqualTo("diff aborted by user");
    }
}
