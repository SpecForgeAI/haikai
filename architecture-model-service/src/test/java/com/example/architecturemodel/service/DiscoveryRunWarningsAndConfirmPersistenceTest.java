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
import java.util.Collections;
import java.util.HashMap;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.when;

/**
 * Focused tests for the V3 Tier UX additions to discovery_run persistence.
 *
 * Spec: V3 Tier UX - Task Group 1 (Java schema + DTO + service + endpoints)
 *
 * Verifies the end-to-end path for:
 *   - Entity fields: {@code confirmedLlmSolo} (boolean, default FALSE) and
 *                    {@code warnings} (raw JSON TEXT, nullable).
 *   - DTO fields: {@code confirmedLlmSolo}, {@code warnings} (passthrough JSON
 *                  string), and derived {@code tier} (same single-char value as {@code mode}).
 *   - Service {@code createRun(...)} accepts and persists all three new fields.
 *   - Backward-compat: existing {@code createRun} call shapes without V3 metadata
 *     still succeed with default values.
 *
 * The Liquibase migrations themselves (084 + 085) are not loaded in the test
 * profile ({@code spring.liquibase.enabled=false}); schema is built from the
 * JPA entities via Hibernate ddl-auto. These tests verify the entity/DTO
 * plumbing and service contract that the migrations back.
 *
 * Style modeled on {@link DiscoveryRunModePersistenceTest} and
 * {@link DiscoverySummaryServiceTest}.
 *
 * Spec: Discovery Service architectureId Integration (Spec #4 -- 2026-05-01)
 *   adds the URL-derived {@code architectureId} as the second positional
 *   argument on every {@code createRun} overload.
 *
 * Spec: Discovery Run Robustness (2026-05-11) -- Section 2 adds the seventh
 *   optional {@code serviceIdentitySnapshot} positional argument on the
 *   widest overload.
 *
 * Spec: Oracle Integrity & Determinism (2026-05-30) -- TG1 inserts two trailing
 *   fields on the DTO record between {@code discovery_kind} and {@code status}:
 *   {@code degraded} (boxed Boolean) and {@code degraded_reasons} (String). The
 *   direct DTO constructor calls below pass null/null for them (no degraded
 *   signal), orthogonal to the warnings/confirmedLlmSolo plumbing under test.
 */
@ExtendWith(MockitoExtension.class)
class DiscoveryRunWarningsAndConfirmPersistenceTest {

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
    // Test 1: Entity <-> DTO round-trip for all three new V3 Tier UX fields
    // =========================================================================

    /**
     * Test 1: An entity populated with Tier C metadata (warnings +
     * confirmedLlmSolo + mode='C') converts to a DTO that preserves warnings,
     * confirmedLlmSolo, derives tier='C', and leaves no fields dropped.
     */
    @Test
    @DisplayName("Test 1: Entity -> DTO preserves warnings, confirmedLlmSolo, and derives tier from mode")
    void entityToDto_roundTripsWarningsConfirmedLlmSoloAndDerivesTier() {
        // Given: an entity representing a Tier C run that explicitly opted in
        UUID runId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        Instant now = Instant.now();
        String warningsJson = "[\"Discovery will run in LLM-only mode. "
            + "No language or framework pack matches. "
            + "Pass confirmLlmSolo: true to proceed.\"]";

        DiscoveryRunEntity entity = DiscoveryRunEntity.builder()
            .id(runId)
            .projectId(projectId)
            .serviceId(null)
            .mode("C")
            .warnings(warningsJson)
            .confirmedLlmSolo(true)
            .status("PENDING")
            .configSnapshot(new HashMap<>())
            .stepsPayload(new HashMap<>())
            .createdAt(now)
            .updatedAt(now)
            .build();

        // When: converting via the same shape used by DiscoveryRunService.toDto
        DiscoveryRunDto dto = new DiscoveryRunDto(
            entity.getId(),
            entity.getProjectId(),
            entity.getArchitectureId(),
            entity.getServiceId(),
            entity.getMode(),
            entity.getMode(),                // tier derived from mode
            entity.getWarnings(),
            entity.isConfirmedLlmSolo(),
            null,                            // discoveryKind
            entity.getDegraded(),            // degraded (Oracle Integrity & Determinism)
            entity.getDegradedReasons(),     // degraded_reasons
            entity.getStatus(),
            entity.getCurrentStep(),
            entity.getConfigSnapshot(),
            entity.getStepsPayload(),
            entity.getErrorMessage(),
            entity.getCreatedAt().toString(),
            entity.getUpdatedAt().toString()
        );

        // Then: all three V3 Tier UX fields survive + tier matches mode
        assertEquals("C", dto.mode(), "mode passes through unchanged");
        assertEquals("C", dto.tier(), "tier must be derived from mode (same value)");
        assertEquals(warningsJson, dto.warnings(),
            "warnings JSON text must pass through verbatim (no parsing)");
        assertEquals(Boolean.TRUE, dto.confirmedLlmSolo(),
            "confirmedLlmSolo must survive entity -> DTO");
    }

