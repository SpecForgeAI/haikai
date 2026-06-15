package com.example.architecturemodel.integration;

import com.example.architecturemodel.model.dto.OrganisationDto;
import com.example.architecturemodel.model.dto.OrganisationListItemDto;
import com.example.architecturemodel.model.dto.ProjectDto;
import com.example.architecturemodel.model.entity.OrganisationEntity;
import com.example.architecturemodel.repository.OrganisationRepository;
import com.example.architecturemodel.repository.ProjectRepository;
import com.example.architecturemodel.service.OrganisationService;
import com.example.architecturemodel.service.ProjectService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Integration tests for Organisation feature.
 *
 * Tests end-to-end workflows including:
 * - Creating organisations and linking projects
 * - Verifying FK constraints work correctly
 * - Validating String ID types throughout the system
 *
 * Spec 2026-01-18: Organisations Iteration 1 - Add Organisation Model + Project FK + APIs
 * Spec 2026-01-18: Organisation ID Type Change (UUID to TEXT) - Updated to use String IDs
 * Task Group 5: Test Review and Gap Analysis
 * Task Group 6: Test Review and Integration Validation
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class OrganisationIntegrationTest {

    @Autowired
    private OrganisationService organisationService;

    @Autowired
    private ProjectService projectService;

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
    @DisplayName("Create organisation then create project linked to it")
    void testCreateOrganisationThenCreateProjectLinkedToIt() {
        // Given: Create an organisation
        OrganisationDto organisation = organisationService.createOrganisation(
            "Test Organisation",
            "Test description"
        );
        assertThat(organisation.id()).isNotNull();
        assertThat(organisation.id()).startsWith("org-"); // Verify String ID format

        // When: Create a project linked to the organisation
        ProjectDto project = projectService.createProject(
            "Test Project",
            "/test/path",
            null,
            organisation.id(),
            false
        );

        // Then: Project has the correct organisation ID
        assertThat(project.organisationId()).isEqualTo(organisation.id());

        // And: Can retrieve the project with organisation ID set
        List<ProjectDto> projects = projectService.listProjects();
        assertThat(projects).hasSize(1);
        assertThat(projects.get(0).organisationId()).isEqualTo(organisation.id());
    }

    @Test
    @DisplayName("Organisation name with special characters is created correctly")
    void testOrganisationNameWithSpecialCharacters() {
        // Given: Organisation name with special characters
        String specialName = "Acme & Co. (Holdings) Ltd.";

        // When: Create organisation with special characters
        OrganisationDto organisation = organisationService.createOrganisation(
            specialName,
            null
        );

        // Then: Name is preserved correctly
        assertThat(organisation.name()).isEqualTo(specialName);
        assertThat(organisation.id()).startsWith("org-");

        // And: Can retrieve by exact name
        OrganisationDto retrieved = organisationService.getOrganisationByName(specialName);
        assertThat(retrieved.name()).isEqualTo(specialName);
    }

    @Test
    @DisplayName("Organisation name with leading/trailing whitespace is trimmed")
    void testOrganisationNameWhitespaceTrimmed() {
        // Given: Organisation name with whitespace
        String nameWithWhitespace = "  Trimmed Org  ";

        // When: Create organisation
        OrganisationDto organisation = organisationService.createOrganisation(
            nameWithWhitespace,
            null
        );

        // Then: Name is trimmed
        assertThat(organisation.name()).isEqualTo("Trimmed Org");

        // And: Can retrieve by trimmed name
        OrganisationDto retrieved = organisationService.getOrganisationByName("Trimmed Org");
        assertThat(retrieved.name()).isEqualTo("Trimmed Org");
    }

    @Test
    @DisplayName("List organisations returns correct order")
    void testListOrganisationsOrder() {
        // Given: Create organisations in random order
        organisationService.createOrganisation("Zebra Corp", null);
        organisationService.createOrganisation("Alpha Inc", null);
        organisationService.createOrganisation("Omega Ltd", null);

        // When: List organisations
        List<OrganisationListItemDto> organisations = organisationService.listOrganisations();

        // Then: Organisations are sorted by name ascending
        assertThat(organisations).hasSize(3);
        assertThat(organisations.get(0).name()).isEqualTo("Alpha Inc");
        assertThat(organisations.get(1).name()).isEqualTo("Omega Ltd");
        assertThat(organisations.get(2).name()).isEqualTo("Zebra Corp");

        // And: All IDs are String type with org- prefix
        assertThat(organisations.get(0).id()).startsWith("org-");
        assertThat(organisations.get(1).id()).startsWith("org-");
        assertThat(organisations.get(2).id()).startsWith("org-");
    }

    @Test
    @DisplayName("Project without organisation has null organisationId")
    void testProjectWithoutOrganisation() {
        // When: Create a project without organisation
        ProjectDto project = projectService.createProject(
            "Orphan Project",
            "/test/orphan",
            null,
            null, // No organisation
            false
        );

        // Then: organisationId is null
        assertThat(project.organisationId()).isNull();
    }

    // =========================================================================
    // Additional Integration Tests for Task Group 6
    // Spec: Organisation ID Type Change (UUID to TEXT)
    // =========================================================================

    @Test
    @DisplayName("Full organisation creation workflow - API to database with String ID")
    void testFullOrganisationCreationWorkflowWithStringId() {
        // When: Create organisation via service
        OrganisationDto created = organisationService.createOrganisation(
            "Full Workflow Org",
            "Testing full workflow"
        );

        // Then: Organisation has String ID with prefix
        assertThat(created.id()).isNotNull();
        assertThat(created.id()).startsWith("org-");
        assertThat(created.id()).matches("org-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}");

        // And: Can retrieve by ID
        OrganisationDto retrieved = organisationService.getOrganisationById(created.id());
        assertThat(retrieved.id()).isEqualTo(created.id());
        assertThat(retrieved.name()).isEqualTo("Full Workflow Org");

        // And: Database contains entity with correct String ID
        assertThat(organisationRepository.findById(created.id())).isPresent();
    }

    @Test
    @DisplayName("Full project creation with organisation association using String ID")
    void testFullProjectCreationWithOrganisationAssociation() {
        // Given: Create an organisation
        OrganisationDto org = organisationService.createOrganisation("Project Org", null);

        // When: Create project with organisation
        ProjectDto project = projectService.createProject(
            "Associated Project",
            "/test/associated",
            "Test Hierarchy",
            org.id(),
            false
        );

        // Then: Project has correct organisation association
        assertThat(project.organisationId()).isEqualTo(org.id());
        assertThat(project.organisationId()).startsWith("org-");

        // And: Can list and verify
        List<ProjectDto> projects = projectService.listProjects();
        assertThat(projects).hasSize(1);
        assertThat(projects.get(0).organisationId()).isEqualTo(org.id());
    }

    @Test
    @DisplayName("Organisation listing returns all organisations with String IDs")
    void testOrganisationListingReturnsStringIds() {
        // Given: Multiple organisations
        OrganisationDto org1 = organisationService.createOrganisation("First Org", null);
        OrganisationDto org2 = organisationService.createOrganisation("Second Org", null);
        OrganisationDto org3 = organisationService.createOrganisation("Third Org", null);

        // When: List all organisations
        List<OrganisationListItemDto> list = organisationService.listOrganisations();

        // Then: All have String IDs
        assertThat(list).hasSize(3);
        list.forEach(item -> {
            assertThat(item.id()).isNotNull();
            assertThat(item.id()).startsWith("org-");
            assertThat(item.id()).isInstanceOf(String.class);
        });
    }

    @Test
    @DisplayName("Multiple projects can be linked to same organisation using String ID")
    void testMultipleProjectsLinkedToSameOrganisation() {
        // Given: An organisation
        OrganisationDto org = organisationService.createOrganisation("Multi-Project Org", null);

        // When: Create multiple projects linked to the same organisation
        ProjectDto project1 = projectService.createProject("Project 1", "/test/p1", null, org.id(), false);
        ProjectDto project2 = projectService.createProject("Project 2", "/test/p2", null, org.id(), false);
        ProjectDto project3 = projectService.createProject("Project 3", "/test/p3", null, org.id(), false);

        // Then: All projects have same organisation ID
        assertThat(project1.organisationId()).isEqualTo(org.id());
        assertThat(project2.organisationId()).isEqualTo(org.id());
        assertThat(project3.organisationId()).isEqualTo(org.id());

        // And: All organisation IDs are String type
        assertThat(project1.organisationId()).isInstanceOf(String.class);
        assertThat(project2.organisationId()).isInstanceOf(String.class);
        assertThat(project3.organisationId()).isInstanceOf(String.class);
    }
}
