package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.DiscoveryCandidateDto;
import com.example.architecturemodel.model.entity.DiscoveryCandidateEntity;
import com.example.architecturemodel.repository.entity.DiscoveryCandidateRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Service-layer tests for {@code DiscoveryCandidateService.resolveConflict(...)} /
 * {@code resolveConflictInArchitecture(...)} added by the Conversational
 * Discovery-Review "Architect" Persona spec (Spec 3, 2026-06-02) Task Group 1.
 *
 * <p>The durable, single-attribute server-side conflict-resolution write. Today
 * single-conflict resolution is CLIENT-SIDE-ONLY (the grid mutates {@code data} in
 * React state and persists only on save-back); this write makes a conversational
 * resolution DURABLE IMMEDIATELY by mutating the existing candidate {@code data}
 * JSONB (passthrough -- NO schema / Liquibase change).</p>
 *
 * <p>The proof obligations (Spec 3 tasks 1.1):</p>
 * <ul>
 *   <li><b>camelCase keys inside {@code data}</b>: {@code data._conflictResolutions[attr]}
 *       is stamped with {@code chosenValue} / {@code chosenSource} / {@code resolvedBy} /
 *       {@code resolvedAt} -- matching Spec 0 + the frontend reader
 *       ({@code DiscoveryCandidateTable.tsx} {@code handleResolveConflicts}). {@code data}
 *       is a JSONB passthrough map (Jackson does NOT snake_case map keys), so snake_case
 *       here would silently break the grid + the conversation conflict reader.</li>
 *   <li>the canonical slot {@code data[attr]} is set to the chosen value;</li>
 *   <li>{@code data._conflicts[attr]} is cleared for the resolved attribute;</li>
 *   <li>the write persists IMMEDIATELY via {@code repository.save} (no full-candidate
 *       {@code @PutMapping} round-trip);</li>
 *   <li>committed-parity: like {@code reviewCandidate} (the focused mirror target), the
 *       write does NOT gate {@code status == 'committed'} rows -- a committed candidate
 *       still resolves.</li>
 * </ul>
 *
 * <p>Standalone Mockito setup mirrors {@code DiscoveryCandidateReviewFieldsTest} -- no
 * full Spring context (the AMS suite has unrelated pre-existing failures documented in
 * MEMORY.md).</p>
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class DiscoveryCandidateResolveConflictTest {

    @Mock
    private DiscoveryCandidateRepository candidateRepository;

    @Mock
    private DiscoveryRunArchitectureGuard runGuard;

    private DiscoveryCandidateService service;

    private static final UUID PROJECT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID ARCHITECTURE_ID = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID RUN_ID = UUID.fromString("33333333-3333-3333-3333-333333333333");

    @BeforeEach
    void setUp() {
        service = new DiscoveryCandidateService(candidateRepository, runGuard);
        doNothing().when(runGuard).verify(eq(RUN_ID), eq(PROJECT_ID), eq(ARCHITECTURE_ID));
        when(candidateRepository.save(any(DiscoveryCandidateEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));
    }

    /**
     * Build a candidate carrying ONE live conflict on {@code attr} (a
     * {@code _conflicts[attr]} entry with no matching {@code _conflictResolutions[attr]}),
     * plus a second UNRELATED live conflict so we can prove only the resolved attribute
     * is cleared.
     */
    private DiscoveryCandidateEntity candidateWithLiveConflicts(UUID id, String status) {
        Map<String, Object> frameworkOptions = new HashMap<>();
        Map<String, Object> jaxrs = new HashMap<>();
        jaxrs.put("value", "JAX-RS");
        jaxrs.put("source", "springClassicScanner");
        Map<String, Object> springMvc = new HashMap<>();
        springMvc.put("value", "Spring MVC");
        springMvc.put("source", "annotationScanner");
        List<Map<String, Object>> frameworkConflict = new ArrayList<>(List.of(jaxrs, springMvc));

        Map<String, Object> portOptions = new HashMap<>();
        Map<String, Object> port8080 = new HashMap<>();
        port8080.put("value", 8080);
        port8080.put("source", "configScanner");
        Map<String, Object> port9090 = new HashMap<>();
        port9090.put("value", 9090);
        port9090.put("source", "manifestScanner");
        List<Map<String, Object>> portConflict = new ArrayList<>(List.of(port8080, port9090));

        Map<String, Object> conflicts = new HashMap<>();
        conflicts.put("framework", frameworkConflict);
        conflicts.put("port", portConflict);

        Map<String, Object> data = new HashMap<>();
        data.put("description", "OrderService component");
        data.put("_conflicts", conflicts);
        // No _conflictResolutions yet -> both conflicts are "live".

        return DiscoveryCandidateEntity.builder()
            .id(id)
            .runId(RUN_ID)
            .candidateType("service")
            .name("OrderService")
            .confidence(0.85)
            .status(status)
            .sourceClusterIds(new ArrayList<>(List.of("cluster-1")))
            .data(data)
            .synthesizedAt(Instant.now())
            .reviewStatus("pending_review")
            .build();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> mapAt(Map<String, Object> data, String key) {
        return (Map<String, Object>) data.get(key);
    }

    /**
     * Test 1: resolve stamps {@code data._conflictResolutions[attr]} with the FOUR
     * camelCase keys (chosenValue / chosenSource / resolvedBy / resolvedAt), sets the
     * canonical slot {@code data[attr]}, and clears {@code data._conflicts[attr]} -- the
     * grid-parity payload semantics, end-to-end on a single attribute.
     */
    @Test
    @DisplayName("Test 1: resolve stamps camelCase _conflictResolutions[attr], sets data[attr], clears _conflicts[attr]")
    void resolve_stampsCamelCaseResolution_setsCanonicalSlot_clearsConflict() {
        UUID candidateId = UUID.randomUUID();
        DiscoveryCandidateEntity entity = candidateWithLiveConflicts(candidateId, "proposed");
        when(candidateRepository.findById(candidateId)).thenReturn(Optional.of(entity));

        DiscoveryCandidateDto result = service.resolveConflictInArchitecture(
            RUN_ID, PROJECT_ID, ARCHITECTURE_ID, candidateId,
            "framework", "JAX-RS", "springClassicScanner", "reviewer", null);

        Map<String, Object> data = result.data();

        // Canonical slot <- chosen value.
        assertThat(data).containsEntry("framework", "JAX-RS");

        // _conflictResolutions[framework] stamped with EXACTLY the four camelCase keys.
        Map<String, Object> resolutions = mapAt(data, "_conflictResolutions");
        assertThat(resolutions).containsKey("framework");
        Map<String, Object> frameworkResolution = mapAt(resolutions, "framework");
        assertThat(frameworkResolution)
            .as("the resolution keys MUST be camelCase so the frontend reader sees them")
            .containsOnlyKeys("chosenValue", "chosenSource", "resolvedBy", "resolvedAt");
        assertThat(frameworkResolution).containsEntry("chosenValue", "JAX-RS");
        assertThat(frameworkResolution).containsEntry("chosenSource", "springClassicScanner");
        assertThat(frameworkResolution).containsEntry("resolvedBy", "reviewer");
        assertThat(frameworkResolution.get("resolvedAt"))
            .as("server stamps resolvedAt when the request omits it")
            .isInstanceOf(String.class);
        assertThat((String) frameworkResolution.get("resolvedAt")).isNotBlank();

        // Snake_case keys MUST NOT appear inside data (would silently break the grid).
        assertThat(frameworkResolution)
            .doesNotContainKeys("chosen_value", "chosen_source", "resolved_by", "resolved_at");

        // _conflicts[framework] is cleared; the UNRELATED _conflicts[port] stays live.
        Map<String, Object> conflicts = mapAt(data, "_conflicts");
        assertThat(conflicts)
            .as("only the resolved attribute is removed from _conflicts")
            .doesNotContainKey("framework")
            .containsKey("port");
    }

    /**
     * Test 2: the write persists IMMEDIATELY through the repository save path -- exactly
     * one {@code save}, and the SAVED entity (not just the returned DTO) carries the
     * mutated {@code data}. This proves there is no deferred full-candidate
     * {@code @PutMapping} round-trip.
     */
    @Test
    @DisplayName("Test 2: write persists immediately via repository.save (no deferred full-candidate round-trip)")
    void resolve_persistsImmediatelyViaSave() {
        UUID candidateId = UUID.randomUUID();
        DiscoveryCandidateEntity entity = candidateWithLiveConflicts(candidateId, "proposed");
        when(candidateRepository.findById(candidateId)).thenReturn(Optional.of(entity));

        service.resolveConflictInArchitecture(
            RUN_ID, PROJECT_ID, ARCHITECTURE_ID, candidateId,
            "framework", "JAX-RS", "springClassicScanner", "reviewer",
            "2026-06-02T10:15:30Z");

        ArgumentCaptor<DiscoveryCandidateEntity> captor =
            ArgumentCaptor.forClass(DiscoveryCandidateEntity.class);
        verify(candidateRepository, times(1)).save(captor.capture());

        Map<String, Object> savedData = captor.getValue().getData();
        assertThat(savedData).containsEntry("framework", "JAX-RS");
        Map<String, Object> savedResolutions = mapAt(savedData, "_conflictResolutions");
        Map<String, Object> savedFramework = mapAt(savedResolutions, "framework");
        assertThat(savedFramework).containsEntry("chosenValue", "JAX-RS");
        // The supplied ISO-8601 timestamp is honored verbatim when present.
        assertThat(savedFramework).containsEntry("resolvedAt", "2026-06-02T10:15:30Z");
        assertThat(mapAt(savedData, "_conflicts")).doesNotContainKey("framework");
    }

    /**
     * Test 3: resolving a SECOND attribute on a candidate that already has one resolution
     * preserves the prior resolution (the resolution map is merged, not replaced) and the
     * already-resolved attribute is not re-listed as a live conflict.
     */
    @Test
    @DisplayName("Test 3: a second resolution merges into _conflictResolutions and preserves the first")
    void resolve_secondAttribute_mergesResolutions() {
        UUID candidateId = UUID.randomUUID();
        DiscoveryCandidateEntity entity = candidateWithLiveConflicts(candidateId, "proposed");
        when(candidateRepository.findById(candidateId)).thenReturn(Optional.of(entity));

        // First resolution: framework -> JAX-RS.
        service.resolveConflictInArchitecture(
            RUN_ID, PROJECT_ID, ARCHITECTURE_ID, candidateId,
            "framework", "JAX-RS", "springClassicScanner", "reviewer", null);

        // Second resolution: port -> 8080 (on the same entity, mutated in place).
        DiscoveryCandidateDto result = service.resolveConflictInArchitecture(
            RUN_ID, PROJECT_ID, ARCHITECTURE_ID, candidateId,
            "port", 8080, "configScanner", "reviewer", null);

        Map<String, Object> data = result.data();
        assertThat(data).containsEntry("framework", "JAX-RS");
        assertThat(data).containsEntry("port", 8080);

        Map<String, Object> resolutions = mapAt(data, "_conflictResolutions");
        assertThat(resolutions)
            .as("both resolutions are retained (merge, not replace)")
            .containsKeys("framework", "port");
        assertThat(mapAt(resolutions, "port")).containsEntry("chosenValue", 8080);
        assertThat(mapAt(resolutions, "port")).containsEntry("chosenSource", "configScanner");

        // Both conflicts now cleared.
        assertThat(mapAt(data, "_conflicts"))
            .doesNotContainKey("framework")
            .doesNotContainKey("port");
    }

    /**
     * Test 4: resolvedBy defaults to "anonymous" when null/blank, mirroring
     * {@code reviewCandidate}'s reviewedBy default.
     */
    @Test
    @DisplayName("Test 4: resolvedBy defaults to 'anonymous' when null/blank")
    void resolve_defaultsResolvedByToAnonymous() {
        UUID candidateId = UUID.randomUUID();
        DiscoveryCandidateEntity entity = candidateWithLiveConflicts(candidateId, "proposed");
        when(candidateRepository.findById(candidateId)).thenReturn(Optional.of(entity));

        DiscoveryCandidateDto result = service.resolveConflictInArchitecture(
            RUN_ID, PROJECT_ID, ARCHITECTURE_ID, candidateId,
            "framework", "JAX-RS", "springClassicScanner", "  ", null);

        Map<String, Object> resolution = mapAt(mapAt(result.data(), "_conflictResolutions"), "framework");
        assertThat(resolution).containsEntry("resolvedBy", "anonymous");
    }

    /**
     * Test 5: committed-parity. The focused mirror target {@code reviewCandidate} does NOT
     * gate {@code status == 'committed'} rows (that gate lives only on the cascade bulk
     * path). To stay consistent with the single-candidate review mirror, the resolve write
     * does NOT add a committed guard -- a committed candidate still resolves and persists.
     */
    @Test
    @DisplayName("Test 5: committed-parity -- a committed-status candidate still resolves (mirrors reviewCandidate, which is ungated)")
    void resolve_committedCandidate_stillResolves() {
        UUID candidateId = UUID.randomUUID();
        DiscoveryCandidateEntity entity = candidateWithLiveConflicts(candidateId, "committed");
        when(candidateRepository.findById(candidateId)).thenReturn(Optional.of(entity));

        DiscoveryCandidateDto result = service.resolveConflictInArchitecture(
            RUN_ID, PROJECT_ID, ARCHITECTURE_ID, candidateId,
            "framework", "JAX-RS", "springClassicScanner", "reviewer", null);

        assertThat(result.data()).containsEntry("framework", "JAX-RS");
        assertThat(mapAt(result.data(), "_conflicts")).doesNotContainKey("framework");
        verify(candidateRepository, times(1)).save(any(DiscoveryCandidateEntity.class));
    }

    /**
     * Test 6: a candidate that does not belong to the run is rejected (mirrors the
     * run-ownership guard in {@code reviewCandidate} / {@code updateCandidate}); no save
     * fires.
     */
    @Test
    @DisplayName("Test 6: candidate not belonging to the run throws and does NOT save")
    void resolve_candidateNotInRun_throwsAndDoesNotSave() {
        UUID candidateId = UUID.randomUUID();
        DiscoveryCandidateEntity entity = candidateWithLiveConflicts(candidateId, "proposed");
        UUID foreignRunId = UUID.fromString("99999999-9999-9999-9999-999999999999");
        entity.setRunId(foreignRunId);
        when(candidateRepository.findById(candidateId)).thenReturn(Optional.of(entity));

        assertThatThrownBy(() -> service.resolveConflictInArchitecture(
                RUN_ID, PROJECT_ID, ARCHITECTURE_ID, candidateId,
                "framework", "JAX-RS", "springClassicScanner", "reviewer", null))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("does not belong to run");

        verify(candidateRepository, never()).save(any(DiscoveryCandidateEntity.class));
    }
}
