package com.example.architecturemodel.service.migration;

import com.example.architecturemodel.model.dto.migration.MissingInputResolutionDto;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationEntity;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationStatus;
import com.example.architecturemodel.model.entity.MissingInputResolutionEntity;
import com.example.architecturemodel.repository.entity.MigrationStorySpecGenerationRepository;
import com.example.architecturemodel.repository.entity.MissingInputResolutionRepository;
import com.example.architecturemodel.service.migration.MissingInputResolutionCascadeService.CascadeResult;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Cross-layer gap test for the "ALL keys required" cascade direction.
 *
 * <p>Spec: Missing Input Resolver Flow (2026-05-20) -- Task Group 8.3.</p>
 *
 * <h2>The gap this test closes</h2>
 * The existing {@link MissingInputResolutionCascadeServiceTest} cases prove
 * that a generated spec is flipped when its single missing-input key is
 * reset. None of those cases exercise the multi-key shape that
 * {@code ready-to-retry} actually cares about: a spec with TWO keys, both
 * resolved -> ready; reset ONE of the two -> spec MUST flip (because the
 * "every key must have an active resolution" rule is now broken) WITHOUT
 * touching the OTHER resolution's row.
 *
 * <p>The cascade-direction invariant we verify here:</p>
 * <ol>
 *   <li>{@code MissingInputResolutionService.softDelete} is invoked EXACTLY
 *       once -- only for the resolution the user explicitly reset.</li>
 *   <li>The matcher is consulted for the reset key ONLY -- the second key's
 *       resolution row is NEVER touched (no soft-delete on the other key).</li>
 *   <li>The dependent spec is flipped back to {@code insufficient_context}
 *       and stamped with {@code stale_reason=resolution_reset}.</li>
 * </ol>
 *
 * <p>The reverse direction (re-resolve the reset key -> ready-to-retry again)
 * is covered by the matcher-service tests; this test sits at the cascade
 * coordinator layer where the multi-key isolation lives.</p>
 */
@ExtendWith(MockitoExtension.class)
class MissingInputResolutionMultiKeyCascadeTest {

    @Mock
    private MissingInputResolutionService resolutionService;

    @Mock
    private MissingInputResolutionRepository resolutionRepository;

    @Mock
    private MissingInputCrossStoryMatcherService matcherService;

    @Mock
    private MigrationStorySpecGenerationRepository specRepository;

    private MissingInputResolutionCascadeService cascadeService;

    private UUID projectId;

    @BeforeEach
    void setUp() {
        cascadeService = new MissingInputResolutionCascadeService(
            resolutionService, resolutionRepository, matcherService, specRepository);
        projectId = UUID.randomUUID();
    }

    @Test
    @DisplayName(
        "multi-key cascade: resetting ONE of two resolutions flips the spec "
        + "WITHOUT touching the sibling resolution row")
    void multiKeyCascade_resetOneFlipsSpecWithoutTouchingTheOtherResolution() {
        // Two resolutions exist for the same spec, both currently ACTIVE.
        UUID resolutionAId = UUID.randomUUID();
        UUID resolutionBId = UUID.randomUUID();
        String keyA = "key-aaaa11111111";
        String keyB = "key-bbbb22222222";

        // Spec is currently GENERATED with BOTH keys in missing_input_keys_json
        // (a spec is "ready-to-retry" once both resolutions are active; assume
        // a prior retry succeeded, so status is back to GENERATED).
        UUID specId = UUID.randomUUID();
        MigrationStorySpecGenerationEntity spec = MigrationStorySpecGenerationEntity.builder()
            .id(specId)
            .projectId(projectId)
            .workItemId(UUID.randomUUID())
            .status(MigrationStorySpecGenerationStatus.GENERATED)
            .missingInputKeysJson(new ArrayList<>(List.of(keyA, keyB)))
            .stale(Boolean.FALSE)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        // Prior state for resolution A: ACTIVE (not soft-deleted yet).
        MissingInputResolutionEntity priorA = MissingInputResolutionEntity.builder()
            .id(resolutionAId)
            .projectId(projectId)
            .missingInputKey(keyA)
            .missingInputType("api_contract")
            .softDeleted(Boolean.FALSE)
            .resolvedBy("alice@example.com")
            .resolvedAt(Instant.now().minusSeconds(60))
            .build();
        when(resolutionRepository.findById(resolutionAId))
            .thenReturn(Optional.of(priorA));

        // Primitive returns the audited DTO post-soft-delete (key A only).
        MissingInputResolutionDto softDeletedA = new MissingInputResolutionDto(
            resolutionAId, projectId, keyA, "api_contract", null,
            Instant.now().minusSeconds(60), "alice@example.com",
            Boolean.TRUE, Instant.now(), "dave@example.com",
            Instant.now().minusSeconds(60), Instant.now());
        when(resolutionService.softDelete(projectId, resolutionAId, "dave@example.com"))
            .thenReturn(softDeletedA);

        // Matcher finds the spec when consulted for key A. The matcher is
        // expected to be queried for KEY A ONLY -- never for key B (we have
        // no stub for key B; an unexpected call would surface as a null/empty
        // matcher response in the assertions below).
        when(matcherService.findAffectedSpecs(projectId, keyA))
            .thenReturn(List.of(spec));
        when(specRepository.save(any(MigrationStorySpecGenerationEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));

        Instant before = Instant.now();
        CascadeResult result = cascadeService.softDeleteWithCascade(
            projectId, resolutionAId, "dave@example.com");
        Instant after = Instant.now();

        // ----- Assertion 1: spec flipped back to insufficient_context -----
        assertThat(spec.getStatus())
            .as("spec must flip back to insufficient_context when ANY of its keys is reset")
            .isEqualTo(MigrationStorySpecGenerationStatus.INSUFFICIENT_CONTEXT);
        assertThat(spec.getStale()).isEqualTo(Boolean.TRUE);
        assertThat(spec.getStaleReason())
            .isEqualTo(MissingInputResolutionCascadeService.STALE_REASON_RESOLUTION_RESET);
        assertThat(spec.getStaleMarkedAt())
            .isBetween(before.minusSeconds(1), after.plusSeconds(1));

        // ----- Assertion 2: cascade result mirrors what was written -----
        assertThat(result.affectedSpecCount()).isEqualTo(1);
        assertThat(result.affectedSpecIds()).containsExactly(specId);

        // ----- Assertion 3: ISOLATION -- the sibling resolution row was NOT
        // touched. softDelete must have been called exactly once and only for
        // resolution A; resolution B's id was NEVER soft-deleted nor was its
        // row consulted via findById.
        verify(resolutionService, times(1))
            .softDelete(projectId, resolutionAId, "dave@example.com");
        verify(resolutionService, never())
            .softDelete(eq(projectId), eq(resolutionBId), any());
        verify(resolutionRepository, never()).findById(resolutionBId);

        // ----- Assertion 4: matcher consulted for keyA only.
        verify(matcherService, times(1)).findAffectedSpecs(projectId, keyA);
        verify(matcherService, never()).findAffectedSpecs(projectId, keyB);

        // ----- Assertion 5: spec's missing_input_keys_json was NOT mutated -
        // both keys still appear so that re-resolving keyA puts the spec back
        // into the ready-to-retry pool (and so audit-history is intact).
        assertThat(spec.getMissingInputKeysJson())
            .containsExactlyInAnyOrder(keyA, keyB);
    }
}
