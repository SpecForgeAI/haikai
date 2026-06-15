package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.ProjectDto;
import com.example.architecturemodel.service.OrganisationService;
import com.example.architecturemodel.service.ProjectService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Tests for ProjectController.
 *
 * Spec 2026-01-05: Project Model with Active Project
 * Task Group 4: Project REST Controller Tests
 *
 * Spec 2026-01-05: Fix Create Project parent folder null
 * Added tests for snake_case/camelCase deserialization and validation
 */
@WebMvcTest(ProjectController.class)
class ProjectControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private ProjectService projectService;

    @MockBean
    private OrganisationService organisationService;

    @MockBean
    private com.example.architecturemodel.service.ProjectSnapshotService projectSnapshotService;

    // Spec 2026-06-12 (Implementation-Service Init, TG1): ProjectController now
    // injects the repo-map service; mocked here (Mockito default = empty list).
    @MockBean
    private com.example.architecturemodel.service.ProjectImplementationRepoService projectImplementationRepoService;

    private ProjectDto testProject;
    private UUID testProjectId;

    @BeforeEach
    void setUp() {
        testProjectId = UUID.randomUUID();
        testProject = new ProjectDto(
            testProjectId,
            "Test Project",
            "/projects/test",
            null,  // projectHierarchy
            null,  // organisationId
            null,  // repoUrl
            true,
            Instant.now(),
            Instant.now()
        );
    }

    @Test
    @DisplayName("POST /api/projects creates project and returns 201")
    void testCreateProjectReturns201() throws Exception {
        when(projectService.createProject(anyString(), anyString(), any(), any(), any(), anyBoolean()))
            .thenReturn(testProject);

        String requestBody = """
            {
                "name": "Test Project",
                "projectParentFolder": "/projects/test",
                "setActive": true
            }
            """;

        mockMvc.perform(post("/api/projects")
                .contentType(MediaType.APPLICATION_JSON)
                .content(requestBody))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.id").value(testProjectId.toString()))
            .andExpect(jsonPath("$.name").value("Test Project"))
            .andExpect(jsonPath("$.project_parent_folder").value("/projects/test"))
            .andExpect(jsonPath("$.is_active").value(true));
    }

    @Test
    @DisplayName("GET /api/projects returns list of all projects")
    void testListProjectsReturnsAllProjects() throws Exception {
        ProjectDto project2 = new ProjectDto(
            UUID.randomUUID(),
            "Second Project",
            "/projects/second",
            null,  // projectHierarchy
            null,  // organisationId
            null,  // repoUrl
            false,
            Instant.now(),
            Instant.now()
        );

        when(projectService.listProjects()).thenReturn(List.of(testProject, project2));

        mockMvc.perform(get("/api/projects")
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$").isArray())
            .andExpect(jsonPath("$.length()").value(2))
            .andExpect(jsonPath("$[0].name").value("Test Project"))
            .andExpect(jsonPath("$[1].name").value("Second Project"));
    }

    // NOTE: GET /api/projects/active moved to ActiveProjectController
    // (Spec 2026-01-24: Fix Ambiguous Mapping). Coverage lives in
    // ActiveProjectControllerTest$GetActiveProjectTests.

    @Test
    @DisplayName("POST /api/projects/{id}/activate activates project and returns 200")
    void testActivateProjectReturns200() throws Exception {
        when(projectService.activateProject(testProjectId)).thenReturn(testProject);

        mockMvc.perform(post("/api/projects/" + testProjectId + "/activate")
                .contentType(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value(testProjectId.toString()))
            .andExpect(jsonPath("$.is_active").value(true));
    }

    @Test
    @DisplayName("POST /api/projects with default setActive true")
    void testCreateProjectWithDefaultSetActiveTrue() throws Exception {
        when(projectService.createProject(anyString(), anyString(), any(), any(), any(), anyBoolean()))
            .thenReturn(testProject);

        // Request without setActive should default to true
        String requestBody = """
            {
                "name": "Test Project",
                "projectParentFolder": "/projects/test"
            }
            """;

        mockMvc.perform(post("/api/projects")
                .contentType(MediaType.APPLICATION_JSON)
                .content(requestBody))
            .andExpect(status().isCreated());
    }

    @Test
    @DisplayName("POST /api/projects/{id}/activate returns 404 for non-existent project")
    void testActivateNonExistentProjectReturns404() throws Exception {
        UUID nonExistentId = UUID.randomUUID();
        when(projectService.activateProject(nonExistentId))
            .thenThrow(new ResourceNotFoundException("Project not found with id: " + nonExistentId));

        mockMvc.perform(post("/api/projects/" + nonExistentId + "/activate")
                .contentType(MediaType.APPLICATION_JSON))
            .andExpect(status().isNotFound());
    }

    /**
     * Tests for CreateProjectRequest deserialization with snake_case and camelCase payloads.
     *
     * Spec 2026-01-05: Fix Create Project parent folder null
     * Task 1.1: Test that both snake_case and camelCase payloads deserialize correctly
     */
    @Nested
    @DisplayName("CreateProjectRequest Deserialization Tests")
    class CreateProjectRequestDeserializationTests {

        @Test
        @DisplayName("POST /api/projects with snake_case payload deserializes correctly")
        void testCreateProjectWithSnakeCasePayload() throws Exception {
            when(projectService.createProject(eq("Snake Test"), eq("/projects/snake"), any(), any(), any(), eq(true)))
                .thenReturn(new ProjectDto(
                    testProjectId,
                    "Snake Test",
                    "/projects/snake",
                    null,  // projectHierarchy
                    null,  // organisationId
                    null,  // repoUrl
                    true,
                    Instant.now(),
                    Instant.now()
                ));

            // snake_case payload as the backend expects with global SNAKE_CASE strategy
            String requestBody = """
                {
                    "name": "Snake Test",
                    "project_parent_folder": "/projects/snake",
                    "set_active": true
                }
                """;

            mockMvc.perform(post("/api/projects")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(requestBody))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value("Snake Test"))
                .andExpect(jsonPath("$.project_parent_folder").value("/projects/snake"));
        }

        @Test
        @DisplayName("POST /api/projects with camelCase payload deserializes correctly via JsonAlias")
        void testCreateProjectWithCamelCasePayload() throws Exception {
            when(projectService.createProject(eq("Camel Test"), eq("/projects/camel"), any(), any(), any(), eq(false)))
                .thenReturn(new ProjectDto(
                    testProjectId,
                    "Camel Test",
                    "/projects/camel",
                    null,  // projectHierarchy
                    null,  // organisationId
                    null,  // repoUrl
                    false,
                    Instant.now(),
                    Instant.now()
                ));

            // camelCase payload that should work via @JsonAlias
            String requestBody = """
                {
                    "name": "Camel Test",
                    "projectParentFolder": "/projects/camel",
                    "setActive": false
                }
                """;

            mockMvc.perform(post("/api/projects")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(requestBody))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value("Camel Test"))
                .andExpect(jsonPath("$.project_parent_folder").value("/projects/camel"));
        }
    }

    /**
     * Tests for validation of required fields in create project request.
     *
     * Spec 2026-01-05: Fix Create Project parent folder null
     * Task 1.1: Test that validation rejects blank/null name and projectParentFolder with 400 response
     */
    @Nested
    @DisplayName("CreateProject Validation Tests")
    class CreateProjectValidationTests {

        @Test
        @DisplayName("POST /api/projects with blank name returns 400 with descriptive message")
        void testCreateProjectWithBlankNameReturns400() throws Exception {
            when(projectService.createProject(eq(""), anyString(), any(), any(), any(), anyBoolean()))
                .thenThrow(new IllegalArgumentException("Project name is required"));

            String requestBody = """
                {
                    "name": "",
                    "project_parent_folder": "/projects/test",
                    "set_active": true
                }
                """;

            mockMvc.perform(post("/api/projects")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(requestBody))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Project name is required"));
        }

        @Test
        @DisplayName("POST /api/projects with null/blank projectParentFolder returns 400 with descriptive message")
        void testCreateProjectWithNullParentFolderReturns400() throws Exception {
            when(projectService.createProject(anyString(), eq(null), any(), any(), any(), anyBoolean()))
                .thenThrow(new IllegalArgumentException("Project parent folder is required"));

            // Payload without project_parent_folder - should deserialize as null
            String requestBody = """
                {
                    "name": "Test Project",
                    "set_active": true
                }
                """;

            mockMvc.perform(post("/api/projects")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(requestBody))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Project parent folder is required"));
        }
    }
}
