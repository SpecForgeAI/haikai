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
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Focused JUnit tests for {@link MissingInputResolutionCascadeService}.
 *
 * <p>Spec: Missing Input Resolver Flow (2026-05-20) -- Task Group 3.</p>
 *
 * <p>Three tests from Task 3.1 covering the cascade contract:</p>
 * <ol>
 *   <li>{@link #cascade_flipsDependentSpecsToInsufficientContext} -- a
 *       generated / generated_with_warnings spec is flipped back to
 *       insufficient_context AND has stale fields stamped.</li>
 *   <li>{@link #cascade_alreadyInsufficientContextSpecGetsStaleFieldsStamped}
 *       -- a spec already at insufficient_context KEEPS that status but still
 *       gets {@code stale=true}, {@code stale_reason='resolution_reset'},
 *       {@code stale_marked_at=now()} stamped (audit-trail rule).</li>
 *   <li>{@link #cascade_isIdempotentOnAlreadySoftDeletedResolution} -- calling
 *       cascade twice returns {@code affectedSpecCount=0} on the second
 *       call (no double-flip).</li>
 * </ol>
 */
@ExtendWith(MockitoExtension.class)
class MissingInputResolutionCascadeServiceTest {

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
    private UUID resolutionId;
    private String key;

    @BeforeEach
    void setUp() {
        cascadeService = new MissingInputResolutionCascadeService(
            resolutionService, resolutionRepository, matcherService, specRepository);
        projectId = UUID.randomUUID();
        resolutionId = UUID.randomUUID();
        key = "key-aaaa11111111";
    }

    @Test
    @DisplayName("cascade flips a 'generated' spec back to insufficient_context + stamps stale_reason='resolution_reset'")
    void cascade_flipsDependentSpecsToInsufficientContext() {
        // Prior state: resolution exists and is ACTIVE (not soft-deleted yet).
        MissingInputResolutionEntity priorRow = MissingInputResolutionEntity.builder()
            .id(resolutionId)
            .projectId(projectId)
            .missingInputKey(key)
            .softDeleted(Boolean.FALSE)
            .resolvedBy("alice@example.com")
            .resolvedAt(Instant.now())
            .build();
        when(resolutionRepository.findById(resolutionId)).thenReturn(Optional.of(priorRow));

        // Primitive returns the audited DTO post-soft-delete.
        MissingInputResolutionDto softDeleted = new MissingInputResolutionDto(
            resolutionId, projectId, key, "api_contract", null,
            Instant.now(), "alice@example.com",
            Boolean.TRUE, Instant.now(), "dave@example.com",
            Instant.now(), Instant.now());
        when(resolutionService.softDelete(projectId, resolutionId, "dave@example.com"))
            .thenReturn(softDeleted);

        // Matcher finds one dependent spec at status='generated'.
        UUID specId = UUID.randomUUID();
        MigrationStorySpecGenerationEntity generated = MigrationStorySpecGenerationEntity.builder()
            .id(specId)
            .projectId(projectId)
            .workItemId(UUID.randomUUID())
            .status(MigrationStorySpecGenerationStatus.GENERATED)
            .missingInputKeysJson(new ArrayList<>(List.of(key)))
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
        when(matcherService.findAffectedSpecs(projectId, key))
            .thenReturn(List.of(generated));
        when(specRepository.save(any(MigrationStorySpecGenerationEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));

        Instant before = Instant.now();
        CascadeResult result = cascadeService.softDeleteWithCascade(
            projectId, resolutionId, "dave@example.com");
        Instant after = Instant.now();

        // Status flipped back to insufficient_context + stale fields stamped.
        assertThat(generated.getStatus())
            .isEqualTo(MigrationStorySpecGenerationStatus.INSUFFICIENT_CONTEXT);
        assertThat(generated.getStale()).isEqualTo(Boolean.TRUE);
        assertThat(generated.getStaleReason())
            .isEqualTo(MissingInputResolutionCascadeService.STALE_REASON_RESOLUTION_RESET);
        assertThat(generated.getStaleMarkedAt())
            .isBetween(before.minusSeconds(1), after.plusSeconds(1));

        // Cascade result mirrors what was actually written.
        assertThat(result.affectedSpecCount()).isEqualTo(1);
        assertThat(result.affectedSpecIds()).containsExactly(specId);
        assertThat(result.resolution()).isEqualTo(softDeleted);

        // Primitive was called exactly once.
        verify(resolutionService, times(1)).softDelete(projectId, resolutionId, "dave@example.com");
        verify(specRepository, times(1)).save(any(MigrationStorySpecGenerationEntity.class));
    }

    @Test
    @DisplayName("cascade on insufficient_context spec preserves status but still stamps stale fields (audit trail)")
    void cascade_alreadyInsufficientContextSpecGetsStaleFieldsStamped() {
        MissingInputResolutionEntity priorRow = MissingInputResolutionEntity.builder()
            .id(resolutionId)
            .projectId(projectId)
            .missingInputKey(key)
            .softDeleted(Boolean.FALSE)
            .build();
        when(resolutionRepository.findById(resolutionId)).thenReturn(Optional.of(priorRow));
        MissingInputResolutionDto softDeleted = new MissingInputResolutionDto(
            resolutionId, projectId, key, "mapping", null,
            Instant.now(), "alice@example.com",
            Boolean.TRUE, Instant.now(), "dave@example.com",
            Instant.now(), Instant.now());
        when(resolutionService.softDelete(any(), any(), any())).thenReturn(softDeleted);

        UUID specId = UUID.randomUUID();
        MigrationStorySpecGenerationEntity already = MigrationStorySpecGenerationEntity.builder()
            .id(specId)
            .projectId(projectId)
            .workItemId(UUID.randomUUID())
            .status(MigrationStorySpecGenerationStatus.INSUFFICIENT_CONTEXT)
            .missingInputKeysJson(new ArrayList<>(List.of(key)))
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
        when(matcherService.findAffectedSpecs(projectId, key))
            .thenReturn(List.of(already));
        ArgumentCaptor<MigrationStorySpecGenerationEntity> cap =
            ArgumentCaptor.forClass(MigrationStorySpecGenerationEntity.class);
        when(specRepository.save(cap.capture())).thenAnswer(inv -> inv.getArgument(0));

        Instant before = Instant.now();
        CascadeResult result = cascadeService.softDeleteWithCascade(
            projectId, resolutionId, "dave@example.com");
        Instant after = Instant.now();

        // Status UNCHANGED -- the row was already at insufficient_context.
        assertThat(already.getStatus())
            .isEqualTo(MigrationStorySpecGenerationStatus.INSUFFICIENT_CONTEXT);
        // Stale fields stamped (audit-trail rule).
        assertThat(already.getStale()).isEqualTo(Boolean.TRUE);
        assertThat(already.getStaleReason())
            .isEqualTo(MissingInputResolutionCascadeService.STALE_REASON_RESOLUTION_RESET);
        assertThat(already.getStaleMarkedAt())
            .isBetween(before.minusSeconds(1), after.plusSeconds(1));

        assertThat(result.affectedSpecCount()).isEqualTo(1);
        assertThat(result.affectedSpecIds()).containsExactly(specId);
    }

    @Test
    @DisplayName("cascade is idempotent: a second call on an already-soft-deleted resolution returns 0 affected")
    void cascade_isIdempotentOnAlreadySoftDeletedResolution() {
        // Prior state on SECOND call: resolution is already soft-deleted.
        MissingInputResolutionEntity priorRow = MissingInputResolutionEntity.builder()
            .id(resolutionId)
            .projectId(projectId)
            .missingInputKey(key)
            .softDeleted(Boolean.TRUE)        // <-- already soft-deleted
            .softDeletedAt(Instant.now().minusSeconds(60))
            .softDeletedBy("dave@example.com")
            .resolvedBy("alice@example.com")
            .resolvedAt(Instant.now().minusSeconds(120))
            .build();
        when(resolutionRepository.findById(resolutionId)).thenReturn(Optional.of(priorRow));

        MissingInputResolutionDto refreshed = new MissingInputResolutionDto(
            resolutionId, projectId, key, "target_element", null,
            Instant.now().minusSeconds(120), "alice@example.com",
            Boolean.TRUE, Instant.now(), "dave@example.com",
            Instant.now().minusSeconds(120), Instant.now());
        when(resolutionService.softDelete(projectId, resolutionId, "dave@example.com"))
            .thenReturn(refreshed);

        CascadeResult result = cascadeService.softDeleteWithCascade(
            projectId, resolutionId, "dave@example.com");

        // Second-call idempotency: 0 affected, no spec writes.
        assertThat(result.affectedSpecCount()).isEqualTo(0);
        assertThat(result.affectedSpecIds()).isEmpty();
        // The matcher was NEVER consulted -- the short-circuit fires before
        // the cross-story walk.
        verify(matcherService, never()).findAffectedSpecs(any(), anyString());
        verify(specRepository, never()).save(any());
        // The resolution-level audit channel was still refreshed via the
        // primitive (latest-reset-wins on repeat calls).
        verify(resolutionService, times(1)).softDelete(eq(projectId), eq(resolutionId), eq("dave@example.com"));
    }
}
