package com.example.architecturemodel.integration;

import com.example.architecturemodel.model.entity.ProjectArtifactEntity;
import com.example.architecturemodel.repository.entity.ProjectArtifactRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.test.context.ActiveProfiles;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Integration tests for project artifact persistence and revisioning.
 */
@DataJpaTest
@ActiveProfiles("test")
class ProjectArtifactIntegrationTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private ProjectArtifactRepository projectArtifactRepository;

    private static final UUID PROJECT_ID = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        projectArtifactRepository.deleteAll();
        entityManager.flush();
        entityManager.clear();
    }

    /**
     * Test artifact revisioning: POST twice should create revision 1 and 2.
     */
    @Test
    void revisioning_twoCreates_createsRevision1And2() {
        // Create first revision
        ProjectArtifactEntity rev1 = createAndSaveArtifact("MISSION_MD", "First version", 1);
        entityManager.flush();
        entityManager.clear();

        // Create second revision
        ProjectArtifactEntity rev2 = createAndSaveArtifact("MISSION_MD", "Second version", 2);
        entityManager.flush();
        entityManager.clear();

        // Verify both revisions exist
        List<ProjectArtifactEntity> revisions = projectArtifactRepository
            .findByProjectIdAndArtifactTypeOrderByRevisionDesc(PROJECT_ID, "MISSION_MD");

        assertThat(revisions).hasSize(2);
        assertThat(revisions.get(0).getRevision()).isEqualTo(2);
        assertThat(revisions.get(0).getContent()).isEqualTo("Second version");
        assertThat(revisions.get(1).getRevision()).isEqualTo(1);
        assertThat(revisions.get(1).getContent()).isEqualTo("First version");
    }

    /**
     * Test get latest artifact returns highest revision.
     */
    @Test
    void getLatest_threeRevisions_returnsRevision3() {
        // Create 3 revisions
        createAndSaveArtifact("ROADMAP_MD", "Version 1", 1);
        createAndSaveArtifact("ROADMAP_MD", "Version 2", 2);
        createAndSaveArtifact("ROADMAP_MD", "Version 3 - Latest", 3);
        entityManager.flush();
        entityManager.clear();

        // Query for latest
        Optional<ProjectArtifactEntity> latest = projectArtifactRepository
            .findFirstByProjectIdAndArtifactTypeOrderByRevisionDesc(PROJECT_ID, "ROADMAP_MD");

        assertThat(latest).isPresent();
        assertThat(latest.get().getRevision()).isEqualTo(3);
        assertThat(latest.get().getContent()).isEqualTo("Version 3 - Latest");
    }

    /**
     * Test filtering by artifact type only returns matching type.
     */
    @Test
    void findByType_mixedTypes_filtersCorrectly() {
        // Create artifacts of different types
        createAndSaveArtifact("MISSION_MD", "Mission content", 1);
        createAndSaveArtifact("ROADMAP_MD", "Roadmap content", 1);
        createAndSaveArtifact("BACKLOG_MD", "Backlog content", 1);
        entityManager.flush();
        entityManager.clear();

        // Query for MISSION_MD only
        List<ProjectArtifactEntity> missionArtifacts = projectArtifactRepository
            .findByProjectIdAndArtifactTypeOrderByRevisionDesc(PROJECT_ID, "MISSION_MD");

        assertThat(missionArtifacts).hasSize(1);
        assertThat(missionArtifacts.get(0).getArtifactType()).isEqualTo("MISSION_MD");
    }

    /**
     * Test get specific revision by (project, type, revision).
     */
    @Test
    void getSpecificRevision_returnsCorrectVersion() {
        createAndSaveArtifact("BACKLOG_MD", "Version 1 content", 1);
        createAndSaveArtifact("BACKLOG_MD", "Version 2 content", 2);
        createAndSaveArtifact("BACKLOG_MD", "Version 3 content", 3);
        entityManager.flush();
        entityManager.clear();

        // Query for revision 2
        Optional<ProjectArtifactEntity> rev2 = projectArtifactRepository
            .findByProjectIdAndArtifactTypeAndRevision(PROJECT_ID, "BACKLOG_MD", 2);

        assertThat(rev2).isPresent();
        assertThat(rev2.get().getRevision()).isEqualTo(2);
        assertThat(rev2.get().getContent()).isEqualTo("Version 2 content");
    }

    /**
     * Test different sources are stored correctly.
     */
    @Test
    void differentSources_storedCorrectly() {
        ProjectArtifactEntity agentOsArtifact = ProjectArtifactEntity.builder()
            .id(UUID.randomUUID())
            .projectId(PROJECT_ID)
            .artifactType("MISSION_MD")
            .content("Agent OS content")
            .source("AGENT_OS")
            .revision(1)
            .createdAt(Instant.now())
            .build();
        projectArtifactRepository.save(agentOsArtifact);

        ProjectArtifactEntity toolArtifact = ProjectArtifactEntity.builder()
            .id(UUID.randomUUID())
            .projectId(PROJECT_ID)
            .artifactType("ROADMAP_MD")
            .content("Tool content")
            .source("TOOL")
            .revision(1)
            .createdAt(Instant.now())
            .build();
        projectArtifactRepository.save(toolArtifact);

        ProjectArtifactEntity userEditArtifact = ProjectArtifactEntity.builder()
            .id(UUID.randomUUID())
            .projectId(PROJECT_ID)
            .artifactType("BACKLOG_MD")
            .content("User edit content")
            .source("USER_EDIT")
            .revision(1)
            .createdAt(Instant.now())
            .build();
        projectArtifactRepository.save(userEditArtifact);

        entityManager.flush();
        entityManager.clear();

        List<ProjectArtifactEntity> all = projectArtifactRepository.findByProjectIdOrderByCreatedAtDesc(PROJECT_ID);
        assertThat(all).hasSize(3);
        assertThat(all).extracting(ProjectArtifactEntity::getSource)
            .containsExactlyInAnyOrder("AGENT_OS", "TOOL", "USER_EDIT");
    }

    // ============================================================================
    // Helper Methods
    // ============================================================================

    private ProjectArtifactEntity createAndSaveArtifact(String type, String content, int revision) {
        ProjectArtifactEntity entity = ProjectArtifactEntity.builder()
            .id(UUID.randomUUID())
            .projectId(PROJECT_ID)
            .artifactType(type)
            .content(content)
            .source("AGENT_OS")
            .revision(revision)
            .createdAt(Instant.now())
            .build();
        return projectArtifactRepository.save(entity);
    }
}
