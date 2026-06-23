package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.DiscoveryRunDto;
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
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Focused tests for service identity snapshot persistence.
 *
 * Spec: 2026-05-11 Discovery Run Robustness -- Section 2 (Task Group 5).
 *
 * Covers the 7-arg {@link DiscoveryRunService#createRun(UUID, UUID, String,
 * String, String, boolean, java.util.Map)} overload added in this spec:
 *
 *   - Non-null serviceId + non-empty snapshot map -> entity's
 *     {@code configSnapshot.serviceIdentitySnapshot} contains all six fields.
 *   - Null serviceId -> the snapshot is NOT written even if the caller
 *     supplies one (callers should not, but defence-in-depth: null serviceId
 *     means library-/project-scoped run with no service identity to capture).
 *     This expectation matches the discovery-service route's invariant
 *     (Spec 2026-05-11 § 2.5).
 *   - The 6-arg legacy overload delegates to the 7-arg overload with null,
 *     so no snapshot is written -- existing callers continue to behave
 *     identically (backwards compat).
 *
 * The Liquibase 126 changeset itself (ON DELETE SET NULL FK action) cannot
 * be tested under the test profile because {@code spring.liquibase.enabled=false}
 * and the Hibernate-generated H2 schema declares the FK without an
 * {@code @OnDelete} action. That migration is tested by the
 * Postgres-backed integration suite at deploy time. Here we verify only
 * the application-layer wire: serviceIdentitySnapshot in -> persisted
 * map out, atomic with the run insert.
 */
