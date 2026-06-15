package com.example.architecturemodel.service.migration;

import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationEntity;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationStatus;
import com.example.architecturemodel.model.entity.MissingInputResolutionEntity;
import com.example.architecturemodel.repository.entity.MigrationStorySpecGenerationRepository;
import com.example.architecturemodel.repository.entity.MissingInputResolutionRepository;
import com.example.architecturemodel.service.migration.MissingInputCrossStoryMatcherService.ReadyToRetrySummary;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

/**
 * Focused JUnit tests for {@link MissingInputCrossStoryMatcherService}.
 *
 * <p>Spec: Missing Input Resolver Flow (2026-05-20) -- Task Group 3.</p>
 *
 * <p>Three tests from Task 3.1 covering the matcher contract:</p>
 * <ol>
 *   <li>{@link #readyToRetry_returnsOnlySpecsWhereAllKeysAreResolved} -- partial
 *       coverage (2 of 3 keys resolved) is NOT ready-to-retry.</li>
 *   <li>{@link #readyToRetry_specWithAllKeysResolvedIsReady} -- all 3 keys
 *       resolved -> ready-to-retry returns that spec.</li>
 *   <li>{@link #findAffectedSpecs_returnsSpecsContainingKey} -- given a key,
 *       returns every spec in the project whose
 *       {@code missing_input_keys_json} contains it.</li>
 * </ol>
 *
 * <p>Pure Mockito (no Spring context) following the standalone-JUnit pattern
 * established by {@link MissingInputResolutionServiceTest}.</p>
 */
@ExtendWith(MockitoExtension.class)
class MissingInputCrossStoryMatcherServiceTest {

    @Mock
    private MigrationStorySpecGenerationRepository specRepository;

    @Mock
    private MissingInputResolutionRepository resolutionRepository;

    private MissingInputCrossStoryMatcherService matcher;

    private UUID projectId;

    @BeforeEach
    void setUp() {
        matcher = new MissingInputCrossStoryMatcherService(specRepository, resolutionRepository);
        projectId = UUID.randomUUID();
    }

    @Test
    @DisplayName("findReadyToRetry: spec with 3 keys and only 2 active resolutions is NOT ready")
    void readyToRetry_returnsOnlySpecsWhereAllKeysAreResolved() {
        UUID specId = UUID.randomUUID();
        UUID workItemId = UUID.randomUUID();
        MigrationStorySpecGenerationEntity spec = buildSpec(
            specId, workItemId,
            MigrationStorySpecGenerationStatus.INSUFFICIENT_CONTEXT,
            List.of("key-aaaa11111111", "key-bbbb22222222", "key-cccc33333333"));
        when(specRepository.findByProjectId(projectId)).thenReturn(List.of(spec));

        // Only 2 of the 3 keys have active resolutions -- spec NOT ready.
        when(resolutionRepository.findByProjectIdAndMissingInputKeyInAndSoftDeletedFalse(
                eq(projectId), any(Collection.class)))
            .thenReturn(List.of(
                resolution(projectId, "key-aaaa11111111"),
                resolution(projectId, "key-bbbb22222222")));

        ReadyToRetrySummary summary = matcher.findReadyToRetry(projectId);

        assertThat(summary.count()).isEqualTo(0);
        assertThat(summary.stories()).isEmpty();
        assertThat(summary.specGenerationIds()).isEmpty();
    }

