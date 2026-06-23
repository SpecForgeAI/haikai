package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.DiscoveryRunDto;
import com.example.architecturemodel.model.entity.DiscoveryConfigEntity;
import com.example.architecturemodel.model.entity.DiscoveryRunEntity;
import com.example.architecturemodel.repository.entity.DiscoveryCandidateRepository;
import com.example.architecturemodel.repository.entity.DiscoveryClusterRepository;
import com.example.architecturemodel.repository.entity.DiscoveryConfigRepository;
import com.example.architecturemodel.repository.entity.DiscoveryDecisionTaskRepository;
import com.example.architecturemodel.repository.entity.DiscoveryEvidenceRepository;
import com.example.architecturemodel.repository.entity.DiscoveryRelationshipRepository;
import com.example.architecturemodel.repository.entity.DiscoveryRunRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.when;

/**
 * Spec 2026-05-16 Database Discovery Packs.
 *
 * Database-kind runs ({@code discoveryKind='database'}) are project-scoped
 * ({@code serviceId == null}) but they DO NOT carry a Phase 0 discovery
 * config -- their connection details live on the discovery-service request
 * body and are stored in an in-process secrets bundle, not in
 * {@code DiscoveryConfigEntity}.
 *
 * Regression: prior code applied the project-scoped COMPLETE-config gate to
 * every {@code serviceId == null} run, which caused database runs to fail
 * with {@code "Discovery config not found for project: ..."}. The fix
 * extends the guard to {@code serviceId == null && !"database".equals(kind)}
 * so database runs skip the gate.
 *
 * Code-kind project-scoped runs must still enforce the COMPLETE gate -- the
 * sibling {@code DiscoveryRunServiceScopedConfigOptionalTest} covers that
 * direction.
 */
@ExtendWith(MockitoExtension.class)
class DiscoveryRunDatabaseKindNoConfigTest {

    @Mock private DiscoveryRunRepository runRepository;
    @Mock private DiscoveryConfigRepository configRepository;
    @Mock private DiscoveryEvidenceRepository evidenceRepository;
    @Mock private DiscoveryCandidateRepository candidateRepository;
    @Mock private DiscoveryRelationshipRepository relationshipRepository;
    @Mock private DiscoveryClusterRepository clusterRepository;
    @Mock private DiscoveryDecisionTaskRepository decisionTaskRepository;

    private DiscoveryRunService runService;

    @BeforeEach
    void setUp() {
        runService = new DiscoveryRunService(
            runRepository,
            configRepository,
            evidenceRepository,
            candidateRepository,
            relationshipRepository,
            clusterRepository,
            decisionTaskRepository,
            // Capability repo is unused on this test's paths; a bare mock keeps
            // the constructor satisfied without extra wiring.
            org.mockito.Mockito.mock(
                com.example.architecturemodel.repository.discovery.DiscoveryCapabilityRepository.class)
        );
    }

    @Test
    @DisplayName("database-kind run with serviceId=null and NO config row succeeds with empty config snapshot")
    void databaseKindRun_withNullServiceIdAndNoConfig_succeeds() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();

        when(runRepository.findByProjectIdAndStatusIn(any(UUID.class), anyList()))
            .thenReturn(Collections.emptyList());
        when(configRepository.findByProjectId(projectId)).thenReturn(Optional.empty());
        when(runRepository.save(any(DiscoveryRunEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));

        DiscoveryRunDto dto = runService.createRun(
            projectId,
            architectureId,
            /* serviceId */ null,
            /* mode */ null,
            /* warnings */ null,
            /* confirmedLlmSolo */ false,
            /* serviceIdentitySnapshot */ null,
            /* discoveryKind */ "database"
        );

        assertNotNull(dto, "database-kind run must succeed even when no Phase 0 config exists");
        ArgumentCaptor<DiscoveryRunEntity> captor = ArgumentCaptor.forClass(DiscoveryRunEntity.class);
        org.mockito.Mockito.verify(runRepository).save(captor.capture());
        DiscoveryRunEntity saved = captor.getValue();
        assertNull(saved.getServiceId(), "project-scoped run has null serviceId");
        assertNotNull(saved.getConfigSnapshot(), "configSnapshot column is NOT NULL");
        assertTrue(saved.getConfigSnapshot().isEmpty(),
            "no Phase 0 config => empty snapshot (connection details live in the discovery-service body)");
    }

    @Test
    @DisplayName("database-kind run snapshots any existing config payload (informational, status not enforced)")
    void databaseKindRun_snapshotsExistingPayloadWithoutEnforcingStatus() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();

        DiscoveryConfigEntity draft = new DiscoveryConfigEntity();
        draft.setProjectId(projectId);
        Map<String, Object> payload = new HashMap<>();
        payload.put("note", "stale-phase-0-config");
        draft.setConfigPayload(payload);
        draft.setStatus("DRAFT");

        when(runRepository.findByProjectIdAndStatusIn(any(UUID.class), anyList()))
            .thenReturn(Collections.emptyList());
        when(configRepository.findByProjectId(projectId)).thenReturn(Optional.of(draft));
        when(runRepository.save(any(DiscoveryRunEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));

        DiscoveryRunDto dto = runService.createRun(
            projectId, architectureId, null, null, null, false, null, "database");

        assertNotNull(dto, "draft config must NOT block a database-kind run");
        ArgumentCaptor<DiscoveryRunEntity> captor = ArgumentCaptor.forClass(DiscoveryRunEntity.class);
        org.mockito.Mockito.verify(runRepository).save(captor.capture());
        DiscoveryRunEntity saved = captor.getValue();
        assertNotNull(saved.getConfigSnapshot());
        assertEquals("stale-phase-0-config", saved.getConfigSnapshot().get("note"),
            "existing payload is snapshotted informationally");
    }

    @Test
    @DisplayName("code-kind project-scoped run still throws when no config exists (negative-control)")
    void codeKindProjectScopedRun_stillRequiresConfig() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();

        when(runRepository.findByProjectIdAndStatusIn(any(UUID.class), anyList()))
            .thenReturn(Collections.emptyList());
        when(configRepository.findByProjectId(projectId)).thenReturn(Optional.empty());

        IllegalArgumentException ex = assertThrows(
            IllegalArgumentException.class,
            () -> runService.createRun(
                projectId, architectureId, null, null, null, false, null, "code")
        );
        assertTrue(ex.getMessage().contains("Discovery config not found"),
            "code-kind project-scoped runs still enforce the COMPLETE-config gate");
    }
}
