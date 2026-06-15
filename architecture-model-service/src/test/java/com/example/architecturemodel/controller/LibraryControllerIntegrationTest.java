package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.mapper.EntityMapper;
import com.example.architecturemodel.model.dto.entity.LibraryDto;
import com.example.architecturemodel.model.entity.ApplicationEntity;
import com.example.architecturemodel.model.entity.ApplicationPointEntity;
import com.example.architecturemodel.model.entity.LibraryEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.entity.ApplicationPointRepository;
import com.example.architecturemodel.repository.entity.ApplicationRepository;
import com.example.architecturemodel.repository.entity.LibraryRepository;
import com.example.architecturemodel.service.LibraryService;
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
 * Integration tests for {@link LibraryController}'s 2 new find-or-create + scoped
 * find-by-id endpoints (Spec: 2026-05-06-library-discovery-integration --
 * Task Group 1).
 *
 * <p>Uses the standalone MockMvc pattern (no full Spring context) so the test
 * class is self-contained and isolated from the ~117 pre-existing broken
 * backend Java test files documented in project memory. The
 * {@link LibraryService} is wired against mocked repositories + a real
 * {@link EntityMapper} so the snake_case JSON contract (via
 * {@code @JsonProperty} annotations on {@link LibraryDto} and the response
 * record) is exercised end-to-end through MockMvc.</p>
 *
 * <p>Tests covered (per tasks.md 1.1):</p>
 * <ol>
 *   <li>Find branch -- second POST with same {@code (name, ecosystem)}
 *       returns existing row with {@code is_new=false} and same id.</li>
 *   <li>Create branch + derived AP -- first POST with new
 *       {@code (name, ecosystem)} returns {@code is_new=true} AND inserts a
 *       derived ApplicationPoint with {@code target_type='LIBRARY'},
 *       {@code target_ref_id=<new library id>}, {@code kind='LIBRARY'} in the
 *       same transaction.</li>
 *   <li>GET /libraries/{id} happy path returns 200 with the library DTO.</li>
 *   <li>GET /libraries/{id} returns 404 for an unknown id.</li>
 * </ol>
 *
 * <p>Fix #4 (FK violation on application_points.application_id):
 * the create branch now resolves application_id from the first
 * {@link ApplicationEntity} of the model file (sentinel pattern). Tests for
 * the create-branch insert mock {@link ApplicationRepository#findByModelFileId}
 * to return a pre-seeded Application row.</p>
 */
@ExtendWith(MockitoExtension.class)
class LibraryControllerIntegrationTest {

    @Mock
    private ModelFileRepository modelFileRepository;
    @Mock
    private LibraryRepository libraryRepository;
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
        LibraryService service = new LibraryService(
            modelFileRepository, libraryRepository, applicationPointRepository,
            applicationRepository, realMapper);
        LibraryController controller = new LibraryController(service);

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

    private LibraryDto buildPayload(String name, String ecosystem) {
        return new LibraryDto(
            null,         // id (server-allocated)
            name,
            null, null, null, null,
            ecosystem,
            null, null, null,
            null, null, null, null, null,
            "DISCOVERED", "discovery-service", "run-1",
            "completed", null, null,
            null);
    }

    // ------------------------------------------------------------------------
    // Test 1: Find branch -- second POST with same (name, ecosystem) returns
    // the existing row with is_new=false.
    // ------------------------------------------------------------------------
    @Test
    @DisplayName("POST /libraries: find branch returns existing row with is_new=false")
    void postLibraries_findBranch_returnsExistingRow() throws Exception {
        when(modelFileRepository.findByProjectIdAndArchitectureId(PROJECT_ID, ARCH_ID))
            .thenReturn(Optional.of(modelFile()));

        LibraryEntity existing = LibraryEntity.builder()
            .id("lib-existing-1")
            .modelFileId(MODEL_FILE_ID)
            .name("com.example:foo-lib")
            .ecosystem("MAVEN")
            .build();
        when(libraryRepository.findByModelFileIdAndNameAndEcosystem(
                MODEL_FILE_ID, "com.example:foo-lib", "MAVEN"))
            .thenReturn(Optional.of(existing));
        // last_verified_at touch path -- save returns the same row.
        when(libraryRepository.save(any(LibraryEntity.class))).thenAnswer(inv -> inv.getArgument(0));

        // Existing derived AP for this library so the response carries it.
        ApplicationPointEntity derivedAp = ApplicationPointEntity.builder()
            .id("ap-existing-derived-1")
            .modelFileId(MODEL_FILE_ID)
            .name("com.example:foo-lib")
            .kind("LIBRARY")
            .applicationId(SENTINEL_APP_ID)
            .targetType("LIBRARY")
            .targetRefId("lib-existing-1")
            .build();
        when(applicationPointRepository.findByModelFileId(MODEL_FILE_ID))
            .thenReturn(List.of(derivedAp));

        LibraryDto request = buildPayload("com.example:foo-lib", "MAVEN");

        mockMvc.perform(post("/api/model/projects/{p}/architectures/{a}/libraries",
                PROJECT_ID, ARCH_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value("lib-existing-1"))
            .andExpect(jsonPath("$.is_new").value(false))
            .andExpect(jsonPath("$.derived_application_point_id").value("ap-existing-derived-1"))
            .andExpect(jsonPath("$.library.name").value("com.example:foo-lib"))
            .andExpect(jsonPath("$.library.ecosystem").value("MAVEN"));

        // last_verified_at was touched (save called on the find branch).
        ArgumentCaptor<LibraryEntity> savedCaptor = ArgumentCaptor.forClass(LibraryEntity.class);
        verify(libraryRepository).save(savedCaptor.capture());
        assertThat(savedCaptor.getValue().getLastVerifiedAt()).isNotBlank();

        // Crucially: NO new AP was inserted on the find branch.
        verify(applicationPointRepository, never()).save(any(ApplicationPointEntity.class));
    }

    // ------------------------------------------------------------------------
    // Test 2: Create branch -- first POST with new (name, ecosystem) returns
    // is_new=true AND inserts derived ApplicationPoint with target_type=LIBRARY
    // in the same transaction.
    //
    // Fix #4: application_id is now resolved from the first Application of
    // the model file (sentinel pattern), satisfying the FK constraint on
    // application_points.application_id.
    // ------------------------------------------------------------------------
    @Test
    @DisplayName("POST /libraries: create branch inserts library + derived AP (target_type='LIBRARY')")
    void postLibraries_createBranch_insertsLibraryAndDerivedApplicationPoint() throws Exception {
        when(modelFileRepository.findByProjectIdAndArchitectureId(PROJECT_ID, ARCH_ID))
            .thenReturn(Optional.of(modelFile()));
        when(libraryRepository.findByModelFileIdAndNameAndEcosystem(
                MODEL_FILE_ID, "lodash", "NPM"))
            .thenReturn(Optional.empty());
        when(libraryRepository.save(any(LibraryEntity.class))).thenAnswer(inv -> inv.getArgument(0));
        when(applicationPointRepository.save(any(ApplicationPointEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));
        // Fix #4: a sentinel Application row exists for the model file so
        // the create branch can resolve a non-null application_id.
        when(applicationRepository.findByModelFileId(MODEL_FILE_ID))
            .thenReturn(List.of(sentinelApplication()));

        LibraryDto request = buildPayload("lodash", "NPM");

        mockMvc.perform(post("/api/model/projects/{p}/architectures/{a}/libraries",
                PROJECT_ID, ARCH_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.is_new").value(true))
            .andExpect(jsonPath("$.id").isNotEmpty())
            .andExpect(jsonPath("$.derived_application_point_id").isNotEmpty())
            .andExpect(jsonPath("$.library.name").value("lodash"))
            .andExpect(jsonPath("$.library.ecosystem").value("NPM"))
            .andExpect(jsonPath("$.library.source_origin").value("DISCOVERED"));

        // Library inserted with last_verified_at stamped + non-null id.
        ArgumentCaptor<LibraryEntity> libCaptor = ArgumentCaptor.forClass(LibraryEntity.class);
        verify(libraryRepository).save(libCaptor.capture());
        LibraryEntity savedLib = libCaptor.getValue();
        assertThat(savedLib.getId()).isNotBlank();
        assertThat(savedLib.getModelFileId()).isEqualTo(MODEL_FILE_ID);
        assertThat(savedLib.getName()).isEqualTo("lodash");
        assertThat(savedLib.getEcosystem()).isEqualTo("NPM");
        assertThat(savedLib.getLastVerifiedAt()).isNotBlank();

        // Derived AP inserted in same transaction with the locked-contract
        // shape: target_type='LIBRARY', target_ref_id=<new library id>,
        // kind='LIBRARY'. application_id references the sentinel Application
        // (Fix #4) -- not the Library's own id (which would violate the FK).
        ArgumentCaptor<ApplicationPointEntity> apCaptor =
            ArgumentCaptor.forClass(ApplicationPointEntity.class);
        verify(applicationPointRepository).save(apCaptor.capture());
        ApplicationPointEntity savedAp = apCaptor.getValue();
        assertThat(savedAp.getTargetType()).isEqualTo("LIBRARY");
        assertThat(savedAp.getTargetRefId()).isEqualTo(savedLib.getId());
        assertThat(savedAp.getKind()).isEqualTo("LIBRARY");
        assertThat(savedAp.getModelFileId()).isEqualTo(MODEL_FILE_ID);
        assertThat(savedAp.getApplicationId()).isEqualTo(SENTINEL_APP_ID);
    }

    // ------------------------------------------------------------------------
    // Test 2b (Fix #4): Create branch with NO Application in model file
    // surfaces an IllegalStateException with a clear message rather than
    // silently violating the FK constraint at the DB layer.
    // ------------------------------------------------------------------------
    @Test
    @DisplayName("POST /libraries: create branch fails fast if model file has no Applications")
    void postLibraries_createBranch_noApplications_throws() throws Exception {
        when(modelFileRepository.findByProjectIdAndArchitectureId(PROJECT_ID, ARCH_ID))
            .thenReturn(Optional.of(modelFile()));
        when(libraryRepository.findByModelFileIdAndNameAndEcosystem(
                MODEL_FILE_ID, "lodash", "NPM"))
            .thenReturn(Optional.empty());
        when(libraryRepository.save(any(LibraryEntity.class))).thenAnswer(inv -> inv.getArgument(0));
        // No Application rows for the model file -- the sentinel resolution
        // step throws.
        when(applicationRepository.findByModelFileId(MODEL_FILE_ID))
            .thenReturn(List.of());

        LibraryDto request = buildPayload("lodash", "NPM");

        mockMvc.perform(post("/api/model/projects/{p}/architectures/{a}/libraries",
                PROJECT_ID, ARCH_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().is5xxServerError());

        // No AP was inserted -- the failure happened before the AP save.
        verify(applicationPointRepository, never()).save(any(ApplicationPointEntity.class));
    }

    // ------------------------------------------------------------------------
    // Test 3: GET /libraries/{id} happy path returns 200 + library DTO.
    // ------------------------------------------------------------------------
    @Test
    @DisplayName("GET /libraries/{id}: returns 200 with library DTO when scoping matches")
    void getLibrary_validId_returns200WithDto() throws Exception {
        when(modelFileRepository.findByProjectIdAndArchitectureId(PROJECT_ID, ARCH_ID))
            .thenReturn(Optional.of(modelFile()));

        LibraryEntity row = LibraryEntity.builder()
            .id("lib-known-1")
            .modelFileId(MODEL_FILE_ID)
            .name("com.example:foo-lib")
            .ecosystem("MAVEN")
            .repoLocation("https://repo.example.com/foo")
            .repoSubfolder("modules/foo-lib")
            .build();
        when(libraryRepository.findById("lib-known-1")).thenReturn(Optional.of(row));

        mockMvc.perform(get("/api/model/projects/{p}/architectures/{a}/libraries/{id}",
                PROJECT_ID, ARCH_ID, "lib-known-1"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value("lib-known-1"))
            .andExpect(jsonPath("$.name").value("com.example:foo-lib"))
            .andExpect(jsonPath("$.ecosystem").value("MAVEN"))
            .andExpect(jsonPath("$.repo_location").value("https://repo.example.com/foo"))
            .andExpect(jsonPath("$.repo_subfolder").value("modules/foo-lib"));
    }

    // ------------------------------------------------------------------------
    // Test 4: GET /libraries/{id} returns 404 for an unknown id.
    // ------------------------------------------------------------------------
    @Test
    @DisplayName("GET /libraries/{id}: returns 404 for an unknown id")
    void getLibrary_unknownId_returns404() throws Exception {
        when(modelFileRepository.findByProjectIdAndArchitectureId(PROJECT_ID, ARCH_ID))
            .thenReturn(Optional.of(modelFile()));
        when(libraryRepository.findById("lib-missing")).thenReturn(Optional.empty());

        mockMvc.perform(get("/api/model/projects/{p}/architectures/{a}/libraries/{id}",
                PROJECT_ID, ARCH_ID, "lib-missing"))
            .andExpect(status().isNotFound());
    }

    // ------------------------------------------------------------------------
    // Test 5 (bonus): GET /libraries/{id} returns 404 when the library exists
    // but belongs to a different model file (scoping mismatch).
    // ------------------------------------------------------------------------
    @Test
    @DisplayName("GET /libraries/{id}: returns 404 when scoping mismatches (different model_file_id)")
    void getLibrary_scopingMismatch_returns404() throws Exception {
        when(modelFileRepository.findByProjectIdAndArchitectureId(PROJECT_ID, ARCH_ID))
            .thenReturn(Optional.of(modelFile()));

        LibraryEntity rowInOtherModelFile = LibraryEntity.builder()
            .id("lib-other-1")
            .modelFileId("mf-some-other")
            .name("other-lib")
            .ecosystem("MAVEN")
            .build();
        when(libraryRepository.findById("lib-other-1"))
            .thenReturn(Optional.of(rowInOtherModelFile));

        mockMvc.perform(get("/api/model/projects/{p}/architectures/{a}/libraries/{id}",
                PROJECT_ID, ARCH_ID, "lib-other-1"))
            .andExpect(status().isNotFound());
    }
}
