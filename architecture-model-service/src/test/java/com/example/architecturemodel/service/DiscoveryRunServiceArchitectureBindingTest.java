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
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.HashMap;
import java.util.NoSuchElementException;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Spec #4 Task Group 2 service-level tests.
 *
 * Two service-level invariants pinned here:
 * <ol>
 *   <li><b>Run-architecture binding is permanent.</b> {@code updateRunInArchitecture}
 *       does NOT mutate {@code architectureId} on the entity, ever.</li>
 *   <li><b>Child-entity JOIN-filter via {@link DiscoveryRunArchitectureGuard}.</b>
 *       Child controllers (evidence, relationship, cluster, candidate, decision-task,
 *       candidate-entity-mapping) verify run-architecture binding before any
 *       persistence or query. Cross-architecture runs are rejected as 404
 *       (NoSuchElementException) so rows from a parallel architecture's runs
 *       cannot leak into the response.</li>
 * </ol>
 *
 * Spec: Discovery Service architectureId Integration (Spec #4 -- 2026-05-01)
 */
class DiscoveryRunServiceArchitectureBindingTest {

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID ARCHITECTURE_A = UUID.randomUUID();
    private static final UUID ARCHITECTURE_B = UUID.randomUUID();

    @Nested
    @ExtendWith(MockitoExtension.class)
    @DisplayName("Run binding is permanent across update paths")
    class RunBindingImmutability {

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

        @InjectMocks
        private DiscoveryRunService discoveryRunService;

        private DiscoveryRunEntity existingRunInA;
        private UUID runId;

        @BeforeEach
        void setUp() {
            runId = UUID.randomUUID();
            Instant now = Instant.now();
            existingRunInA = DiscoveryRunEntity.builder()
                .id(runId)
                .projectId(PROJECT_ID)
                .architectureId(ARCHITECTURE_A)
                .status("RUNNING")
                .currentStep("1a")
                .configSnapshot(new HashMap<>())
                .stepsPayload(new HashMap<>())
                .createdAt(now)
                .updatedAt(now)
                .build();
        }

        /**
         * Property: PUT /runs/{runId} does NOT mutate the run's
         * {@code architectureId} -- ever.
         */
        @Test
        @DisplayName("updateRunInArchitecture preserves architectureId on save (run binding is permanent)")
        void updateRunInArchitecture_doesNotMutateArchitectureId() {
            when(runRepository.findById(runId)).thenReturn(Optional.of(existingRunInA));
            when(runRepository.save(any(DiscoveryRunEntity.class)))
                .thenAnswer(inv -> inv.getArgument(0));

            DiscoveryRunDto result = discoveryRunService.updateRunInArchitecture(
                runId,
                PROJECT_ID,
                ARCHITECTURE_A,
                "COMPLETED",            // status
                null, null, null, null, null
            );

            ArgumentCaptor<DiscoveryRunEntity> savedCaptor =
                ArgumentCaptor.forClass(DiscoveryRunEntity.class);
            verify(runRepository).save(savedCaptor.capture());

            DiscoveryRunEntity savedEntity = savedCaptor.getValue();
            assertThat(savedEntity.getArchitectureId())
                .as("update path MUST NOT mutate architectureId; the run binding is "
                    + "permanent (spec #4 -- one run -> one architecture for life)")
                .isEqualTo(ARCHITECTURE_A);
            assertThat(savedEntity.getProjectId())
                .as("projectId likewise must remain stable across updates")
                .isEqualTo(PROJECT_ID);
            assertThat(savedEntity.getStatus())
                .as("status DID change because that is the legitimate purpose of update()")
                .isEqualTo("COMPLETED");

            assertThat(result.projectId()).isEqualTo(PROJECT_ID);
            assertThat(result.status()).isEqualTo("COMPLETED");
        }
    }

    @Nested
    @ExtendWith(MockitoExtension.class)
    @DisplayName("Child-entity JOIN-filter via DiscoveryRunArchitectureGuard")
    class ChildEntityJoinFilter {

        @Mock
        private DiscoveryRunRepository runRepository;

        @Mock
        private DiscoveryEvidenceRepository evidenceRepository;

        private DiscoveryRunArchitectureGuard runGuard;
        private DiscoveryEvidenceService evidenceService;

        @BeforeEach
        void setUp() {
            runGuard = new DiscoveryRunArchitectureGuard(runRepository);
            evidenceService = new DiscoveryEvidenceService(evidenceRepository, runGuard);
        }

        /**
         * Property: a run that exists but is bound to a DIFFERENT architecture
         * than the one in the URL must be invisible to child-entity reads.
         *
         * The guard performs the JOIN-via-discovery_run filter (no
         * {@code architecture_id} column lives on the evidence child table).
         * Cross-architecture sibling runs in the same project must not leak
         * their evidence rows into the response.
         */
        @Test
        @DisplayName("getByRunIdInArchitecture rejects (404) when the run is bound to a sibling architecture in the same project")
        void getByRunIdInArchitecture_rejectsSiblingArchitectureRun() {
            // Given: the run exists in (PROJECT_ID, ARCHITECTURE_A).
            UUID runId = UUID.randomUUID();
            DiscoveryRunEntity runInA = DiscoveryRunEntity.builder()
                .id(runId)
                .projectId(PROJECT_ID)
                .architectureId(ARCHITECTURE_A)
                .status("COMPLETED")
                .configSnapshot(new HashMap<>())
                .stepsPayload(new HashMap<>())
                .createdAt(Instant.now())
                .updatedAt(Instant.now())
                .build();
            when(runRepository.findById(runId)).thenReturn(Optional.of(runInA));

            // The evidence row would be returned IF the filter let the read through.
            // We do NOT stub evidenceRepository -- if the guard works, it never
            // gets called.

            // When: caller asks for the run's evidence under ARCHITECTURE_B
            // (sibling architecture in the same project).
            // Then: guard throws NoSuchElementException -> controller maps to 404.
            assertThatThrownBy(() -> evidenceService.getByRunIdInArchitecture(
                    runId, PROJECT_ID, ARCHITECTURE_B, null))
                .isInstanceOf(NoSuchElementException.class)
                .hasMessageContaining("not bound to architecture");

            // And: the evidence repository was NEVER touched -- the JOIN-filter
            // short-circuited before any read happened, so no rows from
            // architecture A's run could leak into a response on the architecture
            // B-scoped URL.
            verify(evidenceRepository, never()).findByRunId(any(UUID.class));
            verify(evidenceRepository, never()).findByRunIdAndType(any(UUID.class), any(String.class));
        }
    }
}
