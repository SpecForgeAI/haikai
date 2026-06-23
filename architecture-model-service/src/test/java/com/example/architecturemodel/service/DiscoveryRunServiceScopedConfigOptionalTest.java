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
 * Service-scoped discovery runs do not require Phase 0 discovery config.
 *
 * A service row + its parent application/component already carry everything
 * the pipeline needs (repo, subfolder, resolved language/framework packs),
 * so {@code createRun(projectId, serviceId, ...)} must succeed even when
 * no config exists for the project, or when the config is not COMPLETE.
 *
 * Project-scoped runs (serviceId == null) still enforce a COMPLETE config.
 */
@ExtendWith(MockitoExtension.class)
class DiscoveryRunServiceScopedConfigOptionalTest {

    @Mock
    private DiscoveryRunRepository runRepository;

    @Mock
    private DiscoveryConfigRepository configRepository;

    @Mock
    private DiscoveryEvidenceRepository evidenceRepository;

    @Mock
    private DiscoveryCandidateRepository candidateRepository;

    @Mock
    private DiscoveryRelationshipRepository relationshipRepository;

    @Mock
    private DiscoveryClusterRepository clusterRepository;

    @Mock
    private DiscoveryDecisionTaskRepository decisionTaskRepository;

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
    @DisplayName("service-scoped run succeeds with NO config and uses empty config snapshot")
    void serviceScopedRun_succeedsWhenConfigMissing() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();
        String serviceId = "svc-1";

        when(runRepository.findByProjectIdAndStatusIn(any(UUID.class), anyList()))
            .thenReturn(Collections.emptyList());
        when(configRepository.findByProjectId(projectId)).thenReturn(Optional.empty());
        when(runRepository.save(any(DiscoveryRunEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));

        DiscoveryRunDto dto = runService.createRun(projectId, architectureId, serviceId);

        assertNotNull(dto);
        ArgumentCaptor<DiscoveryRunEntity> captor = ArgumentCaptor.forClass(DiscoveryRunEntity.class);
        org.mockito.Mockito.verify(runRepository).save(captor.capture());
        DiscoveryRunEntity saved = captor.getValue();
        assertEquals(serviceId, saved.getServiceId());
        assertNotNull(saved.getConfigSnapshot(), "configSnapshot column is NOT NULL; must be empty map");
        assertTrue(saved.getConfigSnapshot().isEmpty(), "no config => empty snapshot");
    }

    @Test
    @DisplayName("service-scoped run succeeds when config exists but is DRAFT (not COMPLETE)")
    void serviceScopedRun_succeedsWhenConfigIsDraft() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();
        String serviceId = "svc-1";

        DiscoveryConfigEntity draft = new DiscoveryConfigEntity();
        draft.setProjectId(projectId);
        Map<String, Object> payload = new HashMap<>();
        payload.put("repositories", Collections.emptyList());
        draft.setConfigPayload(payload);
        draft.setStatus("DRAFT");

        when(runRepository.findByProjectIdAndStatusIn(any(UUID.class), anyList()))
            .thenReturn(Collections.emptyList());
        when(configRepository.findByProjectId(projectId)).thenReturn(Optional.of(draft));
        when(runRepository.save(any(DiscoveryRunEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));

        DiscoveryRunDto dto = runService.createRun(projectId, architectureId, serviceId);

        assertNotNull(dto);
        ArgumentCaptor<DiscoveryRunEntity> captor = ArgumentCaptor.forClass(DiscoveryRunEntity.class);
        org.mockito.Mockito.verify(runRepository).save(captor.capture());
        DiscoveryRunEntity saved = captor.getValue();
        assertEquals(serviceId, saved.getServiceId());
        // Even in DRAFT state, snapshot the payload (informational) — we skip the status gate.
        assertNotNull(saved.getConfigSnapshot());
        assertTrue(saved.getConfigSnapshot().containsKey("repositories"));
    }

    @Test
    @DisplayName("project-scoped run still throws when config is missing")
    void projectScopedRun_stillRequiresConfig() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();

        when(runRepository.findByProjectIdAndStatusIn(any(UUID.class), anyList()))
            .thenReturn(Collections.emptyList());
        when(configRepository.findByProjectId(projectId)).thenReturn(Optional.empty());

        IllegalArgumentException ex = assertThrows(
            IllegalArgumentException.class,
            () -> runService.createRun(projectId, architectureId)
        );
        assertTrue(ex.getMessage().contains("Discovery config not found"));
    }

    @Test
    @DisplayName("project-scoped run still throws when config is not COMPLETE")
    void projectScopedRun_stillRequiresCompleteStatus() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();

        DiscoveryConfigEntity draft = new DiscoveryConfigEntity();
        draft.setProjectId(projectId);
        draft.setConfigPayload(new HashMap<>());
        draft.setStatus("DRAFT");

        when(runRepository.findByProjectIdAndStatusIn(any(UUID.class), anyList()))
            .thenReturn(Collections.emptyList());
        when(configRepository.findByProjectId(projectId)).thenReturn(Optional.of(draft));

        IllegalArgumentException ex = assertThrows(
            IllegalArgumentException.class,
            () -> runService.createRun(projectId, architectureId)
        );
        assertTrue(ex.getMessage().contains("not COMPLETE"));
    }
}
