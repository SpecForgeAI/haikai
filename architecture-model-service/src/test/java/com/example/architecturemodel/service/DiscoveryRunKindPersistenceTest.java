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
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

/**
 * Focused tests for the {@code discovery_kind} discriminator column on
 * {@code discovery_run} (Spec: Database Discovery Packs (Sybase + PostgreSQL),
 * 2026-05-16 -- Task Group 1).
 *
 * Verifies:
 *   1. Entity round-trip: {@code DiscoveryRunEntity.discoveryKind} maps cleanly
 *      to {@code DiscoveryRunDto.discoveryKind} via {@code toDto}.
 *   2. Default-when-absent: {@code createRun} with {@code discoveryKind=null}
 *      defaults the persisted entity to {@code 'code'} (back-compat).
 *   3. Default-when-absent (7-arg overload): the legacy 7-arg createRun
 *      preserves its historical behaviour and defaults kind to 'code'.
 *   4. Persistence: {@code createRun} with {@code discoveryKind='database'}
 *      persists the value verbatim onto the entity AND surfaces it on the DTO.
 *   5. Validation: {@code createRun} with an unknown kind throws
 *      {@link IllegalArgumentException} (controller maps to 400).
 *   6. Filter: {@code getRunsByProjectAndArchitectureAndKind} delegates to the
 *      kind-filtered repository method when kind is non-blank, and to the
 *      unfiltered method when kind is null/blank.
 *   7. Backfill simulation: an entity constructed with default builder (no
 *      explicit discoveryKind) has the field initialised to 'code' (mirrors
 *      the DB default + @PrePersist guard for rows pre-dating the migration).
 *
 * Style modeled on {@link DiscoveryRunModePersistenceTest} and
 * {@link DiscoveryRunWarningsAndConfirmPersistenceTest}.
 *
 * The Liquibase changeset 137 itself is not loaded in the test profile
 * (Hibernate ddl-auto creates the schema from JPA annotations); these tests
 * verify the entity/DTO/service plumbing that the migration backs.
 */
@ExtendWith(MockitoExtension.class)
class DiscoveryRunKindPersistenceTest {

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

    // =========================================================================
    // Test 1: Entity -> DTO round-trip preserves discoveryKind
    // =========================================================================

    @Test
    @DisplayName("Test 1: Entity discoveryKind='database' round-trips through DTO via toDto")
    void entityToDto_preservesDatabaseKind() throws Exception {
        UUID runId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();
        Instant now = Instant.now();

        DiscoveryRunEntity entity = DiscoveryRunEntity.builder()
            .id(runId)
            .projectId(projectId)
            .architectureId(architectureId)
            .serviceId(null)
            .mode(null)
            .status("PENDING")
            .discoveryKind("database")
            .configSnapshot(new HashMap<>())
            .stepsPayload(new HashMap<>())
            .createdAt(now)
            .updatedAt(now)
            .build();

        // Stub the repository so getRun returns this entity. We use getRun
        // (not getRunInArchitecture) to keep the test focused on the DTO
        // mapping, not architecture-scope semantics.
        when(runRepository.findById(runId)).thenReturn(Optional.of(entity));

        DiscoveryRunDto dto = runService.getRun(runId);

        assertNotNull(dto, "getRun must surface a DTO for the stubbed entity");
        assertEquals("database", dto.discoveryKind(),
            "discoveryKind must be copied entity -> DTO by toDto");

        // Defence-in-depth: also verify the JSON shape uses the snake-case
        // property name expected by the TypeScript discovery-service client.
        ObjectMapper mapper = new ObjectMapper();
        String json = mapper.writeValueAsString(dto);
        assertTrue(json.contains("\"discovery_kind\":\"database\""),
            "Serialized JSON must expose discovery_kind field. Got: " + json);

        // And: deserialization round-trip preserves the value.
        DiscoveryRunDto roundTrip = mapper.readValue(json, DiscoveryRunDto.class);
        assertEquals("database", roundTrip.discoveryKind(),
            "discoveryKind survives JSON round-trip");
    }

