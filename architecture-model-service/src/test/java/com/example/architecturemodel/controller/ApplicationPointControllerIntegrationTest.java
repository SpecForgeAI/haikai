package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.mapper.EntityMapper;
import com.example.architecturemodel.model.dto.entity.ApplicationPointDto;
import com.example.architecturemodel.model.entity.ApplicationEntity;
import com.example.architecturemodel.model.entity.ApplicationPointEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.entity.ApplicationPointRepository;
import com.example.architecturemodel.repository.entity.ApplicationRepository;
import com.example.architecturemodel.service.ApplicationPointService;
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

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Integration tests for {@link ApplicationPointController}'s 2 new endpoints
 * (Fix #5 Sub-step 5a -- synthetic-placeholder removal).
 *
 * <p>Uses the standalone MockMvc pattern (no full Spring context) so the
 * test class is self-contained and isolated from the ~117 pre-existing
 * broken backend Java test files. {@link ApplicationPointService} is wired
 * against mocked repositories + a real {@link EntityMapper} so the
 * snake_case JSON contract is exercised end-to-end through MockMvc.</p>
 *
 * <p>Tests:</p>
 * <ol>
 *   <li>GET /by-target returns 200 with the AP DTO when a row matches the
 *       (target_type, target_ref_id) tuple.</li>
 *   <li>GET /by-target returns 404 when no row matches.</li>
 *   <li>POST /application-points returns is_new=true and inserts a row with
 *       sentinel application_id resolved from the first Application of the
 *       model file (mirrors Fix #4).</li>
 *   <li>POST /application-points returns is_new=false when the
 *       (model_file_id, target_type, target_ref_id) tuple already exists.</li>
 * </ol>
 */
@ExtendWith(MockitoExtension.class)
class ApplicationPointControllerIntegrationTest {

    @Mock
    private ModelFileRepository modelFileRepository;
    @Mock
    private ApplicationPointRepository applicationPointRepository;
    @Mock
    private ApplicationRepository applicationRepository;

    private MockMvc mockMvc;
    private ObjectMapper objectMapper;

    private static final UUID PROJECT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID ARCH_ID = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static final String MODEL_FILE_ID = "mf-arch-a";
    private static final String SENTINEL_APP_ID = "app-sentinel-1";

    @BeforeEach
    void setUp() {
        EntityMapper realMapper = new EntityMapper();
        ApplicationPointService service = new ApplicationPointService(
            modelFileRepository, applicationPointRepository, applicationRepository, realMapper);
        ApplicationPointController controller = new ApplicationPointController(service);

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

    private ApplicationEntity sentinelApplication() {
        return ApplicationEntity.builder()
            .id(SENTINEL_APP_ID)
            .modelFileId(MODEL_FILE_ID)
            .name("Test Application")
            .abbreviation("TA")
            .build();
    }

    // ------------------------------------------------------------------------
    // Test 1: GET /by-target hit -- returns 200 with the AP DTO.
    // ------------------------------------------------------------------------
    @Test
    @DisplayName("GET /application-points/by-target: returns 200 with AP DTO when match found")
    void getByTarget_hit_returns200WithDto() throws Exception {
        when(modelFileRepository.findByProjectIdAndArchitectureId(PROJECT_ID, ARCH_ID))
            .thenReturn(Optional.of(modelFile()));

        ApplicationPointEntity row = ApplicationPointEntity.builder()
            .id("ap-svc-1")
            .modelFileId(MODEL_FILE_ID)
            .name("OrderService (Service)")
            .kind("SERVICE")
            .applicationId(SENTINEL_APP_ID)
            .targetType("SERVICE")
            .targetRefId("svc-1")
            .build();
        when(applicationPointRepository.findByModelFileIdAndTargetTypeAndTargetRefId(
                MODEL_FILE_ID, "SERVICE", "svc-1"))
            .thenReturn(Optional.of(row));

        mockMvc.perform(get("/api/model/projects/{p}/architectures/{a}/application-points/by-target",
                PROJECT_ID, ARCH_ID)
                .param("targetType", "SERVICE")
                .param("targetRefId", "svc-1"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value("ap-svc-1"))
            .andExpect(jsonPath("$.target_type").value("SERVICE"))
            .andExpect(jsonPath("$.target_ref_id").value("svc-1"))
            .andExpect(jsonPath("$.kind").value("SERVICE"))
            .andExpect(jsonPath("$.application_id").value(SENTINEL_APP_ID));
    }

    // ------------------------------------------------------------------------
    // Test 2: GET /by-target miss -- returns 404.
    // ------------------------------------------------------------------------
    @Test
    @DisplayName("GET /application-points/by-target: returns 404 on miss")
    void getByTarget_miss_returns404() throws Exception {
        when(modelFileRepository.findByProjectIdAndArchitectureId(PROJECT_ID, ARCH_ID))
            .thenReturn(Optional.of(modelFile()));
        when(applicationPointRepository.findByModelFileIdAndTargetTypeAndTargetRefId(
                MODEL_FILE_ID, "SERVICE", "svc-missing"))
            .thenReturn(Optional.empty());

        mockMvc.perform(get("/api/model/projects/{p}/architectures/{a}/application-points/by-target",
                PROJECT_ID, ARCH_ID)
                .param("targetType", "SERVICE")
                .param("targetRefId", "svc-missing"))
            .andExpect(status().isNotFound());
    }

    // ------------------------------------------------------------------------
    // Test 3: POST find-or-create insert branch -- returns is_new=true and
    // inserts an AP with sentinel application_id from the first Application
    // of the model file (mirrors Fix #4).
    // ------------------------------------------------------------------------
    @Test
    @DisplayName("POST /application-points: insert branch returns is_new=true with sentinel application_id")
    void postFindOrCreate_insertBranch_returnsIsNewTrue() throws Exception {
        when(modelFileRepository.findByProjectIdAndArchitectureId(PROJECT_ID, ARCH_ID))
            .thenReturn(Optional.of(modelFile()));
        when(applicationPointRepository.findByModelFileIdAndTargetTypeAndTargetRefId(
                MODEL_FILE_ID, "SERVICE", "svc-1"))
            .thenReturn(Optional.empty());
        when(applicationPointRepository.save(any(ApplicationPointEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));
        when(applicationRepository.findByModelFileId(MODEL_FILE_ID))
            .thenReturn(List.of(sentinelApplication()));

        ApplicationPointDto request = new ApplicationPointDto(
            null, "OrderService", null, "SERVICE",
            null, null, null, null,
            "SERVICE", "svc-1",
            null, null, null, null);

        mockMvc.perform(post("/api/model/projects/{p}/architectures/{a}/application-points",
                PROJECT_ID, ARCH_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.is_new").value(true))
            .andExpect(jsonPath("$.id").isNotEmpty())
            .andExpect(jsonPath("$.application_point.target_type").value("SERVICE"))
            .andExpect(jsonPath("$.application_point.target_ref_id").value("svc-1"))
            .andExpect(jsonPath("$.application_point.kind").value("SERVICE"))
            .andExpect(jsonPath("$.application_point.application_id").value(SENTINEL_APP_ID));

        ArgumentCaptor<ApplicationPointEntity> apCaptor =
            ArgumentCaptor.forClass(ApplicationPointEntity.class);
        verify(applicationPointRepository).save(apCaptor.capture());
        ApplicationPointEntity saved = apCaptor.getValue();
        assertThat(saved.getId()).isNotBlank();
        assertThat(saved.getModelFileId()).isEqualTo(MODEL_FILE_ID);
        assertThat(saved.getTargetType()).isEqualTo("SERVICE");
        assertThat(saved.getTargetRefId()).isEqualTo("svc-1");
        assertThat(saved.getKind()).isEqualTo("SERVICE");
        assertThat(saved.getApplicationId()).isEqualTo(SENTINEL_APP_ID);
    }

    // ------------------------------------------------------------------------
    // Test 4: POST find-or-create find branch -- returns is_new=false and
    // does NOT insert.
    // ------------------------------------------------------------------------
    @Test
    @DisplayName("POST /application-points: find branch returns is_new=false without inserting")
    void postFindOrCreate_findBranch_returnsIsNewFalse() throws Exception {
        when(modelFileRepository.findByProjectIdAndArchitectureId(PROJECT_ID, ARCH_ID))
            .thenReturn(Optional.of(modelFile()));

        ApplicationPointEntity existing = ApplicationPointEntity.builder()
            .id("ap-existing-svc-1")
            .modelFileId(MODEL_FILE_ID)
            .name("OrderService (Service)")
            .kind("SERVICE")
            .applicationId(SENTINEL_APP_ID)
            .targetType("SERVICE")
            .targetRefId("svc-1")
            .build();
        when(applicationPointRepository.findByModelFileIdAndTargetTypeAndTargetRefId(
                MODEL_FILE_ID, "SERVICE", "svc-1"))
            .thenReturn(Optional.of(existing));

        ApplicationPointDto request = new ApplicationPointDto(
            null, "OrderService", null, "SERVICE",
            null, null, null, null,
            "SERVICE", "svc-1",
            null, null, null, null);

        mockMvc.perform(post("/api/model/projects/{p}/architectures/{a}/application-points",
                PROJECT_ID, ARCH_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.is_new").value(false))
            .andExpect(jsonPath("$.id").value("ap-existing-svc-1"))
            .andExpect(jsonPath("$.application_point.id").value("ap-existing-svc-1"));

        // Crucially: no save was called on the find branch.
        verify(applicationPointRepository, never()).save(any(ApplicationPointEntity.class));
    }
}
