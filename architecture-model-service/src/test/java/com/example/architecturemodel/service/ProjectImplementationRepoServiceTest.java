package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.ProjectImplementationRepoDto;
import com.example.architecturemodel.model.entity.ProjectEntity;
import com.example.architecturemodel.repository.ProjectImplementationRepoRepository;
import com.example.architecturemodel.repository.ProjectRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Real-persistence (H2) tests for {@link ProjectImplementationRepoService}'s
 * full-map replace semantics on {@code project_implementation_repos}.
 *
 * <p>Spec 2026-06-12: Implementation-Service Init and Integration Repair --
 * Task Group 1. The replace operation is the gateway's drift auto-sync target
 * (external-wins): it must fully replace the stored map -- stale folders
 * removed, re-used (project_id, folder) keys re-insertable within the same
 * transaction (immediate JPQL bulk delete, see repository javadoc).</p>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    // Dedicated DB name; JSONB domain alias for unrelated entities created by
    // ddl-auto in this slice (same pattern as WorkItemTypeAuditTest).
    "spring.datasource.url=jdbc:h2:mem:implrepomapdb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;NON_KEYWORDS=KEY;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
})
class ProjectImplementationRepoServiceTest {

    @Autowired private ProjectImplementationRepoRepository repoRepository;
    @Autowired private ProjectRepository projectRepository;

    private ProjectImplementationRepoService service;
    private UUID projectId;

    @BeforeEach
    void setUp() {
        service = new ProjectImplementationRepoService(repoRepository, projectRepository);

        ProjectEntity project = ProjectEntity.builder()
            .id(UUID.randomUUID())
            .name("acme-app")
            .projectParentFolder("/projects/acme-app/")
            .isActive(false)
            .build();
        projectId = projectRepository.save(project).getId();
    }

    @Test
    @DisplayName("replaceRepos persists rows, and a second replace fully replaces the map (stale folders removed, same folder re-insertable)")
    void replaceIsFullMapReplace() {
        // First sync: two repos.
        List<ProjectImplementationRepoDto> first = service.replaceRepos(projectId, List.of(
            new ProjectImplementationRepoDto("backend", "https://github.com/acme/backend.git",
                "/ws/acme/app/backend", "brownfield"),
            new ProjectImplementationRepoDto("frontend", "https://github.com/acme/frontend.git",
                null, null)));
        assertThat(first).hasSize(2);
        assertThat(repoRepository.findByProjectIdOrderByFolderAsc(projectId)).hasSize(2);

        // Second sync: backend re-pointed (same folder, new URL), frontend
        // dropped, docs added. The stored map must equal exactly this.
        List<ProjectImplementationRepoDto> second = service.replaceRepos(projectId, List.of(
            new ProjectImplementationRepoDto("backend", "https://github.com/acme/backend-v2.git",
                "/ws/acme/app/backend", "brownfield"),
            new ProjectImplementationRepoDto("docs", "https://github.com/acme/docs.git",
                null, "greenfield")));

        assertThat(second).hasSize(2);
        assertThat(second)
            .extracting(ProjectImplementationRepoDto::folder)
            .containsExactly("backend", "docs"); // ordered by folder, frontend gone
        assertThat(second.get(0).gitUrl()).isEqualTo("https://github.com/acme/backend-v2.git");
        assertThat(second.get(1).mode()).isEqualTo("greenfield");

        // And the rows are really persisted (not just echoed).
        assertThat(repoRepository.findByProjectIdOrderByFolderAsc(projectId))
            .hasSize(2)
            .extracting(r -> r.getFolder())
            .containsExactly("backend", "docs");
    }

    @Test
    @DisplayName("replaceRepos validates: duplicate folders rejected, unknown project 404s")
    void replaceValidates() {
        assertThatThrownBy(() -> service.replaceRepos(projectId, List.of(
                new ProjectImplementationRepoDto("dup", "https://a.git", null, null),
                new ProjectImplementationRepoDto("dup", "https://b.git", null, null))))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Duplicate folder");

        assertThatThrownBy(() -> service.replaceRepos(UUID.randomUUID(), List.of()))
            .isInstanceOf(com.example.architecturemodel.exception.ResourceNotFoundException.class);
    }
}
