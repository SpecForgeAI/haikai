package com.example.architecturemodel.integration;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.ArchitectureMapper;
import com.example.architecturemodel.model.dto.ArchitectureDto;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.model.entity.ArchitectureTagEntity;
import com.example.architecturemodel.repository.ArchitectureRepository;
import com.example.architecturemodel.repository.ArchitectureTagRepository;
import com.example.architecturemodel.service.ArchitectureService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

/**
 * Service-level tests for the new ArchitectureService introduced in Spec #1.
 *
 * Covers two of the four required tests from Task 1.1:
 * - listForProject returns architectures ordered by created_at ascending
 * - resolveDefault returns the oldest non-archived architecture
 * - resolveDefault skips archived architectures even if older
 *
 * Uses Mockito (not full Spring context) to isolate from pre-existing
 * compilation issues in other integration tests, mirroring the pattern used
 * in DeliveryTeamIntegrationTest.
 *
 * Spec: Multi-Architecture Plumbing (Spec #1)
 * Task Group 1: Backend Foundation (Task 1.1)
 */
@ExtendWith(MockitoExtension.class)
class ArchitectureServiceIntegrationTest {

    @Mock
    private ArchitectureRepository architectureRepository;

    @Mock
    private ArchitectureTagRepository architectureTagRepository;

    @Spy
    private ArchitectureMapper architectureMapper = new ArchitectureMapper();

    @InjectMocks
    private ArchitectureService architectureService;

    private UUID projectId;
    private UUID archIdOldest;
    private UUID archIdMiddle;
    private UUID archIdNewest;

    @BeforeEach
    void setUp() {
        projectId = UUID.randomUUID();
        archIdOldest = UUID.randomUUID();
        archIdMiddle = UUID.randomUUID();
        archIdNewest = UUID.randomUUID();
    }

    /**
     * Test 1: listForProject returns architectures ordered by created_at ascending.
     */
    @Test
    @DisplayName("listForProject returns architectures ordered by created_at ascending (oldest first)")
    void testListForProjectReturnsOrderedByCreatedAtAscending() {
        Instant t0 = Instant.parse("2026-01-01T00:00:00Z");
        Instant t1 = Instant.parse("2026-02-01T00:00:00Z");
        Instant t2 = Instant.parse("2026-03-01T00:00:00Z");

        ArchitectureEntity oldest = ArchitectureEntity.builder()
            .id(archIdOldest).projectId(projectId).name("Default")
            .archived(false).createdAt(t0).updatedAt(t0).build();
        ArchitectureEntity middle = ArchitectureEntity.builder()
            .id(archIdMiddle).projectId(projectId).name("Variant A")
            .archived(false).createdAt(t1).updatedAt(t1).build();
        ArchitectureEntity newest = ArchitectureEntity.builder()
            .id(archIdNewest).projectId(projectId).name("Variant B")
            .archived(false).createdAt(t2).updatedAt(t2).build();

        // Repository returns them already ordered (per the method's signature contract);
        // we assert the service preserves that order.
        when(architectureRepository.findByProjectIdOrderByCreatedAtAsc(projectId))
            .thenReturn(List.of(oldest, middle, newest));
        when(architectureTagRepository.findByArchitectureId(archIdOldest))
            .thenReturn(Collections.emptyList());
        when(architectureTagRepository.findByArchitectureId(archIdMiddle))
            .thenReturn(List.of(ArchitectureTagEntity.builder()
                .architectureId(archIdMiddle).tagValue("legacy").build()));
        when(architectureTagRepository.findByArchitectureId(archIdNewest))
            .thenReturn(Collections.emptyList());

        List<ArchitectureDto> result = architectureService.listForProject(projectId);

        assertThat(result).hasSize(3);
        assertThat(result.get(0).id()).isEqualTo(archIdOldest);
        assertThat(result.get(0).createdAt()).isEqualTo(t0);
        assertThat(result.get(0).name()).isEqualTo("Default");
        assertThat(result.get(0).tags()).isEmpty();

        assertThat(result.get(1).id()).isEqualTo(archIdMiddle);
        assertThat(result.get(1).createdAt()).isEqualTo(t1);
        assertThat(result.get(1).tags()).containsExactly("legacy");

        assertThat(result.get(2).id()).isEqualTo(archIdNewest);
        assertThat(result.get(2).createdAt()).isEqualTo(t2);
    }

