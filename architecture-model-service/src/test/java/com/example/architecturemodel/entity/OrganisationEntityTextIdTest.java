package com.example.architecturemodel.entity;

import com.example.architecturemodel.model.entity.OrganisationEntity;
import com.example.architecturemodel.model.entity.ProjectEntity;
import com.example.architecturemodel.repository.OrganisationRepository;
import com.example.architecturemodel.repository.ProjectRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Tests for OrganisationEntity and ProjectEntity with String ID types.
 *
 * Validates that entities can be created, persisted, and retrieved with
 * String-based IDs after the UUID to TEXT migration.
 *
 * Spec: Organisation ID Type Change (UUID to TEXT)
 * Task Group 2: Entity and Repository Updates
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class OrganisationEntityTextIdTest {

    @Autowired
    private OrganisationRepository organisationRepository;

    @Autowired
    private ProjectRepository projectRepository;

    @BeforeEach
    void setUp() {
        projectRepository.deleteAll();
        organisationRepository.deleteAll();
    }

    @Test
    @DisplayName("OrganisationEntity can be created with String id")
    void testOrganisationEntityCreatedWithStringId() {
        // Given: A prefixed String ID
        String orgId = "org-" + UUID.randomUUID().toString();

        // When: Create an entity with String id
        OrganisationEntity entity = OrganisationEntity.builder()
            .id(orgId)
            .name("Test Organisation")
            .description("Test description")
            .build();

        // Then: Entity has correct String id type
        assertThat(entity.getId()).isEqualTo(orgId);
        assertThat(entity.getId()).isInstanceOf(String.class);
        assertThat(entity.getId()).startsWith("org-");
    }

    @Test
    @DisplayName("OrganisationEntity can be persisted and retrieved by String id")
    void testOrganisationEntityPersistedAndRetrievedByStringId() {
        // Given: An entity with String id
        String orgId = "org-" + UUID.randomUUID().toString();
        OrganisationEntity entity = OrganisationEntity.builder()
            .id(orgId)
            .name("Persistent Test Org")
            .description("Description")
            .build();

        // When: Save and retrieve
        organisationRepository.save(entity);
        Optional<OrganisationEntity> retrieved = organisationRepository.findById(orgId);

        // Then: Entity is found with correct data
        assertThat(retrieved).isPresent();
        assertThat(retrieved.get().getId()).isEqualTo(orgId);
        assertThat(retrieved.get().getName()).isEqualTo("Persistent Test Org");
        assertThat(retrieved.get().getDescription()).isEqualTo("Description");
    }

    @Test
    @DisplayName("ProjectEntity can be created with String organisationId")
    void testProjectEntityCreatedWithStringOrganisationId() {
        // Given: A String organisation ID
        String orgId = "org-" + UUID.randomUUID().toString();

        // When: Create a project entity with String organisationId
        ProjectEntity project = ProjectEntity.builder()
            .id(UUID.randomUUID())
            .name("Test Project")
            .projectParentFolder("/test/path")
            .organisationId(orgId)
            .isActive(false)
            .build();

        // Then: Project has correct String organisationId
        assertThat(project.getOrganisationId()).isEqualTo(orgId);
        assertThat(project.getOrganisationId()).isInstanceOf(String.class);
    }

    @Test
    @DisplayName("OrganisationRepository.findById works with String parameter")
    void testOrganisationRepositoryFindByIdWithString() {
        // Given: A saved organisation with String id
        String orgId = "org-" + UUID.randomUUID().toString();
        OrganisationEntity entity = OrganisationEntity.builder()
            .id(orgId)
            .name("FindById Test Org")
            .build();
        organisationRepository.save(entity);

        // When: Find by String id
        Optional<OrganisationEntity> found = organisationRepository.findById(orgId);

        // Then: Organisation is found
        assertThat(found).isPresent();
        assertThat(found.get().getName()).isEqualTo("FindById Test Org");
    }

    @Test
    @DisplayName("ProjectRepository queries work with String organisationId")
    void testProjectRepositoryQueriesWithStringOrganisationId() {
        // Given: An organisation and project with String organisation_id
        String orgId = "org-" + UUID.randomUUID().toString();
        OrganisationEntity org = OrganisationEntity.builder()
            .id(orgId)
            .name("Org for Project Query Test")
            .build();
        organisationRepository.save(org);

        UUID projectId = UUID.randomUUID();
        ProjectEntity project = ProjectEntity.builder()
            .id(projectId)
            .name("Project Query Test")
            .projectParentFolder("/test/query")
            .organisationId(orgId)
            .isActive(false)
            .build();
        projectRepository.save(project);

        // When: Retrieve the project
        Optional<ProjectEntity> found = projectRepository.findById(projectId);

        // Then: Project has correct String organisationId
        assertThat(found).isPresent();
        assertThat(found.get().getOrganisationId()).isEqualTo(orgId);
        assertThat(found.get().getOrganisationId()).startsWith("org-");
    }
}