    @Test
    @DisplayName("findReadyToRetry: spec with 3 keys and 3 active resolutions IS ready")
    void readyToRetry_specWithAllKeysResolvedIsReady() {
        UUID specId = UUID.randomUUID();
        UUID workItemId = UUID.randomUUID();
        MigrationStorySpecGenerationEntity ready = buildSpec(
            specId, workItemId,
            MigrationStorySpecGenerationStatus.INSUFFICIENT_CONTEXT,
            List.of("key-aaaa11111111", "key-bbbb22222222", "key-cccc33333333"));
        // A second spec that is not insufficient_context -- should be filtered.
        MigrationStorySpecGenerationEntity generated = buildSpec(
            UUID.randomUUID(), UUID.randomUUID(),
            MigrationStorySpecGenerationStatus.GENERATED,
            List.of("key-aaaa11111111"));
        // A third spec that is insufficient_context but with empty keys --
        // ignored (cannot be ready when there is nothing to resolve).
        MigrationStorySpecGenerationEntity noKeys = buildSpec(
            UUID.randomUUID(), UUID.randomUUID(),
            MigrationStorySpecGenerationStatus.INSUFFICIENT_CONTEXT,
            List.of());
        when(specRepository.findByProjectId(projectId))
            .thenReturn(List.of(ready, generated, noKeys));

        when(resolutionRepository.findByProjectIdAndMissingInputKeyInAndSoftDeletedFalse(
                eq(projectId), any(Collection.class)))
            .thenReturn(List.of(
                resolution(projectId, "key-aaaa11111111"),
                resolution(projectId, "key-bbbb22222222"),
                resolution(projectId, "key-cccc33333333")));

        ReadyToRetrySummary summary = matcher.findReadyToRetry(projectId);

        assertThat(summary.count()).isEqualTo(1);
        assertThat(summary.specGenerationIds()).containsExactly(specId);
        assertThat(summary.stories()).hasSize(1);
        assertThat(summary.stories().get(0).specGenerationId()).isEqualTo(specId);
        assertThat(summary.stories().get(0).workItemId()).isEqualTo(workItemId);
        assertThat(summary.stories().get(0).totalKeys()).isEqualTo(3);
        assertThat(summary.stories().get(0).resolvedKeys()).isEqualTo(3);
    }

    @Test
    @DisplayName("findAffectedSpecs: returns every spec in project whose missing_input_keys_json contains the key")
    void findAffectedSpecs_returnsSpecsContainingKey() {
        UUID s1Id = UUID.randomUUID();
        UUID s2Id = UUID.randomUUID();
        UUID s3Id = UUID.randomUUID();
        MigrationStorySpecGenerationEntity s1 = buildSpec(
            s1Id, UUID.randomUUID(),
            MigrationStorySpecGenerationStatus.INSUFFICIENT_CONTEXT,
            List.of("key-target0000001", "key-aaaa11111111"));
        MigrationStorySpecGenerationEntity s2 = buildSpec(
            s2Id, UUID.randomUUID(),
            MigrationStorySpecGenerationStatus.GENERATED,
            List.of("key-target0000001"));
        MigrationStorySpecGenerationEntity s3 = buildSpec(
            s3Id, UUID.randomUUID(),
            MigrationStorySpecGenerationStatus.INSUFFICIENT_CONTEXT,
            List.of("key-other000000")); // does not contain the target key
        when(specRepository.findByProjectId(projectId))
            .thenReturn(List.of(s1, s2, s3));

        List<MigrationStorySpecGenerationEntity> affected =
            matcher.findAffectedSpecs(projectId, "key-target0000001");

        // Both s1 and s2 reference the key, regardless of status (the cascade
        // caller chooses what to do per-status).
        assertThat(affected).hasSize(2);
        Set<UUID> ids = new HashSet<>();
        for (MigrationStorySpecGenerationEntity e : affected) ids.add(e.getId());
        assertThat(ids).containsExactlyInAnyOrder(s1Id, s2Id);
    }

    // -------- helpers --------

    private MigrationStorySpecGenerationEntity buildSpec(
            UUID id, UUID workItemId, String status, List<String> keys) {
        return MigrationStorySpecGenerationEntity.builder()
            .id(id)
            .projectId(projectId)
            .workItemId(workItemId)
            .status(status)
            .missingInputKeysJson(keys == null ? null : new ArrayList<>(keys))
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
    }

    private MissingInputResolutionEntity resolution(UUID pid, String key) {
        return MissingInputResolutionEntity.builder()
            .id(UUID.randomUUID())
            .projectId(pid)
            .missingInputKey(key)
            .missingInputType("api_contract")
            .resolvedAt(Instant.now())
            .resolvedBy("alice@example.com")
            .softDeleted(Boolean.FALSE)
            .build();
    }
}