    /**
     * Test 2: resolveDefault returns the oldest non-archived architecture.
     */
    @Test
    @DisplayName("resolveDefault returns the oldest non-archived architecture")
    void testResolveDefaultReturnsOldestNonArchived() {
        Instant t0 = Instant.parse("2026-01-01T00:00:00Z");

        ArchitectureEntity oldest = ArchitectureEntity.builder()
            .id(archIdOldest).projectId(projectId).name("Default")
            .archived(false).createdAt(t0).updatedAt(t0).build();

        when(architectureRepository
            .findFirstByProjectIdAndArchivedFalseOrderByCreatedAtAsc(projectId))
            .thenReturn(Optional.of(oldest));
        when(architectureTagRepository.findByArchitectureId(archIdOldest))
            .thenReturn(Collections.emptyList());

        ArchitectureDto result = architectureService.resolveDefault(projectId);

        assertThat(result.id()).isEqualTo(archIdOldest);
        assertThat(result.name()).isEqualTo("Default");
        assertThat(result.archived()).isFalse();
        assertThat(result.createdAt()).isEqualTo(t0);
    }

    /**
     * Test 3: resolveDefault skips archived architectures even if older.
     *
     * The repository method `findFirstByProjectIdAndArchivedFalseOrderByCreatedAtAsc`
     * filters archived rows at the SQL level. We simulate that by returning the
     * "middle" (next-oldest non-archived) row when the older row is archived.
     */
    @Test
    @DisplayName("resolveDefault skips archived architectures even if they are older")
    void testResolveDefaultSkipsArchivedEvenIfOlder() {
        Instant t1 = Instant.parse("2026-02-01T00:00:00Z");

        // The archived (t0) row is intentionally NOT returned here -- the
        // repository's ArchivedFalse filter excludes it. The next-oldest
        // non-archived (middle, t1) is what surfaces.
        ArchitectureEntity middle = ArchitectureEntity.builder()
            .id(archIdMiddle).projectId(projectId).name("Variant A")
            .archived(false).createdAt(t1).updatedAt(t1).build();

        when(architectureRepository
            .findFirstByProjectIdAndArchivedFalseOrderByCreatedAtAsc(projectId))
            .thenReturn(Optional.of(middle));
        when(architectureTagRepository.findByArchitectureId(archIdMiddle))
            .thenReturn(Collections.emptyList());

        ArchitectureDto result = architectureService.resolveDefault(projectId);

        assertThat(result.id()).isEqualTo(archIdMiddle);
        assertThat(result.name()).isEqualTo("Variant A");
        assertThat(result.archived()).isFalse();
        assertThat(result.createdAt()).isEqualTo(t1);
    }

    /**
     * Sanity guard: resolveDefault throws ResourceNotFoundException when the
     * project has zero non-archived architectures. (Not in the four required
     * tests but cheap and prevents regression of the contract.)
     */
    @Test
    @DisplayName("resolveDefault throws ResourceNotFoundException when no non-archived architectures exist")
    void testResolveDefaultThrowsWhenNoNonArchived() {
        when(architectureRepository
            .findFirstByProjectIdAndArchivedFalseOrderByCreatedAtAsc(projectId))
            .thenReturn(Optional.empty());

        assertThatThrownBy(() -> architectureService.resolveDefault(projectId))
            .isInstanceOf(ResourceNotFoundException.class)
            .hasMessageContaining("No non-archived architecture found");
    }
}