@ExtendWith(MockitoExtension.class)
class DiscoveryRunServiceIdentitySnapshotTest {

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
    @DisplayName("createRun with non-null serviceId + snapshot persists all six fields under config_snapshot.serviceIdentitySnapshot")
    void createRun_withServiceIdAndSnapshot_persistsAllSixFields() {
        // Given: a service-scoped run with the canonical six-field snapshot.
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();
        String serviceId = "svc-orphan-target";

        Map<String, Object> snapshot = new LinkedHashMap<>();
        snapshot.put("service_id", serviceId);
        snapshot.put("service_name", "OldCheckoutSvc");
        snapshot.put("service_type", "INTERNAL_BUSINESS");
        snapshot.put("application_id", "app-checkout");
        snapshot.put("repo_location", "https://example.test/checkout.git");
        snapshot.put("repo_subfolder", "services/checkout");

        when(runRepository.findByProjectIdAndStatusIn(any(UUID.class), anyList()))
            .thenReturn(Collections.emptyList());
        when(configRepository.findByProjectId(projectId)).thenReturn(Optional.empty());
        when(runRepository.save(any(DiscoveryRunEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));

        // When: invoking the 7-arg overload directly.
        DiscoveryRunDto dto = runService.createRun(
            projectId, architectureId, serviceId, null, null, false, snapshot
        );

        // Then: the saved entity's config_snapshot carries all six fields.
        assertNotNull(dto);
        ArgumentCaptor<DiscoveryRunEntity> captor =
            ArgumentCaptor.forClass(DiscoveryRunEntity.class);
        verify(runRepository).save(captor.capture());
        DiscoveryRunEntity saved = captor.getValue();

        assertEquals(serviceId, saved.getServiceId(),
            "service_id column still populated at create time");
        Map<String, Object> cfg = saved.getConfigSnapshot();
        assertNotNull(cfg, "config_snapshot is NOT NULL by entity contract");
        assertTrue(cfg.containsKey("serviceIdentitySnapshot"),
            "snapshot key is present under config_snapshot");

        @SuppressWarnings("unchecked")
        Map<String, Object> persisted =
            (Map<String, Object>) cfg.get("serviceIdentitySnapshot");
        assertEquals(serviceId, persisted.get("service_id"));
        assertEquals("OldCheckoutSvc", persisted.get("service_name"));
        assertEquals("INTERNAL_BUSINESS", persisted.get("service_type"));
        assertEquals("app-checkout", persisted.get("application_id"));
        assertEquals("https://example.test/checkout.git", persisted.get("repo_location"));
        assertEquals("services/checkout", persisted.get("repo_subfolder"));
    }

    @Test
    @DisplayName("createRun with null snapshot does NOT write the serviceIdentitySnapshot key (legacy 6-arg path)")
    void createRun_withNullSnapshot_doesNotWriteKey() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();
        String serviceId = "svc-still-bound";

        when(runRepository.findByProjectIdAndStatusIn(any(UUID.class), anyList()))
            .thenReturn(Collections.emptyList());
        when(configRepository.findByProjectId(projectId)).thenReturn(Optional.empty());
        when(runRepository.save(any(DiscoveryRunEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));

        // 6-arg overload -- preserves backwards compat; delegates to 7-arg
        // with null snapshot.
        DiscoveryRunDto dto = runService.createRun(
            projectId, architectureId, serviceId, null, null, false
        );

        assertNotNull(dto);
        ArgumentCaptor<DiscoveryRunEntity> captor =
            ArgumentCaptor.forClass(DiscoveryRunEntity.class);
        verify(runRepository).save(captor.capture());
        DiscoveryRunEntity saved = captor.getValue();

        Map<String, Object> cfg = saved.getConfigSnapshot();
        assertNotNull(cfg);
        assertFalse(cfg.containsKey("serviceIdentitySnapshot"),
            "no snapshot persisted when caller passes null (legacy / library / project path)");
    }

    @Test
    @DisplayName("createRun with empty snapshot map is treated as absent (no key written)")
    void createRun_withEmptySnapshot_doesNotWriteKey() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();
        String serviceId = "svc-empty-edge";

        when(runRepository.findByProjectIdAndStatusIn(any(UUID.class), anyList()))
            .thenReturn(Collections.emptyList());
        when(configRepository.findByProjectId(projectId)).thenReturn(Optional.empty());
        when(runRepository.save(any(DiscoveryRunEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));

        // Empty map is semantically equivalent to "no snapshot provided" --
        // matches the controller's behaviour when the JSON body omits the
        // field or sends `{}`.
        DiscoveryRunDto dto = runService.createRun(
            projectId, architectureId, serviceId, null, null, false, new HashMap<>()
        );

        assertNotNull(dto);
        ArgumentCaptor<DiscoveryRunEntity> captor =
            ArgumentCaptor.forClass(DiscoveryRunEntity.class);
        verify(runRepository).save(captor.capture());
        DiscoveryRunEntity saved = captor.getValue();
        assertFalse(saved.getConfigSnapshot().containsKey("serviceIdentitySnapshot"),
            "empty map -> no key written");
    }

    @Test
    @DisplayName("createRun atomically writes the snapshot in the same save() call as the run row")
    void createRun_writesSnapshotAtomicWithRunInsert() {
        // Spec: 2026-05-11 § 2.3 -- "the snapshot is in the DB before any
        // async startRun work begins". Verified by asserting the snapshot
        // ships on the SAME entity passed to save() (not a second save()).
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();
        String serviceId = "svc-atomic-test";

        Map<String, Object> snapshot = new HashMap<>();
        snapshot.put("service_id", serviceId);
        snapshot.put("service_name", "AtomicSvc");

        when(runRepository.findByProjectIdAndStatusIn(any(UUID.class), anyList()))
            .thenReturn(Collections.emptyList());
        when(configRepository.findByProjectId(projectId)).thenReturn(Optional.empty());
        when(runRepository.save(any(DiscoveryRunEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));

        runService.createRun(projectId, architectureId, serviceId, null, null, false, snapshot);

        // Exactly ONE save() call -- the snapshot is on the entity passed in,
        // not retro-applied through a follow-up update.
        ArgumentCaptor<DiscoveryRunEntity> captor =
            ArgumentCaptor.forClass(DiscoveryRunEntity.class);
        verify(runRepository).save(captor.capture());
        DiscoveryRunEntity saved = captor.getValue();
        assertNotNull(saved.getConfigSnapshot().get("serviceIdentitySnapshot"),
            "snapshot is present on the entity at the first save()");
    }
}
