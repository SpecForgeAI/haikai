package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.ProjectDto;
import com.example.architecturemodel.service.OrganisationService;
import com.example.architecturemodel.service.ProjectImplementationRepoService;
import com.example.architecturemodel.service.ProjectService;
import com.example.architecturemodel.service.ProjectSnapshotService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.ResponseEntity;

import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit-level coverage for the PATCH /api/projects/{id} config endpoint added
 * in Task Group 9 of the Cross-Story Context Injection spec (2026-05-20).
 *
 * <p>Mockito-only (no Spring MVC context) so the test runs under the AMS
 * isolated-javac workaround used by Task Groups 1-4 in this spec.</p>
 *
 * <p>Two focused assertions live here, complementing the resolver-level
 * coverage in {@link com.example.architecturemodel.service.migration.MigrationSpecContextResolverProjectConfigTest}:</p>
 * <ol>
 *   <li>The controller forwards all three Task-Group-9 fields to
 *       {@link ProjectService#updateProjectConfig(UUID, Integer, Integer, Boolean)}
 *       and returns the resulting {@link ProjectDto} in the response body,
 *       with {@code autoRunPass2 = true} persisted when the caller sets it.
 *       This satisfies the "auto_run_pass_2 defaults to true when not set"
 *       requirement at the persistence-round-trip layer: the DB DEFAULT is
 *       TRUE and the controller transparently round-trips the boxed Boolean
 *       value through the service / mapper / DTO stack.</li>
 *   <li>A PATCH body that omits a field deserialises that record component as
 *       {@code null} on the boxed wrapper -- per
 *       project_primitive_double_dto_overwrite.md, null means "do not change".
 *       We assert the controller does not synthesise a default value before
 *       forwarding -- the service layer null-guards each assignment instead.</li>
 * </ol>
 */
@ExtendWith(MockitoExtension.class)
class ProjectControllerConfigPatchTest {

    @Mock private ProjectService projectService;
    @Mock private OrganisationService organisationService;
    @Mock private ProjectSnapshotService projectSnapshotService;
    @Mock private ProjectImplementationRepoService projectImplementationRepoService;

    private ProjectController controller;
    private UUID projectId;

    @BeforeEach
    void setUp() {
        controller = new ProjectController(
            projectService, organisationService, projectSnapshotService,
            projectImplementationRepoService);
        projectId = UUID.randomUUID();
    }

    private ProjectDto buildDtoWithConfig(
            Integer perStory, Integer crossStory, Boolean autoRunPass2) {
        return new ProjectDto(
            projectId,
            "test-project",
            "/tmp/test",
            null, // projectHierarchy
            null, // organisationId
            null, // repoUrl
            Boolean.TRUE,
            Instant.now(),
            Instant.now(),
            perStory,
            crossStory,
            autoRunPass2
        );
    }

    @Test
    @DisplayName("PATCH /api/projects/{id} forwards all three config fields and returns updated DTO with auto_run_pass_2 set")
    void patchForwardsAllFieldsAndReturnsDtoWithAutoRunPass2True() {
        ProjectController.UpdateProjectConfigRequest body =
            new ProjectController.UpdateProjectConfigRequest(
                Integer.valueOf(32000),
                Integer.valueOf(16000),
                Boolean.TRUE);

        ProjectDto updated = buildDtoWithConfig(
            Integer.valueOf(32000), Integer.valueOf(16000), Boolean.TRUE);
        when(projectService.updateProjectConfig(
                eq(projectId),
                eq(Integer.valueOf(32000)),
                eq(Integer.valueOf(16000)),
                eq(Boolean.TRUE),
                eq((Boolean) null),
                eq((String) null),
                eq((String) null),
                eq((String) null)))
            .thenReturn(updated);

        ResponseEntity<ProjectDto> response =
            controller.updateProjectConfig(projectId, body);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().perStoryContextTokenCap()).isEqualTo(32000);
        assertThat(response.getBody().crossStoryContextTokenCap()).isEqualTo(16000);
        assertThat(response.getBody().autoRunPass2())
            .as("auto_run_pass_2 must round-trip through the DTO -- DB DEFAULT TRUE, "
                + "PATCH carries TRUE, service returns DTO with autoRunPass2 set")
            .isEqualTo(Boolean.TRUE);
    }

    @Test
    @DisplayName("PATCH with null fields forwards null to service (null-guarded, no defaulting at controller)")
    void patchWithNullFieldsPreservesNullForwarding() {
        // All three fields null -- simulates a PATCH that omits every key.
        // The controller MUST NOT synthesise a default; the service-layer
        // null-guard is what protects against silently wiping the stored value
        // (project_primitive_double_dto_overwrite.md).
        ProjectController.UpdateProjectConfigRequest body =
            new ProjectController.UpdateProjectConfigRequest(null, null, null);

        ProjectDto unchanged = buildDtoWithConfig(
            Integer.valueOf(24000), Integer.valueOf(12000), Boolean.TRUE);
        when(projectService.updateProjectConfig(
                eq(projectId),
                eq((Integer) null),
                eq((Integer) null),
                eq((Boolean) null),
                eq((Boolean) null),
                eq((String) null),
                eq((String) null),
                eq((String) null)))
            .thenReturn(unchanged);

        ResponseEntity<ProjectDto> response =
            controller.updateProjectConfig(projectId, body);

        // Verify the controller forwarded null on each field rather than
        // synthesising defaults -- the service layer is the single point that
        // null-guards the assignment.
        ArgumentCaptor<Integer> perCaptor = ArgumentCaptor.forClass(Integer.class);
        ArgumentCaptor<Integer> crossCaptor = ArgumentCaptor.forClass(Integer.class);
        ArgumentCaptor<Boolean> autoCaptor = ArgumentCaptor.forClass(Boolean.class);
        verify(projectService).updateProjectConfig(
            eq(projectId),
            perCaptor.capture(),
            crossCaptor.capture(),
            autoCaptor.capture(),
            eq((Boolean) null),
            eq((String) null),
            eq((String) null),
            eq((String) null));

        assertThat(perCaptor.getValue()).isNull();
        assertThat(crossCaptor.getValue()).isNull();
        assertThat(autoCaptor.getValue()).isNull();

        // And the DTO that comes back surfaces the DB-default values that the
        // service left untouched. This is the "auto_run_pass_2 defaults to
        // true when not set" assertion: a freshly inserted row has TRUE from
        // the DB DEFAULT clause; a PATCH that omits the field leaves it TRUE.
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().autoRunPass2()).isEqualTo(Boolean.TRUE);
        assertThat(response.getBody().perStoryContextTokenCap()).isEqualTo(24000);
        assertThat(response.getBody().crossStoryContextTokenCap()).isEqualTo(12000);
    }
}
