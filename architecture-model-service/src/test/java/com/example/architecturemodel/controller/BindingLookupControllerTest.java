package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.model.entity.InterfaceEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.repository.ArchitectureRepository;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.entity.InterfaceRepository;
import com.example.architecturemodel.service.InterfaceArchitectureBindingService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Focused tests for the new interface->architecture binding lookup endpoint.
 *
 * Spec: Multi-Architecture Save-Target Resolution (Spec #5) -- Task Group 1.
 *
 * Required tests covered (3 of 3 from tasks.md 1.1):
 *   1. {@link #getBinding_validInterfaceInLiveArchitecture_returns200WithPayload()}
 *      -- happy path: 200 with {architectureId, architectureName, archived: false}.
 *   2. {@link #getBinding_validInterfaceInArchivedArchitecture_returns200WithArchivedTrue()}
 *      -- archived flag is hydrated correctly when the parent architecture is archived.
 *   3. {@link #getBinding_unknownInterface_returns404()}
 *      -- 404 when the interface id does not exist.
 *   4. {@link #getBinding_interfaceInDifferentProject_returns404()}
 *      -- 404 when the interface exists but belongs to a different project (cross-project
 *      access is collapsed into "not found" so foreign ids cannot be inferred).
 *
 * Uses standalone MockMvc setup -- matches the pattern in
 * {@link ArchitectureCrudControllerTest} / {@link ArchitectureScopedRoutesTest}
 * so this class avoids the broader Spring application context (which has unrelated
 * pre-existing test failures per project memory).
 */
@ExtendWith(MockitoExtension.class)
class BindingLookupControllerTest {

    @Mock
    private InterfaceRepository interfaceRepository;
    @Mock
    private ModelFileRepository modelFileRepository;
    @Mock
    private ArchitectureRepository architectureRepository;

    private MockMvc mockMvc;

    private static final UUID PROJECT_ID =
        UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID OTHER_PROJECT_ID =
        UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID ARCH_ID =
        UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static final String INTERFACE_ID = "ifc-001";
    private static final String MODEL_FILE_ID = "mf-001";

    @BeforeEach
    void setUp() {
        InterfaceArchitectureBindingService service =
            new InterfaceArchitectureBindingService(
                interfaceRepository, modelFileRepository, architectureRepository);
        BindingLookupController controller = new BindingLookupController(service);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();
    }

    // ========================================================================
    // Test 1 -- happy path: live architecture
    // ========================================================================
    @Test
    @DisplayName("GET returns 200 with {architectureId, architectureName, archived: false} for a valid interface in a non-archived architecture")
    void getBinding_validInterfaceInLiveArchitecture_returns200WithPayload() throws Exception {
        InterfaceEntity ifc = InterfaceEntity.builder()
            .id(INTERFACE_ID)
            .modelFileId(MODEL_FILE_ID)
            .serviceId("svc-001")
            .name("Customer API")
            .build();
        ModelFileEntity modelFile = ModelFileEntity.builder()
            .id(MODEL_FILE_ID)
            .filename("model.json")
            .projectId(PROJECT_ID)
            .architectureId(ARCH_ID)
            .build();
        ArchitectureEntity arch = ArchitectureEntity.builder()
            .id(ARCH_ID)
            .projectId(PROJECT_ID)
            .name("Target State")
            .archived(false)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        when(interfaceRepository.findById(INTERFACE_ID)).thenReturn(Optional.of(ifc));
        when(modelFileRepository.findById(MODEL_FILE_ID)).thenReturn(Optional.of(modelFile));
        when(architectureRepository.findById(ARCH_ID)).thenReturn(Optional.of(arch));

        mockMvc.perform(get(
                "/api/projects/{projectId}/interfaces/{interfaceId}/architecture-binding",
                PROJECT_ID, INTERFACE_ID))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.architectureId").value(ARCH_ID.toString()))
            .andExpect(jsonPath("$.architectureName").value("Target State"))
            .andExpect(jsonPath("$.archived").value(false));
    }

    // ========================================================================
    // Test 2 -- archived flag is hydrated correctly
    // ========================================================================
    @Test
    @DisplayName("GET returns 200 with archived=true when the parent architecture is archived")
    void getBinding_validInterfaceInArchivedArchitecture_returns200WithArchivedTrue() throws Exception {
        InterfaceEntity ifc = InterfaceEntity.builder()
            .id(INTERFACE_ID)
            .modelFileId(MODEL_FILE_ID)
            .serviceId("svc-001")
            .name("Legacy API")
            .build();
        ModelFileEntity modelFile = ModelFileEntity.builder()
            .id(MODEL_FILE_ID)
            .filename("model.json")
            .projectId(PROJECT_ID)
            .architectureId(ARCH_ID)
            .build();
        ArchitectureEntity archivedArch = ArchitectureEntity.builder()
            .id(ARCH_ID)
            .projectId(PROJECT_ID)
            .name("Old Architecture")
            .archived(true)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();

        when(interfaceRepository.findById(INTERFACE_ID)).thenReturn(Optional.of(ifc));
        when(modelFileRepository.findById(MODEL_FILE_ID)).thenReturn(Optional.of(modelFile));
        when(architectureRepository.findById(ARCH_ID)).thenReturn(Optional.of(archivedArch));

        mockMvc.perform(get(
                "/api/projects/{projectId}/interfaces/{interfaceId}/architecture-binding",
                PROJECT_ID, INTERFACE_ID))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.architectureId").value(ARCH_ID.toString()))
            .andExpect(jsonPath("$.architectureName").value("Old Architecture"))
            .andExpect(jsonPath("$.archived").value(true));
    }

    // ========================================================================
    // Test 3 -- 404 when the interface id does not exist
    // ========================================================================
    @Test
    @DisplayName("GET returns 404 when the interface id does not exist")
    void getBinding_unknownInterface_returns404() throws Exception {
        when(interfaceRepository.findById(INTERFACE_ID)).thenReturn(Optional.empty());

        mockMvc.perform(get(
                "/api/projects/{projectId}/interfaces/{interfaceId}/architecture-binding",
                PROJECT_ID, INTERFACE_ID))
            .andExpect(status().isNotFound());
    }

    // ========================================================================
    // Test 4 -- 404 when the interface belongs to a different project
    // ========================================================================
    @Test
    @DisplayName("GET returns 404 when the interface belongs to a different project (cross-project access collapsed into not-found)")
    void getBinding_interfaceInDifferentProject_returns404() throws Exception {
        InterfaceEntity ifc = InterfaceEntity.builder()
            .id(INTERFACE_ID)
            .modelFileId(MODEL_FILE_ID)
            .serviceId("svc-001")
            .name("Foreign API")
            .build();
        // Model file lives under OTHER_PROJECT_ID; the URL is scoped to PROJECT_ID.
        ModelFileEntity foreignModelFile = ModelFileEntity.builder()
            .id(MODEL_FILE_ID)
            .filename("model.json")
            .projectId(OTHER_PROJECT_ID)
            .architectureId(ARCH_ID)
            .build();

        when(interfaceRepository.findById(INTERFACE_ID)).thenReturn(Optional.of(ifc));
        when(modelFileRepository.findById(MODEL_FILE_ID)).thenReturn(Optional.of(foreignModelFile));

        mockMvc.perform(get(
                "/api/projects/{projectId}/interfaces/{interfaceId}/architecture-binding",
                PROJECT_ID, INTERFACE_ID))
            .andExpect(status().isNotFound());
    }
}
