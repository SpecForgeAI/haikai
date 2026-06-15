package com.example.architecturemodel.repository;

import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.example.architecturemodel.model.entity.ProjectArtifactEntity;
import com.example.architecturemodel.repository.entity.WorkItemRepository;
import com.example.architecturemodel.repository.entity.ProjectArtifactRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.test.context.ActiveProfiles;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Repository tests for WorkItemRepository and ProjectArtifactRepository.
 *
 * Tests custom query methods, ordering, and filtering.
 */
@DataJpaTest
@ActiveProfiles("test")
class WorkItemRepositoryTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private WorkItemRepository workItemRepository;

    @Autowired
    private ProjectArtifactRepository projectArtifactRepository;

    /**
     * Test that findByProjectIdOrderBySortOrderAscCreatedAtAscIdAsc returns deterministic order.
     */
    @Test
    void findByProjectId_returnsDeterministicOrder() {
        Instant now = Instant.now();

        // Create items with same sort_order but different created_at
        WorkItemEntity item1 = createWorkItem("project-1", "INITIATIVE", "Item 1", 0, now.minus(2, ChronoUnit.HOURS));
        WorkItemEntity item2 = createWorkItem("project-1", "INITIATIVE", "Item 2", 0, now.minus(1, ChronoUnit.HOURS));
        WorkItemEntity item3 = createWorkItem("project-1", "INITIATIVE", "Item 3", 0, now);

        // Create item with different sort_order
        WorkItemEntity item4 = createWorkItem("project-1", "INITIATIVE", "Item 4", 1, now);

        workItemRepository.saveAll(List.of(item3, item1, item4, item2));  // Save in random order
        entityManager.flush();
        entityManager.clear();

        List<WorkItemEntity> results = workItemRepository
            .findByProjectIdOrderBySortOrderAscCreatedAtAscIdAsc(PROJECT_1);

        // Should be ordered by sort_order ASC, then created_at ASC
        assertThat(results).hasSize(4);
        assertThat(results.get(0).getTitle()).isEqualTo("Item 1");  // sort_order=0, oldest
        assertThat(results.get(1).getTitle()).isEqualTo("Item 2");  // sort_order=0, older
        assertThat(results.get(2).getTitle()).isEqualTo("Item 3");  // sort_order=0, newest
        assertThat(results.get(3).getTitle()).isEqualTo("Item 4");  // sort_order=1
    }

    /**
     * Test that findByProjectIdAndTypeOrderBySortOrderAscCreatedAtAscIdAsc filters by type.
     */
    @Test
    void findByProjectIdAndType_filtersByType() {
        WorkItemEntity initiative = createWorkItem("project-1", "INITIATIVE", "Initiative", 0, Instant.now());
        WorkItemEntity epic = createWorkItem("project-1", "EPIC", "Epic", 0, Instant.now());
        WorkItemEntity feature = createWorkItem("project-1", "FEATURE", "Feature", 0, Instant.now());

        workItemRepository.saveAll(List.of(initiative, epic, feature));
        entityManager.flush();
        entityManager.clear();

        List<WorkItemEntity> results = workItemRepository
            .findByProjectIdAndTypeOrderBySortOrderAscCreatedAtAscIdAsc(PROJECT_1, "EPIC");

        assertThat(results).hasSize(1);
        assertThat(results.get(0).getType()).isEqualTo("EPIC");
    }

    /**
     * Test that findByProjectIdAndParentIdOrderBySortOrderAscCreatedAtAscIdAsc filters by parent.
     */
    @Test
    void findByProjectIdAndParentId_filtersByParent() {
        WorkItemEntity parent = createWorkItem("project-1", "INITIATIVE", "Parent", 0, Instant.now());
        parent = workItemRepository.save(parent);
        entityManager.flush();

        WorkItemEntity child1 = createWorkItem("project-1", "EPIC", "Child 1", 0, Instant.now());
        child1.setParentId(parent.getId());

        WorkItemEntity child2 = createWorkItem("project-1", "EPIC", "Child 2", 1, Instant.now());
        child2.setParentId(parent.getId());

        WorkItemEntity orphan = createWorkItem("project-1", "INITIATIVE", "Orphan", 0, Instant.now());

        workItemRepository.saveAll(List.of(child1, child2, orphan));
        entityManager.flush();
        entityManager.clear();

        List<WorkItemEntity> results = workItemRepository
            .findByProjectIdAndParentIdOrderBySortOrderAscCreatedAtAscIdAsc(PROJECT_1, parent.getId());

        assertThat(results).hasSize(2);
        assertThat(results).extracting(WorkItemEntity::getTitle).containsExactly("Child 1", "Child 2");
    }

    /**
     * Test that ProjectArtifactRepository.findFirstByProjectIdAndArtifactTypeOrderByRevisionDesc returns latest.
     */
    @Test
    void findLatestArtifact_returnsHighestRevision() {
        ProjectArtifactEntity rev1 = createArtifact("project-1", "MISSION_MD", "Rev 1 content", 1);
        ProjectArtifactEntity rev2 = createArtifact("project-1", "MISSION_MD", "Rev 2 content", 2);
        ProjectArtifactEntity rev3 = createArtifact("project-1", "MISSION_MD", "Rev 3 content", 3);

        projectArtifactRepository.saveAll(List.of(rev1, rev3, rev2));  // Save in random order
        entityManager.flush();
        entityManager.clear();

        Optional<ProjectArtifactEntity> result = projectArtifactRepository
            .findFirstByProjectIdAndArtifactTypeOrderByRevisionDesc(PROJECT_1, "MISSION_MD");

        assertThat(result).isPresent();
        assertThat(result.get().getRevision()).isEqualTo(3);
        assertThat(result.get().getContent()).isEqualTo("Rev 3 content");
    }

    /**
     * Test that ProjectArtifactRepository.findByProjectIdAndArtifactTypeOrderByRevisionDesc returns all revisions.
     */
    @Test
    void findArtifactRevisions_returnsAllRevisionsDescending() {
        ProjectArtifactEntity rev1 = createArtifact("project-1", "ROADMAP_MD", "Rev 1", 1);
        ProjectArtifactEntity rev2 = createArtifact("project-1", "ROADMAP_MD", "Rev 2", 2);
        ProjectArtifactEntity rev3 = createArtifact("project-1", "ROADMAP_MD", "Rev 3", 3);

        projectArtifactRepository.saveAll(List.of(rev1, rev3, rev2));
        entityManager.flush();
        entityManager.clear();

        List<ProjectArtifactEntity> results = projectArtifactRepository
            .findByProjectIdAndArtifactTypeOrderByRevisionDesc(PROJECT_1, "ROADMAP_MD");

        assertThat(results).hasSize(3);
        assertThat(results.get(0).getRevision()).isEqualTo(3);
        assertThat(results.get(1).getRevision()).isEqualTo(2);
        assertThat(results.get(2).getRevision()).isEqualTo(1);
    }

    // ============================================================================
    // Helper Methods
    // ============================================================================

    /** Stable UUID alias for the legacy "project-1" string identifier used throughout this test. */
    private static final UUID PROJECT_1 = UUID.fromString("00000000-0000-0000-0000-000000000001");

    private WorkItemEntity createWorkItem(String projectId, String type, String title,
                                          int sortOrder, Instant createdAt) {
        return WorkItemEntity.builder()
            .id(UUID.randomUUID())
            .projectId(resolveProjectId(projectId))
            .type(type)
            .title(title)
            .status("PLANNED")
            .sortOrder(sortOrder)
            .createdAt(createdAt)
            .updatedAt(createdAt)
            .build();
    }

    private ProjectArtifactEntity createArtifact(String projectId, String type,
                                                  String content, int revision) {
        return ProjectArtifactEntity.builder()
            .id(UUID.randomUUID())
            .projectId(resolveProjectId(projectId))
            .artifactType(type)
            .content(content)
            .source("AGENT_OS")
            .revision(revision)
            .createdAt(Instant.now())
            .build();
    }

    private static UUID resolveProjectId(String legacyId) {
        // Stable mapping: "project-1" -> PROJECT_1, otherwise a deterministic UUID per legacy string.
        if ("project-1".equals(legacyId)) {
            return PROJECT_1;
        }
        return UUID.nameUUIDFromBytes(legacyId.getBytes());
    }
}