    // =========================================================================
    // Test 2: Default-when-absent on createRun (null discoveryKind -> 'code')
    // =========================================================================

    @Test
    @DisplayName("Test 2: createRun with discoveryKind=null persists 'code' default on the entity")
    void createRun_defaultsKindToCodeWhenNull() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();
        DiscoveryConfigEntity config = new DiscoveryConfigEntity();
        config.setStatus("COMPLETE");
        config.setConfigPayload(new HashMap<>());

        when(runRepository.findByProjectIdAndStatusIn(any(UUID.class), anyList()))
            .thenReturn(Collections.emptyList());
        when(configRepository.findByProjectId(projectId)).thenReturn(Optional.of(config));
        when(runRepository.save(any(DiscoveryRunEntity.class)))
            .thenAnswer(invocation -> {
                DiscoveryRunEntity e = invocation.getArgument(0);
                if (e.getCreatedAt() == null) e.setCreatedAt(Instant.now());
                if (e.getUpdatedAt() == null) e.setUpdatedAt(Instant.now());
                return e;
            });

        // When: discovery-service posts a code run without a kind (back-compat)
        DiscoveryRunDto dto = runService.createRun(
            projectId, architectureId, null, null, null, false, null, null
        );

        // Then: persisted entity has kind='code'
        ArgumentCaptor<DiscoveryRunEntity> captor =
            ArgumentCaptor.forClass(DiscoveryRunEntity.class);
        org.mockito.Mockito.verify(runRepository).save(captor.capture());
        DiscoveryRunEntity saved = captor.getValue();
        assertEquals("code", saved.getDiscoveryKind(),
            "Null discoveryKind must be normalised to 'code' for back-compat");
        assertEquals("code", dto.discoveryKind(),
            "Returned DTO must expose the normalised 'code' value");
    }

    // =========================================================================
    // Test 3: 7-arg overload (legacy callers) defaults kind to 'code'
    // =========================================================================

    @Test
    @DisplayName("Test 3: legacy 7-arg createRun overload defaults discoveryKind to 'code'")
    void createRun_sevenArgOverload_defaultsKindToCode() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();
        DiscoveryConfigEntity config = new DiscoveryConfigEntity();
        config.setStatus("COMPLETE");
        config.setConfigPayload(new HashMap<>());

        when(runRepository.findByProjectIdAndStatusIn(any(UUID.class), anyList()))
            .thenReturn(Collections.emptyList());
        when(configRepository.findByProjectId(projectId)).thenReturn(Optional.of(config));
        when(runRepository.save(any(DiscoveryRunEntity.class)))
            .thenAnswer(invocation -> {
                DiscoveryRunEntity e = invocation.getArgument(0);
                if (e.getCreatedAt() == null) e.setCreatedAt(Instant.now());
                if (e.getUpdatedAt() == null) e.setUpdatedAt(Instant.now());
                return e;
            });

        // When: a pre-existing caller uses the 7-arg overload (no kind param)
        DiscoveryRunDto dto = runService.createRun(
            projectId, architectureId, null, null, null, false, null
        );

        // Then: kind defaults to 'code' transparently
        ArgumentCaptor<DiscoveryRunEntity> captor =
            ArgumentCaptor.forClass(DiscoveryRunEntity.class);
        org.mockito.Mockito.verify(runRepository).save(captor.capture());
        assertEquals("code", captor.getValue().getDiscoveryKind(),
            "Legacy 7-arg createRun must default discoveryKind to 'code'");
        assertEquals("code", dto.discoveryKind());
    }

    // =========================================================================
    // Test 4: createRun with discoveryKind='database' persists 'database'
    // =========================================================================

    @Test
    @DisplayName("Test 4: createRun with discoveryKind='database' persists 'database' verbatim")
    void createRun_persistsDatabaseKindVerbatim() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();
        DiscoveryConfigEntity config = new DiscoveryConfigEntity();
        config.setStatus("COMPLETE");
        config.setConfigPayload(new HashMap<>());

        when(runRepository.findByProjectIdAndStatusIn(any(UUID.class), anyList()))
            .thenReturn(Collections.emptyList());
        when(configRepository.findByProjectId(projectId)).thenReturn(Optional.of(config));
        when(runRepository.save(any(DiscoveryRunEntity.class)))
            .thenAnswer(invocation -> {
                DiscoveryRunEntity e = invocation.getArgument(0);
                if (e.getCreatedAt() == null) e.setCreatedAt(Instant.now());
                if (e.getUpdatedAt() == null) e.setUpdatedAt(Instant.now());
                return e;
            });

        // When: a DB discovery run is created
        DiscoveryRunDto dto = runService.createRun(
            projectId, architectureId, null, null, null, false, null, "database"
        );

        // Then: entity and DTO both carry 'database'
        ArgumentCaptor<DiscoveryRunEntity> captor =
            ArgumentCaptor.forClass(DiscoveryRunEntity.class);
        org.mockito.Mockito.verify(runRepository).save(captor.capture());
        assertEquals("database", captor.getValue().getDiscoveryKind(),
            "discoveryKind='database' must be persisted verbatim on the entity");
        assertEquals("database", dto.discoveryKind(),
            "Returned DTO must expose 'database' kind");
    }

    // =========================================================================
    // Test 5: Validation rejects unknown discoveryKind values
    // =========================================================================

    @Test
    @DisplayName("Test 5: createRun with an unknown discoveryKind throws IllegalArgumentException")
    void createRun_rejectsUnknownKind() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();

        // No stubbing of config/active-run lookups: validation MUST fail before
        // any side-effecting calls so the bad-input request fails fast.
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
            () -> runService.createRun(
                projectId, architectureId, null, null, null, false, null, "graph"
            ),
            "An unknown discoveryKind must yield IllegalArgumentException (controller maps to 400)");
        assertTrue(ex.getMessage().contains("graph"),
            "Error message should mention the offending value. Got: " + ex.getMessage());
        assertTrue(ex.getMessage().toLowerCase().contains("discovery_kind"),
            "Error message should mention the field name. Got: " + ex.getMessage());
    }

    // =========================================================================
    // Test 6: Kind-filtered list delegates to repository correctly
    // =========================================================================

    @Test
    @DisplayName("Test 6: getRunsByProjectAndArchitectureAndKind filters by kind when non-blank")
    void getRunsByProjectAndArchitectureAndKind_filtersByKindWhenNonBlank() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();
        UUID runIdCode = UUID.randomUUID();
        UUID runIdDb = UUID.randomUUID();
        Instant now = Instant.now();

        DiscoveryRunEntity codeRun = DiscoveryRunEntity.builder()
            .id(runIdCode).projectId(projectId).architectureId(architectureId)
            .status("COMPLETED").discoveryKind("code")
            .configSnapshot(new HashMap<>()).stepsPayload(new HashMap<>())
            .createdAt(now).updatedAt(now).build();
        DiscoveryRunEntity dbRun = DiscoveryRunEntity.builder()
            .id(runIdDb).projectId(projectId).architectureId(architectureId)
            .status("COMPLETED").discoveryKind("database")
            .configSnapshot(new HashMap<>()).stepsPayload(new HashMap<>())
            .createdAt(now).updatedAt(now).build();

        // Stub the kind-filtered finder to return ONLY the database run when
        // queried with 'database'. The presence of the codeRun in the broader
        // dataset is implicit (we don't need to stub the unfiltered finder
        // because the kind-filtered service call short-circuits on it).
        when(runRepository.findByProjectIdAndArchitectureIdAndDiscoveryKindOrderByCreatedAtDesc(
                eq(projectId), eq(architectureId), eq("database")))
            .thenReturn(List.of(dbRun));

        // When: the controller calls the kind-filtered list method
        List<DiscoveryRunDto> filtered = runService
            .getRunsByProjectAndArchitectureAndKind(projectId, architectureId, "database");

        // Then: only the database run is returned, and its kind is 'database'
        assertEquals(1, filtered.size(), "kind='database' filter must return exactly the database run");
        assertEquals("database", filtered.get(0).discoveryKind());
        assertEquals(runIdDb, filtered.get(0).id());

        // And: when kind is null/blank, the service falls through to the
        // unfiltered finder (back-compat with pre-existing list calls).
        when(runRepository.findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(
                eq(projectId), eq(architectureId)))
            .thenReturn(Arrays.asList(codeRun, dbRun));

        List<DiscoveryRunDto> unfiltered = runService
            .getRunsByProjectAndArchitectureAndKind(projectId, architectureId, null);
        assertEquals(2, unfiltered.size(),
            "null kind must delegate to the unfiltered finder (no filter applied)");

        List<DiscoveryRunDto> blankFiltered = runService
            .getRunsByProjectAndArchitectureAndKind(projectId, architectureId, "");
        assertEquals(2, blankFiltered.size(),
            "blank kind must delegate to the unfiltered finder (no filter applied)");
    }

    // =========================================================================
    // Test 7: Backfill simulation -- builder default and @PrePersist both
    //         protect against NULL discoveryKind for legacy / pre-migration rows
    // =========================================================================

    @Test
    @DisplayName("Test 7: Builder default and @PrePersist guard backfill discoveryKind to 'code'")
    void entityDefaults_backfillKindToCode() {
        // Given: an entity constructed via the builder WITHOUT specifying
        // discoveryKind (mirrors how the V3 gate / discovery-service called
        // createRun before this spec). The @Builder.Default initializer on
        // the field must populate it with 'code'.
        DiscoveryRunEntity builderDefaulted = DiscoveryRunEntity.builder()
            .id(UUID.randomUUID())
            .projectId(UUID.randomUUID())
            .architectureId(UUID.randomUUID())
            .status("PENDING")
            .configSnapshot(new HashMap<>())
            .stepsPayload(new HashMap<>())
            .build();
        assertEquals("code", builderDefaulted.getDiscoveryKind(),
            "Builder-constructed entity without explicit kind must default to 'code'");

        // Given: an entity constructed via the no-args constructor where the
        // builder defaults do NOT apply (JPA reflection path simulates rows
        // loaded pre-migration). The @PrePersist hook must apply the 'code'
        // default before any INSERT.
        DiscoveryRunEntity noArgsConstructed = new DiscoveryRunEntity();
        noArgsConstructed.setDiscoveryKind(null);  // explicit NULL to simulate legacy
        // Invoke @PrePersist directly (this is what JPA would call before
        // running the INSERT statement). The hook is `protected` per JPA
        // convention so we reflectively call it from a different package.
        invokePrePersist(noArgsConstructed);
        assertEquals("code", noArgsConstructed.getDiscoveryKind(),
            "@PrePersist must apply the 'code' default when kind is NULL "
                + "(defence-in-depth for any code path that bypasses the builder)");

        // Given: an entity with an explicit kind already set -- @PrePersist
        // MUST NOT overwrite the caller's choice.
        DiscoveryRunEntity explicit = new DiscoveryRunEntity();
        explicit.setDiscoveryKind("database");
        invokePrePersist(explicit);
        assertEquals("database", explicit.getDiscoveryKind(),
            "@PrePersist must NOT clobber an explicit non-null discoveryKind");
    }

    /**
     * Reflectively invoke the {@code @PrePersist}-annotated {@code onCreate()}
     * method on {@link DiscoveryRunEntity}. The hook is package-protected per
     * JPA convention; this test lives in the {@code service} package so we
     * cannot call it directly. Mirrors what Hibernate does internally before
     * issuing an INSERT.
     */
    private static void invokePrePersist(DiscoveryRunEntity entity) {
        try {
            java.lang.reflect.Method m =
                DiscoveryRunEntity.class.getDeclaredMethod("onCreate");
            m.setAccessible(true);
            m.invoke(entity);
        } catch (ReflectiveOperationException ex) {
            throw new AssertionError(
                "Failed to invoke @PrePersist onCreate() reflectively", ex);
        }
    }
}
