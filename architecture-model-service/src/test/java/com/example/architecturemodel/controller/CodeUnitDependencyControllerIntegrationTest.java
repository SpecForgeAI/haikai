package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.mapper.EntityMapper;
import com.example.architecturemodel.model.dto.relationship.CodeUnitDependencyDto;
import com.example.architecturemodel.model.entity.CodeUnitDependencyEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.relationship.CodeUnitDependencyRepository;
import com.example.architecturemodel.service.CodeUnitDependencyService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.math.BigDecimal;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Integration tests for {@link CodeUnitDependencyController}'s find-or-create
 * endpoint (Spec: 2026-05-06-library-discovery-integration -- Task Group 1).
 *
 * <p>Uses the standalone MockMvc pattern (no full Spring context) so the test
 * class is self-contained and isolated from the ~117 pre-existing broken
 * backend Java test files. The {@link CodeUnitDependencyService} is wired
 * against mocked repositories + a real {@link EntityMapper} so the
 * snake_case JSON contract (via {@code @JsonProperty}) is exercised
 * end-to-end.</p>
 *
 * <p>Tests covered (per tasks.md 1.1):</p>
 * <ol>
 *   <li>NULL-tolerant version match -- pre-seed a row with
 *       {@code declared_version=NULL}; POST a body with the same
 *       {@code (source_AP_id, target_AP_id, declared_name)} and
 *       {@code declared_version=null}; assert {@code is_new=false}, returned
 *       id matches existing row.</li>
 *   <li>Create branch with non-null {@code declared_version} inserts a new
 *       row with {@code is_new=true}.</li>
 *   <li>Find branch with non-null {@code declared_version} returns
 *       {@code is_new=false}.</li>
 * </ol>
 */
@ExtendWith(MockitoExtension.class)
class CodeUnitDependencyControllerIntegrationTest {

    @Mock
    private ModelFileRepository modelFileRepository;
    @Mock
    private CodeUnitDependencyRepository codeUnitDependencyRepository;

    private MockMvc mockMvc;
    private ObjectMapper objectMapper;

    private static final UUID PROJECT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID ARCH_ID = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static final String MODEL_FILE_ID = "mf-arch-a";

    @BeforeEach
    void setUp() {
        EntityMapper realMapper = new EntityMapper();
        CodeUnitDependencyService service = new CodeUnitDependencyService(
            modelFileRepository, codeUnitDependencyRepository, realMapper);
        CodeUnitDependencyController controller = new CodeUnitDependencyController(service);

        mockMvc = MockMvcBuilders.standaloneSetup(controller)
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();

        objectMapper = new ObjectMapper();
        objectMapper.registerModule(new JavaTimeModule());
    }

    private ModelFileEntity modelFile() {
        return ModelFileEntity.builder()
            .id(MODEL_FILE_ID)
            .projectId(PROJECT_ID)
            .architectureId(ARCH_ID)
            .filename("test")
            .isDefault(false)
            .build();
    }

    private CodeUnitDependencyDto buildPayload(String declaredVersion) {
        return new CodeUnitDependencyDto(
            null, // id
            "ap-svc-orders",
            "ap-lib-foo",
            "com.example:foo-lib",
            declaredVersion,
            null,
            "COMPILE",
            "pom.xml",
            42,
            "DISCOVERY_RESOLVER",
            new BigDecimal("1.000"),
            null, null);
    }

