package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.model.dto.ProjectDto;
import com.example.architecturemodel.model.dto.ProjectImplementationRepoDto;
import com.example.architecturemodel.service.OrganisationService;
import com.example.architecturemodel.service.ProjectImplementationRepoService;
import com.example.architecturemodel.service.ProjectService;
import com.example.architecturemodel.service.ProjectSnapshotService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Controller wire-format tests for the implementation-service persistence
 * surface on {@link ProjectController}.
 *
 * <p>Spec 2026-06-12: Implementation-Service Init and Integration Repair --
 * Task Group 1. The standalone MockMvc is configured with a SNAKE_CASE
 * ObjectMapper mirroring the production global Jackson strategy
 * (application.yml {@code property-naming-strategy: SNAKE_CASE}) so the
 * snake_case wire assertions are faithful: these DTOs intentionally carry NO
 * {@code @CamelCaseWire} -- their consumers are the gateway/frontend
 * snake_case modules.</p>
 */
@ExtendWith(MockitoExtension.class)
class ProjectImplementationRepoControllerTest {

    @Mock private ProjectService projectService;
    @Mock private OrganisationService organisationService;
    @Mock private ProjectSnapshotService projectSnapshotService;
    @Mock private ProjectImplementationRepoService projectImplementationRepoService;

    private MockMvc mockMvc;
    private ObjectMapper objectMapper;
    private UUID projectId;

    @BeforeEach
    void setUp() {
        ProjectController controller = new ProjectController(
            projectService, organisationService, projectSnapshotService,
            projectImplementationRepoService);

        // Mirror the production global SNAKE_CASE wire format.
        objectMapper = new ObjectMapper();
        objectMapper.setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
        objectMapper.registerModule(new JavaTimeModule());

        mockMvc = MockMvcBuilders.standaloneSetup(controller)
            .setControllerAdvice(new GlobalExceptionHandler())
            .setMessageConverters(new MappingJackson2HttpMessageConverter(objectMapper))
            .build();

        projectId = UUID.randomUUID();
    }

    @Test
    @DisplayName("PUT /api/projects/{id}/implementation-repos persists the parsed map and returns rows snake_case")
    void replaceRepoMapRoundTripsSnakeCase() throws Exception {
        List<ProjectImplementationRepoDto> stored = List.of(
            new ProjectImplementationRepoDto(
                "backend", "https://github.com/acme/backend.git",
                "/workspace/acme/app/backend", "brownfield"),
            new ProjectImplementationRepoDto(
                "frontend", "https://github.com/acme/frontend.git",
                "/workspace/acme/app/frontend", "greenfield"));
        when(projectImplementationRepoService.replaceRepos(eq(projectId), anyList()))
            .thenReturn(stored);

        String body = """
            {
              "repos": [
                {"folder": "backend", "git_url": "https://github.com/acme/backend.git",
                 "workspace_dir": "/workspace/acme/app/backend", "mode": "brownfield"},
                {"folder": "frontend", "git_url": "https://github.com/acme/frontend.git",
                 "workspace_dir": "/workspace/acme/app/frontend", "mode": "greenfield"}
              ]
            }
            """;

        mockMvc.perform(put("/api/projects/{id}/implementation-repos", projectId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].folder").value("backend"))
            .andExpect(jsonPath("$[0].git_url").value("https://github.com/acme/backend.git"))
            .andExpect(jsonPath("$[0].workspace_dir").value("/workspace/acme/app/backend"))
            .andExpect(jsonPath("$[0].mode").value("brownfield"))
            .andExpect(jsonPath("$[1].folder").value("frontend"));

        // The snake_case request keys must have deserialised onto the DTO fields.
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<ProjectImplementationRepoDto>> captor =
            ArgumentCaptor.forClass((Class) List.class);
        verify(projectImplementationRepoService).replaceRepos(eq(projectId), captor.capture());
        List<ProjectImplementationRepoDto> parsed = captor.getValue();
        assertThat(parsed).hasSize(2);
        assertThat(parsed.get(0).folder()).isEqualTo("backend");
        assertThat(parsed.get(0).gitUrl()).isEqualTo("https://github.com/acme/backend.git");
        assertThat(parsed.get(0).workspaceDir()).isEqualTo("/workspace/acme/app/backend");
        assertThat(parsed.get(0).mode()).isEqualTo("brownfield");
    }

    @Test
    @DisplayName("GET /api/projects/{id} carries init-status fields and the attached repo map snake_case")
    void getProjectCarriesInitStatusAndRepoMap() throws Exception {
        Instant now = Instant.now();
        ProjectDto dto = new ProjectDto(
            projectId, "acme-app", "/projects/acme-app/", null, "org-1",
            "https://github.com/acme/app.git", Boolean.TRUE, now, now,
            null, null, null, null,
            Boolean.TRUE, "brownfield", "/workspace/acme/acme-app", null);
        when(projectService.getProjectById(projectId)).thenReturn(dto);
        when(projectImplementationRepoService.listRepos(projectId)).thenReturn(List.of(
            new ProjectImplementationRepoDto(
                "acme-app", "https://github.com/acme/app.git",
                "/workspace/acme/acme-app/acme-app", "brownfield")));

        mockMvc.perform(get("/api/projects/{id}", projectId))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.implementation_init_success").value(true))
            .andExpect(jsonPath("$.implementation_mode").value("brownfield"))
            .andExpect(jsonPath("$.implementation_project_dir").value("/workspace/acme/acme-app"))
            .andExpect(jsonPath("$.implementation_repos[0].folder").value("acme-app"))
            .andExpect(jsonPath("$.implementation_repos[0].git_url")
                .value("https://github.com/acme/app.git"))
            // repo_url dual-write is retained -- single-repo mode keeps it.
            .andExpect(jsonPath("$.repo_url").value("https://github.com/acme/app.git"));
    }

    @Test
    @DisplayName("PATCH /api/projects/{id} forwards snake_case init fields to the service")
    void patchForwardsSnakeCaseInitFields() throws Exception {
        Instant now = Instant.now();
        ProjectDto updated = new ProjectDto(
            projectId, "acme-app", "/projects/acme-app/", null, null, null,
            Boolean.TRUE, now, now, null, null, null, null,
            Boolean.FALSE, null, null, null);
        when(projectService.updateProjectConfig(
                eq(projectId), eq((Integer) null), eq((Integer) null),
                eq((Boolean) null), eq(Boolean.FALSE), eq((String) null),
                eq((String) null), eq((String) null)))
            .thenReturn(updated);

        // The gateway's init-failure write: only implementation_init_success.
        mockMvc.perform(patch("/api/projects/{id}", projectId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"implementation_init_success\": false}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.implementation_init_success").value(false));

        verify(projectService).updateProjectConfig(
            eq(projectId), eq((Integer) null), eq((Integer) null),
            eq((Boolean) null), eq(Boolean.FALSE), eq((String) null),
            eq((String) null), eq((String) null));
    }
}