    // =========================================================================
    // Test 2: Warnings JSON is passthrough — no server-side parsing
    // =========================================================================

    /**
     * Test 2: A JSON-encoded string[] warning payload round-trips through JSON
     * serialization of the DTO without any transformation (archmodel does NOT
     * parse the array — discovery-service is the canonical producer/consumer).
     */
    @Test
    @DisplayName("Test 2: Warnings JSON string passes through DTO JSON serialization verbatim")
    void warningsRoundTripThroughJsonSerialization() throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        String warningsJson = "[\"Tier B warning line 1\",\"Tier B warning line 2\"]";
        String ts = Instant.now().toString();

        DiscoveryRunDto dto = new DiscoveryRunDto(
            UUID.randomUUID(),
            UUID.randomUUID(),
            UUID.randomUUID(),  // architectureId (Spec: Discovery Run Robustness Section 3)
            "svc-42",
            "B",
            "B",
            warningsJson,
            false,
            null,               // discoveryKind
            null,               // degraded (Oracle Integrity & Determinism)
            null,               // degraded_reasons
            "RUNNING",
            null,
            Collections.emptyMap(),
            Collections.emptyMap(),
            null,
            ts,
            ts
        );

        // When: serialize -> deserialize
        String json = mapper.writeValueAsString(dto);
        DiscoveryRunDto roundTrip = mapper.readValue(json, DiscoveryRunDto.class);