    // ------------------------------------------------------------------------
    // Test 1: NULL-tolerant version match -- pre-seed a row with
    // declared_version=NULL; POST with declared_version=null; assert
    // is_new=false, returned id matches existing row.
    // ------------------------------------------------------------------------
    @Test
    @DisplayName("POST /code-unit-dependencies: null-tolerant version match returns existing row")
    void postCodeUnitDependencies_nullTolerantVersionMatch_returnsExistingRow() throws Exception {
        when(modelFileRepository.findByProjectIdAndArchitectureId(PROJECT_ID, ARCH_ID))
            .thenReturn(Optional.of(modelFile()));

        CodeUnitDependencyEntity existing = CodeUnitDependencyEntity.builder()
            .id("cud-existing-null-1")
            .modelFileId(MODEL_FILE_ID)
            .sourceApplicationPointId("ap-svc-orders")
            .targetApplicationPointId("ap-lib-foo")
            .declaredName("com.example:foo-lib")
            .declaredVersion(null) // NULL
            .scope("COMPILE")
            .manifestPath("pom.xml")
            .manifestLine(42)
            .evidenceSource("DISCOVERY_RESOLVER")
            .confidence(new BigDecimal("1.000"))
            .build();

        when(codeUnitDependencyRepository.findOneBySourceTargetDeclared(
                eqStr("ap-svc-orders"), eqStr("ap-lib-foo"),
                eqStr("com.example:foo-lib"), isNull()))
            .thenReturn(Optional.of(existing));

        CodeUnitDependencyDto request = buildPayload(null); // declared_version=null

        mockMvc.perform(post("/api/model/projects/{p}/architectures/{a}/code-unit-dependencies",
                PROJECT_ID, ARCH_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value("cud-existing-null-1"))
            .andExpect(jsonPath("$.is_new").value(false))
            .andExpect(jsonPath("$.code_unit_dependency.source_application_point_id")
                .value("ap-svc-orders"))
            .andExpect(jsonPath("$.code_unit_dependency.target_application_point_id")
                .value("ap-lib-foo"))
            .andExpect(jsonPath("$.code_unit_dependency.declared_name")
                .value("com.example:foo-lib"))
            .andExpect(jsonPath("$.code_unit_dependency.declared_version").doesNotExist());

        // No insert on the find branch.
        verify(codeUnitDependencyRepository, never()).save(any(CodeUnitDependencyEntity.class));
    }

    // ------------------------------------------------------------------------
    // Test 2: Create branch with non-null declared_version inserts new row.
    // ------------------------------------------------------------------------
    @Test
    @DisplayName("POST /code-unit-dependencies: create branch inserts new row with is_new=true")
    void postCodeUnitDependencies_createBranch_insertsNewRow() throws Exception {
        when(modelFileRepository.findByProjectIdAndArchitectureId(PROJECT_ID, ARCH_ID))
            .thenReturn(Optional.of(modelFile()));
        when(codeUnitDependencyRepository.findOneBySourceTargetDeclared(
                anyStr(), anyStr(), anyStr(), eqStr("1.4.2")))
            .thenReturn(Optional.empty());
        when(codeUnitDependencyRepository.save(any(CodeUnitDependencyEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));

        CodeUnitDependencyDto request = buildPayload("1.4.2");

        mockMvc.perform(post("/api/model/projects/{p}/architectures/{a}/code-unit-dependencies",
                PROJECT_ID, ARCH_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").isNotEmpty())
            .andExpect(jsonPath("$.is_new").value(true))
            .andExpect(jsonPath("$.code_unit_dependency.declared_version").value("1.4.2"))
            .andExpect(jsonPath("$.code_unit_dependency.scope").value("COMPILE"));

        ArgumentCaptor<CodeUnitDependencyEntity> savedCaptor =
            ArgumentCaptor.forClass(CodeUnitDependencyEntity.class);
        verify(codeUnitDependencyRepository).save(savedCaptor.capture());
        CodeUnitDependencyEntity saved = savedCaptor.getValue();
        assertThat(saved.getId()).isNotBlank();
        assertThat(saved.getModelFileId()).isEqualTo(MODEL_FILE_ID);
        assertThat(saved.getDeclaredName()).isEqualTo("com.example:foo-lib");
        assertThat(saved.getDeclaredVersion()).isEqualTo("1.4.2");
    }

    // ------------------------------------------------------------------------
    // Test 3: Find branch with non-null declared_version returns existing row.
    // ------------------------------------------------------------------------
    @Test
    @DisplayName("POST /code-unit-dependencies: find branch with non-null version returns is_new=false")
    void postCodeUnitDependencies_findBranchNonNullVersion_returnsExisting() throws Exception {
        when(modelFileRepository.findByProjectIdAndArchitectureId(PROJECT_ID, ARCH_ID))
            .thenReturn(Optional.of(modelFile()));

        CodeUnitDependencyEntity existing = CodeUnitDependencyEntity.builder()
            .id("cud-existing-versioned-1")
            .modelFileId(MODEL_FILE_ID)
            .sourceApplicationPointId("ap-svc-orders")
            .targetApplicationPointId("ap-lib-foo")
            .declaredName("com.example:foo-lib")
            .declaredVersion("1.4.2")
            .scope("COMPILE")
            .build();
        when(codeUnitDependencyRepository.findOneBySourceTargetDeclared(
                eqStr("ap-svc-orders"), eqStr("ap-lib-foo"),
                eqStr("com.example:foo-lib"), eqStr("1.4.2")))
            .thenReturn(Optional.of(existing));

        CodeUnitDependencyDto request = buildPayload("1.4.2");

        mockMvc.perform(post("/api/model/projects/{p}/architectures/{a}/code-unit-dependencies",
                PROJECT_ID, ARCH_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value("cud-existing-versioned-1"))
            .andExpect(jsonPath("$.is_new").value(false))
            .andExpect(jsonPath("$.code_unit_dependency.declared_version").value("1.4.2"));

        verify(codeUnitDependencyRepository, never()).save(any(CodeUnitDependencyEntity.class));
    }

    // ------------------------------------------------------------------------
    // Local helpers wrapping ArgumentMatchers.eq to keep the test methods
    // readable (avoid repeating eq("...") at every call site).
    // ------------------------------------------------------------------------
    private static String eqStr(String s) {
        return org.mockito.ArgumentMatchers.eq(s);
    }

    private static String anyStr() {
        return org.mockito.ArgumentMatchers.anyString();
    }
}
