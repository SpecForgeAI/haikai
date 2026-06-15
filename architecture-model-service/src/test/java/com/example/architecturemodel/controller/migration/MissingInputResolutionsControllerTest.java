package com.example.architecturemodel.controller.migration;

import com.example.architecturemodel.exception.ConflictException;
import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.model.dto.migration.MissingInputResolutionCreateRequest;
import com.example.architecturemodel.model.dto.migration.MissingInputResolutionDto;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationEntity;
import com.example.architecturemodel.service.migration.MissingInputCrossStoryMatcherService;
import com.example.architecturemodel.service.migration.MissingInputResolutionBulkService;
import com.example.architecturemodel.service.migration.MissingInputResolutionBulkService.BulkResolveItem;
import com.example.architecturemodel.service.migration.MissingInputResolutionBulkService.BulkResolvePreviewRow;
import com.example.architecturemodel.service.migration.MissingInputResolutionCascadeService;
import com.example.architecturemodel.service.migration.MissingInputResolutionCascadeService.CascadeResult;
import com.example.architecturemodel.service.migration.MissingInputResolutionService;
import com.fasterxml.jackson.databind.ObjectMapper;
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

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * MockMvc tests for {@link MissingInputResolutionsController}.
 *
 * <p>Spec: Missing Input Resolver Flow (2026-05-20) -- Task Group 4.1.</p>
 *
 * <p>Standalone setup mirrors {@code EpicCapturedDecisionsControllerTest}: no
 * full Spring context (the project has unrelated pre-existing failures
 * documented in MEMORY.md), and {@link GlobalExceptionHandler} is wired by
 * hand so error envelopes follow production mapping. Tests use the default
 * camelCase JSON mapping since {@code MockMvcBuilders.standaloneSetup} does
 * not load the application's SNAKE_CASE configuration.</p>
 *
 * <p>Six focused tests covering Task 4.1's contract for this controller:</p>
 * <ol>
 *   <li>{@link #postCreatesAndReturnsAffectedSpecIds} -- POST returns 201 with
 *       the new DTO + the affected-spec list computed via the matcher.</li>
 *   <li>{@link #postCreateReturns409OnDuplicateActiveKey} -- 409 envelope on
 *       a duplicate active key (the service raises {@link ConflictException}
 *       which the GlobalExceptionHandler maps).</li>
 *   <li>{@link #postBulkPreviewReturnsRowsWithoutPersisting} --
 *       {@code commit=false} returns the preview shape (previewOnly=true,
 *       committed=false) and never persists.</li>
 *   <li>{@link #postBulkCommitReturnsCommittedAndPersists} --
 *       {@code commit=true} returns previewOnly=false / committed=true and
 *       routes through the service in a single transaction.</li>
 *   <li>{@link #deleteSoftDeletesAndReturnsAffectedSpecIds} -- DELETE returns
 *       200 with the cascade result envelope.</li>
 *   <li>{@link #getListReturnsActiveResolutions} -- GET returns the list of
 *       active resolutions (with optional filters applied).</li>
 * </ol>
 */
@ExtendWith(MockitoExtension.class)
class MissingInputResolutionsControllerTest {

    @Mock
    private MissingInputResolutionService resolutionService;
    @Mock
    private MissingInputResolutionBulkService bulkService;
    @Mock
    private MissingInputResolutionCascadeService cascadeService;
    @Mock
    private MissingInputCrossStoryMatcherService matcherService;

    private MockMvc mockMvc;
    private ObjectMapper objectMapper;

    private static final UUID PROJECT_ID =
        UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID RESOLUTION_ID =
        UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID SPEC_A =
        UUID.fromString("33333333-3333-3333-3333-333333333333");
    private static final UUID SPEC_B =
        UUID.fromString("44444444-4444-4444-4444-444444444444");

    private static final String KEY_ALPHA = "1234567890abcdef";
    private static final Instant NOW = Instant.parse("2026-05-20T10:00:00Z");

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders
            .standaloneSetup(new MissingInputResolutionsController(
                resolutionService, bulkService, cascadeService, matcherService))
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();
        objectMapper = new ObjectMapper();
    }

    private MissingInputResolutionDto dto(String key, String type, Boolean softDeleted) {
        return new MissingInputResolutionDto(
            RESOLUTION_ID, PROJECT_ID, key, type,
            Map.of("contractBlobId", "blob-1"),
            NOW, "alice",
            softDeleted,
            softDeleted == Boolean.TRUE ? NOW : null,
            softDeleted == Boolean.TRUE ? "alice" : null,
            NOW, NOW);
    }

    // -----------------------------------------------------------------------
    // 1) POST creates + returns affectedSpecIds
    // -----------------------------------------------------------------------
    @Test
    @DisplayName("POST returns 201 with the new resolution DTO + affectedSpecIds from the matcher")
    void postCreatesAndReturnsAffectedSpecIds() throws Exception {
        MissingInputResolutionDto created = dto(KEY_ALPHA, "api_contract", Boolean.FALSE);
        when(resolutionService.create(eq(PROJECT_ID), any(MissingInputResolutionCreateRequest.class)))
            .thenReturn(created);

        MigrationStorySpecGenerationEntity specA = new MigrationStorySpecGenerationEntity();
        specA.setId(SPEC_A);
        MigrationStorySpecGenerationEntity specB = new MigrationStorySpecGenerationEntity();
        specB.setId(SPEC_B);
        when(matcherService.findAffectedSpecs(PROJECT_ID, KEY_ALPHA))
            .thenReturn(List.of(specA, specB));

        String body = objectMapper.writeValueAsString(Map.of(
            "missingInputType", "api_contract",
            "serviceName", "PaymentsService",
            "operationName", "createPayment",
            "resolutionPayload", Map.of("contractBlobId", "blob-1"),
            "resolvedBy", "alice"));

        mockMvc.perform(post(
                "/api/projects/{p}/missing-input-resolutions", PROJECT_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.resolution.id").value(RESOLUTION_ID.toString()))
            .andExpect(jsonPath("$.resolution.missingInputKey").value(KEY_ALPHA))
            .andExpect(jsonPath("$.resolution.missingInputType").value("api_contract"))
            .andExpect(jsonPath("$.resolution.softDeleted").value(false))
            .andExpect(jsonPath("$.affectedSpecIds.length()").value(2))
            .andExpect(jsonPath("$.affectedSpecIds[0]").value(SPEC_A.toString()))
            .andExpect(jsonPath("$.affectedSpecIds[1]").value(SPEC_B.toString()));

        ArgumentCaptor<MissingInputResolutionCreateRequest> captor =
            ArgumentCaptor.forClass(MissingInputResolutionCreateRequest.class);
        verify(resolutionService).create(eq(PROJECT_ID), captor.capture());
        MissingInputResolutionCreateRequest sent = captor.getValue();
        assertThat(sent.missingInputType()).isEqualTo("api_contract");
        assertThat(sent.serviceName()).isEqualTo("PaymentsService");
        assertThat(sent.operationName()).isEqualTo("createPayment");
        assertThat(sent.resolvedBy()).isEqualTo("alice");
        verify(matcherService).findAffectedSpecs(PROJECT_ID, KEY_ALPHA);
    }

    // -----------------------------------------------------------------------
    // 2) POST returns 409 on duplicate active key
    // -----------------------------------------------------------------------
    @Test
    @DisplayName("POST returns 409 envelope when the service raises ConflictException on duplicate active key")
    void postCreateReturns409OnDuplicateActiveKey() throws Exception {
        when(resolutionService.create(eq(PROJECT_ID), any(MissingInputResolutionCreateRequest.class)))
            .thenThrow(new ConflictException(
                "An active missing-input resolution already exists for project "
                    + "11111111 and key " + KEY_ALPHA));

        String body = objectMapper.writeValueAsString(Map.of(
            "missingInputType", "mapping",
            "sourceElementId", "src-1",
            "targetElementId", "tgt-1",
            "resolvedBy", "alice"));

        mockMvc.perform(post(
                "/api/projects/{p}/missing-input-resolutions", PROJECT_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.status").value(409))
            .andExpect(jsonPath("$.error").value("Conflict"))
            .andExpect(jsonPath("$.message")
                .value(org.hamcrest.Matchers.containsString("already exists")));

        // Matcher must NOT be invoked on conflict: the controller short-
        // circuits once the service throws.
        verify(matcherService, never())
            .findAffectedSpecs(any(UUID.class), any(String.class));
    }

    // -----------------------------------------------------------------------
    // 3) POST /bulk preview returns rows without persisting
    // -----------------------------------------------------------------------
    @Test
    @DisplayName("POST /bulk with commit=false returns previewOnly=true rows; service receives commit=false")
    void postBulkPreviewReturnsRowsWithoutPersisting() throws Exception {
        BulkResolvePreviewRow row = new BulkResolvePreviewRow(
            KEY_ALPHA, "api_contract",
            "PaymentsService::createPayment",
            List.of(SPEC_A, SPEC_B),
            Map.of("contractBlobId", "blob-1"));
        when(bulkService.bulkResolve(eq(PROJECT_ID), any(), eq(Boolean.FALSE), any()))
            .thenReturn(new MissingInputResolutionBulkService.BulkResolveResponse(
                List.of(row), Boolean.TRUE));

        String body = objectMapper.writeValueAsString(Map.of(
            "items", List.of(Map.of(
                "type", "api_contract",
                "serviceName", "PaymentsService",
                "operationName", "createPayment",
                "payload", Map.of("contractBlobId", "blob-1"))),
            "commit", false));

        mockMvc.perform(post(
                "/api/projects/{p}/missing-input-resolutions/bulk", PROJECT_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.previewOnly").value(true))
            .andExpect(jsonPath("$.committed").value(false))
            .andExpect(jsonPath("$.totalSpecsAffected").value(2))
            .andExpect(jsonPath("$.resolutions.length()").value(1))
            .andExpect(jsonPath("$.resolutions[0].key").value(KEY_ALPHA))
            .andExpect(jsonPath("$.resolutions[0].descriptor")
                .value("PaymentsService::createPayment"))
            .andExpect(jsonPath("$.resolutions[0].affectedSpecIds.length()").value(2));

        // Verify the controller forwarded commit=false (preview-only contract).
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<BulkResolveItem>> itemCaptor =
            ArgumentCaptor.forClass(List.class);
        verify(bulkService).bulkResolve(
            eq(PROJECT_ID), itemCaptor.capture(), eq(Boolean.FALSE), any());
        List<BulkResolveItem> sentItems = itemCaptor.getValue();
        assertThat(sentItems).hasSize(1);
        assertThat(sentItems.get(0).type()).isEqualTo("api_contract");
        assertThat(sentItems.get(0).serviceName()).isEqualTo("PaymentsService");
    }

    // -----------------------------------------------------------------------
    // 4) POST /bulk commit returns committed=true and persists
    // -----------------------------------------------------------------------
    @Test
    @DisplayName("POST /bulk with commit=true returns committed=true; service receives commit=true + resolvedBy")
    void postBulkCommitReturnsCommittedAndPersists() throws Exception {
        BulkResolvePreviewRow row = new BulkResolvePreviewRow(
            KEY_ALPHA, "api_contract",
            "PaymentsService::createPayment",
            List.of(SPEC_A),
            Map.of("contractBlobId", "blob-1"));
        when(bulkService.bulkResolve(eq(PROJECT_ID), any(), eq(Boolean.TRUE), eq("alice")))
            .thenReturn(new MissingInputResolutionBulkService.BulkResolveResponse(
                List.of(row), Boolean.FALSE));

        String body = objectMapper.writeValueAsString(Map.of(
            "items", List.of(Map.of(
                "type", "api_contract",
                "serviceName", "PaymentsService",
                "operationName", "createPayment")),
            "commit", true,
            "resolvedBy", "alice"));

        mockMvc.perform(post(
                "/api/projects/{p}/missing-input-resolutions/bulk", PROJECT_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.previewOnly").value(false))
            .andExpect(jsonPath("$.committed").value(true))
            .andExpect(jsonPath("$.totalSpecsAffected").value(1))
            .andExpect(jsonPath("$.resolutions.length()").value(1))
            .andExpect(jsonPath("$.resolutions[0].key").value(KEY_ALPHA));

        verify(bulkService).bulkResolve(
            eq(PROJECT_ID), any(), eq(Boolean.TRUE), eq("alice"));
    }

    // -----------------------------------------------------------------------
    // 5) DELETE soft-deletes + returns affectedSpecIds
    // -----------------------------------------------------------------------
    @Test
    @DisplayName("DELETE returns 200 with the cascade result envelope (deletedResolution + affectedSpecIds)")
    void deleteSoftDeletesAndReturnsAffectedSpecIds() throws Exception {
        MissingInputResolutionDto softDeleted = dto(KEY_ALPHA, "api_contract", Boolean.TRUE);
        CascadeResult cascade = new CascadeResult(softDeleted, 2, List.of(SPEC_A, SPEC_B));
        when(cascadeService.softDeleteWithCascade(
                eq(PROJECT_ID), eq(RESOLUTION_ID), eq("alice")))
            .thenReturn(cascade);

        mockMvc.perform(delete(
                "/api/projects/{p}/missing-input-resolutions/{rid}",
                PROJECT_ID, RESOLUTION_ID)
                .param("deletedBy", "alice"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.deletedResolution.id")
                .value(RESOLUTION_ID.toString()))
            .andExpect(jsonPath("$.deletedResolution.softDeleted").value(true))
            .andExpect(jsonPath("$.deletedResolution.softDeletedBy").value("alice"))
            .andExpect(jsonPath("$.affectedSpecCount").value(2))
            .andExpect(jsonPath("$.affectedSpecIds.length()").value(2))
            .andExpect(jsonPath("$.affectedSpecIds[0]").value(SPEC_A.toString()))
            .andExpect(jsonPath("$.affectedSpecIds[1]").value(SPEC_B.toString()));

        verify(cascadeService).softDeleteWithCascade(
            eq(PROJECT_ID), eq(RESOLUTION_ID), eq("alice"));
    }

    // -----------------------------------------------------------------------
    // 6) GET list returns active rows
    // -----------------------------------------------------------------------
    @Test
    @DisplayName("GET returns the active resolutions; ?type= filter is applied in the controller")
    void getListReturnsActiveResolutions() throws Exception {
        MissingInputResolutionDto a = dto(KEY_ALPHA, "api_contract", Boolean.FALSE);
        MissingInputResolutionDto b = new MissingInputResolutionDto(
            UUID.randomUUID(), PROJECT_ID, "fedcba0987654321", "mapping",
            Map.of("sourceElementId", "s1", "targetElementId", "t1"),
            NOW, "bob", Boolean.FALSE, null, null, NOW, NOW);
        when(resolutionService.list(eq(PROJECT_ID))).thenReturn(List.of(a, b));

        // No filter -- expect both.
        mockMvc.perform(get(
                "/api/projects/{p}/missing-input-resolutions", PROJECT_ID))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(2))
            .andExpect(jsonPath("$[0].missingInputType").value("api_contract"))
            .andExpect(jsonPath("$[1].missingInputType").value("mapping"));

        // ?type=mapping -- only the mapping row.
        mockMvc.perform(get(
                "/api/projects/{p}/missing-input-resolutions", PROJECT_ID)
                .param("type", "mapping"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$[0].missingInputType").value("mapping"));

        verify(resolutionService, org.mockito.Mockito.times(2)).list(PROJECT_ID);
    }
}