        // Then: JSON includes snake-case property names and passthrough value
        assertTrue(json.contains("\"warnings\":"),
            "Serialized JSON must expose warnings field. Got: " + json);
        assertTrue(json.contains("\"tier\":\"B\""),
            "Serialized JSON must expose tier field. Got: " + json);
        assertTrue(json.contains("\"confirmed_llm_solo\":false"),
            "Serialized JSON must expose confirmed_llm_solo field. Got: " + json);
        assertEquals(warningsJson, roundTrip.warnings(),
            "warnings string must round-trip unchanged through JSON");
        assertEquals("B", roundTrip.tier(), "tier should survive JSON round-trip");
        assertEquals(Boolean.FALSE, roundTrip.confirmedLlmSolo());
    }

    // =========================================================================
    // Test 3: createRun accepts and persists all new V3 Tier UX fields
    // =========================================================================

    /**
     * Test 3: {@code createRun(projectId, architectureId, serviceId, mode,
     * warnings, confirmedLlmSolo)} persists all three new fields onto the saved
     * entity and exposes them (plus derived tier) on the returned DTO.
     */
    @Test
    @DisplayName("Test 3: createRun persists mode, warnings, and confirmedLlmSolo on the new entity")
    void createRun_persistsModeWarningsAndConfirmedLlmSolo() {
        // Given: a ready-to-run project with COMPLETE config and no active runs
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
                // simulate JPA @PrePersist timestamps
                if (e.getCreatedAt() == null) e.setCreatedAt(Instant.now());
                if (e.getUpdatedAt() == null) e.setUpdatedAt(Instant.now());
                return e;
            });

        String warningsJson = "[\"Tier B warning\"]";

        // When: discovery-service posts a Tier B run with warnings
        DiscoveryRunDto dto = runService.createRun(
            projectId,
            architectureId,
            "svc-tier-b",
            "B",
            warningsJson,
            false
        );

        // Then: service wrote all three new fields onto the entity
        ArgumentCaptor<DiscoveryRunEntity> captor =
            ArgumentCaptor.forClass(DiscoveryRunEntity.class);
        org.mockito.Mockito.verify(runRepository).save(captor.capture());
        DiscoveryRunEntity saved = captor.getValue();

        assertEquals("B", saved.getMode(), "mode should be set from createRun arg");
        assertEquals(warningsJson, saved.getWarnings(),
            "warnings JSON should be passed through verbatim to the entity");
        assertFalse(saved.isConfirmedLlmSolo(),
            "confirmedLlmSolo defaults to false for Tier B runs");
        assertEquals("svc-tier-b", saved.getServiceId());
        assertEquals(projectId, saved.getProjectId());

        // And: DTO exposes all fields plus derived tier
        assertEquals("B", dto.mode());
        assertEquals("B", dto.tier(), "tier must be derived from mode on every read");
        assertEquals(warningsJson, dto.warnings());
        assertEquals(Boolean.FALSE, dto.confirmedLlmSolo());
    }

    // =========================================================================
    // Test 4: Tier C opt-in flow — confirmedLlmSolo=true persists correctly
    // =========================================================================

    /**
     * Test 4: Tier C run with explicit {@code confirmLlmSolo: true} sets
     * {@code confirmed_llm_solo = TRUE} on the saved entity and mode='C'.
     */
    @Test
    @DisplayName("Test 4: createRun with confirmedLlmSolo=true persists TRUE on Tier C run")
    void createRun_persistsConfirmedLlmSoloTrueForTierCOptIn() {
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

        String tierCWarnings = "[\"Discovery will run in LLM-only mode. "
            + "No language or framework pack matches. "
            + "Pass confirmLlmSolo: true to proceed.\"]";

        // When: Tier C with opt-in proceeds
        DiscoveryRunDto dto = runService.createRun(
            projectId, architectureId, null, "C", tierCWarnings, true
        );

        // Then: the opt-in flag is persisted, mode='C', warnings populated
        ArgumentCaptor<DiscoveryRunEntity> captor =
            ArgumentCaptor.forClass(DiscoveryRunEntity.class);
        org.mockito.Mockito.verify(runRepository).save(captor.capture());
        DiscoveryRunEntity saved = captor.getValue();

        assertEquals("C", saved.getMode());
        assertEquals(tierCWarnings, saved.getWarnings());
        assertTrue(saved.isConfirmedLlmSolo(),
            "confirmed_llm_solo must be TRUE when discovery-service posts confirmLlmSolo=true");
        assertEquals(Boolean.TRUE, dto.confirmedLlmSolo());
        assertEquals("C", dto.tier(), "tier derived from mode='C' is 'C'");
    }

    // =========================================================================
    // Test 5: Backward compat — legacy createRun signatures still work
    // =========================================================================

    /**
     * Test 5: Legacy callers using {@code createRun(projectId, architectureId)}
     * and {@code createRun(projectId, architectureId, serviceId)} without V3
     * Tier UX metadata still succeed and default the three new fields sensibly:
     *   - mode = null
     *   - warnings = null
     *   - confirmedLlmSolo = false
     */
    @Test
    @DisplayName("Test 5: Legacy createRun signatures still work with default V3 field values")
    void createRun_backwardCompat_defaultsV3FieldsWhenNotSupplied() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();
        DiscoveryConfigEntity config = new DiscoveryConfigEntity();
        config.setStatus("COMPLETE");
        config.setConfigPayload(new HashMap<>());

        when(runRepository.findByProjectIdAndStatusIn(any(UUID.class), anyList()))
            .thenReturn(Collections.emptyList());
        // Any projectId resolves to the same COMPLETE config in this test
        when(configRepository.findByProjectId(any(UUID.class)))
            .thenReturn(Optional.of(config));
        when(runRepository.save(any(DiscoveryRunEntity.class)))
            .thenAnswer(invocation -> {
                DiscoveryRunEntity e = invocation.getArgument(0);
                if (e.getCreatedAt() == null) e.setCreatedAt(Instant.now());
                if (e.getUpdatedAt() == null) e.setUpdatedAt(Instant.now());
                return e;
            });

        // When: a pre-V3 caller uses the two-arg overload (projectId, architectureId)
        DiscoveryRunDto legacyDto = runService.createRun(projectId, architectureId);

        // Then: V3 fields default correctly
        assertNull(legacyDto.mode(), "mode defaults to null for legacy callers");
        assertNull(legacyDto.tier(), "tier (derived from mode) is null when mode is null");
        assertNull(legacyDto.warnings(), "warnings defaults to null");
        assertEquals(Boolean.FALSE, legacyDto.confirmedLlmSolo(),
            "confirmedLlmSolo defaults to FALSE — no opt-in recorded");

        // And: service-scoped three-arg overload also defaults V3 fields
        DiscoveryRunDto svcDto =
            runService.createRun(UUID.randomUUID(), UUID.randomUUID(), "svc-legacy");
        assertNull(svcDto.mode());
        assertNull(svcDto.warnings());
        assertEquals(Boolean.FALSE, svcDto.confirmedLlmSolo());
    }

    // =========================================================================
    // Test 6: updateRun accepts warnings for the proceed-after-gate flow
    // =========================================================================

    /**
     * Test 6: {@code updateRun(..., mode, warnings)} persists both V3 fields on
     * an existing entity. This is the proceed-after-gate path where the gate
     * computes/refreshes warnings without rebuilding the run entity.
     *
     * Note: {@code confirmedLlmSolo} is intentionally NOT updatable (set once at
     * creation), matching the spec's "audit trace" requirement.
     */
    @Test
    @DisplayName("Test 6: updateRun accepts warnings and mode; does not touch confirmedLlmSolo")
    void updateRun_acceptsWarningsAndModeWithoutTouchingConfirmedLlmSolo() {
        UUID runId = UUID.randomUUID();
        DiscoveryRunEntity existing = DiscoveryRunEntity.builder()
            .id(runId)
            .projectId(UUID.randomUUID())
            .mode("A")
            .warnings(null)
            .confirmedLlmSolo(true)   // intentionally non-default to prove it's not overwritten
            .status("RUNNING")
            .configSnapshot(new HashMap<>())
            .stepsPayload(new HashMap<>())
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        when(runRepository.findById(runId)).thenReturn(Optional.of(existing));
        when(runRepository.save(any(DiscoveryRunEntity.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));

        String newWarnings = "[\"Updated warning after gate proceed\"]";
        DiscoveryRunDto dto = runService.updateRun(
            runId,
            "RUNNING",
            "1b",
            null,
            null,
            "B",              // mode change A -> B
            newWarnings       // warnings populated via update
        );

        // Then: mode and warnings updated; confirmedLlmSolo untouched
        assertEquals("B", dto.mode());
        assertEquals("B", dto.tier(), "tier always matches mode");
        assertEquals(newWarnings, dto.warnings());
        assertEquals(Boolean.TRUE, dto.confirmedLlmSolo(),
            "confirmedLlmSolo is create-time only — updateRun must not modify it");
    }
}
