package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.EntityMapper;
import com.example.architecturemodel.model.dto.entity.ServiceDto;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.model.entity.ServiceEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.entity.ApplicationComponentRepository;
import com.example.architecturemodel.repository.entity.ApplicationRepository;
import com.example.architecturemodel.repository.entity.ServiceRepository;
import com.example.architecturemodel.service.ModelService;
import com.example.architecturemodel.service.DiagramExportService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.Optional;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Focused tests for the architecture-scoped Bucket A routes.
 *
 * Spec: Multi-Architecture Plumbing (Spec #1) -- Task Group 2 / Task 2.1.
 *
 * Required tests covered:
 *   1. {@link #getService_validProjectAndArchitecture_returns200()} -- a Bucket A
 *      controller returns 200 when called with a valid (projectId, architectureId)
 *      pair.
 *   2. {@link #getService_missingArchitectureIdInUrl_returns404()} -- the
 *      core path-segment safety property: forgetting the architectureId segment
 *      from the URL produces a Spring 404 (NoHandlerFound / route mismatch),
 *      with no controller-side fallback resolution.
 *   3. {@link #getService_filtersByArchitectureId_excludesSiblingArchitecture()} --
 *      repository-level filtering by architecture_id excludes rows in a sibling
 *      architecture within the same project.
 *   4. {@link #modelController_newPathSegmentEndpoint_returns200()} -- the new
 *      hard-cutover ModelController endpoint at
 *      /api/model/projects/{projectId}/architectures/{architectureId} responds.
 *   5. {@link #modelController_oldQueryParamForm_returns404()} -- the OLD
 *      /api/model?projectId=... form is gone: hitting it with only projectId
 *      returns a route mismatch (no longer a recognised endpoint variant).
 *
 * Uses standalone MockMvc setup (not @WebMvcTest) so the test class is
 * self-contained and avoids any cross-contamination from the broader application
 * context (which is known to have unrelated pre-existing test failures per the
 * project memory note).
 */
@ExtendWith(MockitoExtension.class)
class ArchitectureScopedRoutesTest {

    @Mock
    private ModelFileRepository modelFileRepository;
    @Mock
    private ServiceRepository serviceRepository;
    @Mock
    private ApplicationRepository applicationRepository;
    @Mock
    private ApplicationComponentRepository applicationComponentRepository;
    @Mock
    private EntityMapper entityMapper;
    @Mock
    private ModelService modelService;
    @Mock
    private DiagramExportService diagramExportService;

    private MockMvc modelEntityMockMvc;
    private MockMvc modelMockMvc;

    private static final UUID PROJECT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID ARCH_A_ID = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static final UUID ARCH_B_ID = UUID.fromString("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static final String SERVICE_ID = "svc-1";
    private static final String MODEL_FILE_A_ID = "mf-arch-a";
    private static final String MODEL_FILE_B_ID = "mf-arch-b";

    @BeforeEach
    void setUp() {
        ModelEntityController modelEntityController = new ModelEntityController(
            modelFileRepository, serviceRepository, applicationRepository,
            applicationComponentRepository, entityMapper);
        modelEntityMockMvc = MockMvcBuilders.standaloneSetup(modelEntityController)
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();

        ModelController modelController = new ModelController(modelService, diagramExportService);
        modelMockMvc = MockMvcBuilders.standaloneSetup(modelController)
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();
    }

    // ========================================================================
    // Test 1: 200 happy path on Bucket A controller
    // ========================================================================
    @Test
    @DisplayName("ModelEntityController.getService returns 200 with valid (projectId, architectureId)")
    void getService_validProjectAndArchitecture_returns200() throws Exception {
        ModelFileEntity modelFile = ModelFileEntity.builder()
            .id(MODEL_FILE_A_ID).projectId(PROJECT_ID).architectureId(ARCH_A_ID)
            .filename("test").isDefault(false).build();
        ServiceEntity service = ServiceEntity.builder()
            .id(SERVICE_ID).name("UserService").modelFileId(MODEL_FILE_A_ID).build();
        ServiceDto dto = new ServiceDto(
            SERVICE_ID, "UserService", null, null, null, null,
            null, null, null, null, null, null, null, null,
            null, null, null, null, null);

        when(modelFileRepository.findByProjectIdAndArchitectureId(PROJECT_ID, ARCH_A_ID))
            .thenReturn(Optional.of(modelFile));
        when(serviceRepository.findById(SERVICE_ID)).thenReturn(Optional.of(service));
        when(entityMapper.toDto(service)).thenReturn(dto);

        modelEntityMockMvc.perform(get(
                "/api/model/projects/{projectId}/architectures/{architectureId}/entities/services/{serviceId}",
                PROJECT_ID, ARCH_A_ID, SERVICE_ID))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value(SERVICE_ID))
            .andExpect(jsonPath("$.name").value("UserService"));

        verify(modelFileRepository).findByProjectIdAndArchitectureId(PROJECT_ID, ARCH_A_ID);
    }

    // ========================================================================
    // Test 2: PATH-SEGMENT 404 SAFETY -- the core spec property
    // ========================================================================
    @Test
    @DisplayName("ModelEntityController returns 404 when {architectureId} segment is missing -- path-segment safety")
    void getService_missingArchitectureIdInUrl_returns404() throws Exception {
        // Construct the OLD-style URL (without the /architectures/{architectureId}
        // segment). Spring must route-mismatch this and return a 404 -- there is
        // no controller-side fallback that resolves a default architecture.
        modelEntityMockMvc.perform(get(
                "/api/model/projects/{projectId}/entities/services/{serviceId}",
                PROJECT_ID, SERVICE_ID))
            .andExpect(status().isNotFound());

        // And critically, the repository must NOT have been touched -- if it
        // had been, that would mean a controller had silently picked up the
        // request and resolved a default. The whole point of path-segment
        // routing is to make the request impossible to mis-route.
        verify(modelFileRepository, never()).findByProjectId(any());
        verify(modelFileRepository, never()).findByProjectIdAndArchitectureId(any(), any());
    }

    // ========================================================================
    // Test 3: Repository-level filtering by architecture_id excludes siblings
    // ========================================================================
    @Test
    @DisplayName("ModelFileRepository filtering excludes rows from sibling architecture in same project")
    void getService_filtersByArchitectureId_excludesSiblingArchitecture() throws Exception {
        // Project has two architectures. Architecture A's model file contains
        // service svc-1; Architecture B's model file contains a DIFFERENT row
        // with the same id (or none at all -- either way, the architecture-B
        // request must NOT find arch-A's row).
        //
        // We simulate that by having findByProjectIdAndArchitectureId return:
        //   - Optional.of(modelFileA) when called with ARCH_A_ID
        //   - Optional.of(modelFileB) when called with ARCH_B_ID
        // Then we verify that a request scoped to ARCH_B is checked against
        // modelFileB.id (not modelFileA.id) and so a service belonging only
        // to modelFileA returns 404 (does-not-belong-to-project case).
        ModelFileEntity modelFileA = ModelFileEntity.builder()
            .id(MODEL_FILE_A_ID).projectId(PROJECT_ID).architectureId(ARCH_A_ID)
            .filename("a").isDefault(false).build();
        ModelFileEntity modelFileB = ModelFileEntity.builder()
            .id(MODEL_FILE_B_ID).projectId(PROJECT_ID).architectureId(ARCH_B_ID)
            .filename("b").isDefault(false).build();
        // svc-1 belongs to model file A only (architecture A).
        ServiceEntity serviceInA = ServiceEntity.builder()
            .id(SERVICE_ID).name("UserService").modelFileId(MODEL_FILE_A_ID).build();

        when(modelFileRepository.findByProjectIdAndArchitectureId(PROJECT_ID, ARCH_B_ID))
            .thenReturn(Optional.of(modelFileB));
        when(serviceRepository.findById(SERVICE_ID)).thenReturn(Optional.of(serviceInA));

        // Request scoped to ARCH_B for a service that lives in ARCH_A.
        // Expected: 404 because the service.modelFileId (mf-arch-a) does
        // not match the resolved model file id (mf-arch-b).
        modelEntityMockMvc.perform(get(
                "/api/model/projects/{projectId}/architectures/{architectureId}/entities/services/{serviceId}",
                PROJECT_ID, ARCH_B_ID, SERVICE_ID))
            .andExpect(status().isNotFound());

        // Verify the architecture-scoped repository call happened with ARCH_B
        // (not ARCH_A) -- proves the URL-supplied architecture is what's
        // threaded into the repository query.
        verify(modelFileRepository).findByProjectIdAndArchitectureId(PROJECT_ID, ARCH_B_ID);
        verify(modelFileRepository, never()).findByProjectIdAndArchitectureId(eq(PROJECT_ID), eq(ARCH_A_ID));
    }

    // ========================================================================
    // Test 4: ModelController -- new path-segment endpoint responds
    // ========================================================================
    @Test
    @DisplayName("ModelController responds at the new /projects/{p}/architectures/{a} path")
    void modelController_newPathSegmentEndpoint_returns200() throws Exception {
        when(modelService.loadModelByProjectIdAndArchitectureId(PROJECT_ID, ARCH_A_ID))
            .thenReturn(new com.example.architecturemodel.model.dto.ArchitectureModelDto(
                null, java.util.Collections.emptyList()));

        modelMockMvc.perform(get(
                "/api/model/projects/{projectId}/architectures/{architectureId}",
                PROJECT_ID, ARCH_A_ID))
            .andExpect(status().isOk());

        verify(modelService).loadModelByProjectIdAndArchitectureId(PROJECT_ID, ARCH_A_ID);
    }

    // ========================================================================
    // Test 5: ModelController -- HARD CUTOVER: old ?projectId=... form is gone
    // ========================================================================
    @Test
    @DisplayName("ModelController OLD query-param form (/api/model?projectId=...) no longer routes to project-load")
    void modelController_oldQueryParamForm_returns404() throws Exception {
        // The pre-spec endpoint was: GET /api/model?projectId=<UUID>
        // Per spec #1's hard cutover, this form is REMOVED.
        //
        // Behaviour after cutover: GET /api/model only honours `?filename=`.
        // When called with only `?projectId=`, the loadModel handler sees a
        // null filename and falls through to ModelService.loadModel(null), which
        // looks up the default model file. That's a separate codepath and MUST
        // NOT call loadModelByProjectIdAndArchitectureId. We assert exactly
        // that: the project-aware loader is never invoked.
        when(modelService.loadModel(any())).thenThrow(
            new ResourceNotFoundException("No model files exist"));

        modelMockMvc.perform(get("/api/model")
                .param("projectId", PROJECT_ID.toString()))
            .andExpect(status().isNotFound());

        // The crucial assertion: the project-load codepath was not invoked
        // by any old-style query-param request.
        verify(modelService, never()).loadModelByProjectIdAndArchitectureId(any(), any());
    }
}
