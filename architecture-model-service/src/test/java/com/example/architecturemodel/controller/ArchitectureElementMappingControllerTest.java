package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.DuplicateArchitectureElementMappingException;
import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.model.dto.ArchitectureElementMappingDto;
import com.example.architecturemodel.model.dto.CreateArchitectureElementMappingRequest;
import com.example.architecturemodel.model.dto.UpdateArchitectureElementMappingRequest;
import com.example.architecturemodel.service.ArchitectureElementMappingService;
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

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * MockMvc tests for {@link ArchitectureElementMappingController}.
 *
 * <p>Standalone setup mirrors {@code ArchitectureSelectiveCopyControllerTest}
 * — no full Spring context (the project has unrelated pre-existing failures
 * documented in MEMORY.md), and the global exception handler is wired by
 * hand so error envelopes go through the same mapping as in production.</p>
 *
 * <p>Covers Task Group 3.1:</p>
 * <ol>
 *   <li>{@code GET} returns the filtered list, honouring at least
 *       {@code sourceArchitectureId} + {@code targetArchitectureId}.</li>
 *   <li>{@code POST} happy path returns 201 + the created DTO.</li>
 *   <li>{@code POST} returns 422 with envelope
 *       {@code {code: "duplicate_mapping"}} on duplicate.</li>
 *   <li>{@code PUT} updates only mutable fields and returns 200 with
 *       updated DTO whose {@code created_by_task} is
 *       {@code "mapping-review-modal-edit"}.</li>
 *   <li>{@code DELETE} returns 204.</li>
 * </ol>
 *
 * <p>Spec: Create Target Baseline from Current State (2026-05-15) -- Task Group 3</p>
 */
@ExtendWith(MockitoExtension.class)
class ArchitectureElementMappingControllerTest {

    @Mock
    private ArchitectureElementMappingService service;

    private MockMvc mockMvc;
    private ObjectMapper objectMapper;

    private static final UUID PROJECT_ID =
        UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID SOURCE_ARCH =
        UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static final UUID TARGET_ARCH =
        UUID.fromString("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static final UUID MAPPING_ID =
        UUID.fromString("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static final String BASE = "/api/projects/{projectId}/architecture-mappings";

    @BeforeEach
    void setUp() {
        ArchitectureElementMappingController controller =
            new ArchitectureElementMappingController(service);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();
        objectMapper = new ObjectMapper();
    }

    private ArchitectureElementMappingDto fixtureDto(String mappingType, String status,
                                                     String createdByTask, Double confidence) {
        Instant now = Instant.parse("2026-05-15T10:00:00Z");
        return new ArchitectureElementMappingDto(
            MAPPING_ID,
            PROJECT_ID,
            SOURCE_ARCH,
            TARGET_ARCH,
            "applications",
            "src-app-1",
            "applications",
            "tgt-app-1",
            mappingType,
            status,
            createdByTask,
            now,
            now,
            "rationale",
            confidence
        );
    }

    @Test
    @DisplayName("GET returns filtered list honouring sourceArchitectureId + targetArchitectureId query params")
    void listReturnsFilteredMappings() throws Exception {
        when(service.list(eq(PROJECT_ID), eq(SOURCE_ARCH), eq(TARGET_ARCH),
                eq(null), eq(null), eq(null), eq(null), eq(null)))
            .thenReturn(List.of(fixtureDto("equivalent", "confirmed",
                "selective-copy-with-auto-map", 1.0)));

        mockMvc.perform(get(BASE, PROJECT_ID)
                .param("sourceArchitectureId", SOURCE_ARCH.toString())
                .param("targetArchitectureId", TARGET_ARCH.toString()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$[0].id").value(MAPPING_ID.toString()))
            .andExpect(jsonPath("$[0].sourceArchitectureId").value(SOURCE_ARCH.toString()))
            .andExpect(jsonPath("$[0].targetArchitectureId").value(TARGET_ARCH.toString()))
            .andExpect(jsonPath("$[0].mappingType").value("equivalent"))
            .andExpect(jsonPath("$[0].status").value("confirmed"))
            .andExpect(jsonPath("$[0].confidence").value(1.0));

        verify(service).list(PROJECT_ID, SOURCE_ARCH, TARGET_ARCH,
            null, null, null, null, null);
    }

    @Test
    @DisplayName("POST happy path returns 201 with the created DTO")
    void createHappyPathReturns201() throws Exception {
        when(service.create(eq(PROJECT_ID), any(CreateArchitectureElementMappingRequest.class)))
            .thenReturn(fixtureDto("equivalent", "confirmed",
                "mapping-review-modal-add", null));

        String body = objectMapper.writeValueAsString(Map.of(
            "sourceArchitectureId", SOURCE_ARCH.toString(),
            "targetArchitectureId", TARGET_ARCH.toString(),
            "sourceElementType", "applications",
            "sourceElementId", "src-app-1",
            "targetElementType", "applications",
            "targetElementId", "tgt-app-1",
            "mappingType", "equivalent",
            "status", "confirmed",
            "notes", "rationale"
        ));

        mockMvc.perform(post(BASE, PROJECT_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.id").value(MAPPING_ID.toString()))
            .andExpect(jsonPath("$.mappingType").value("equivalent"))
            .andExpect(jsonPath("$.status").value("confirmed"))
            .andExpect(jsonPath("$.createdByTask").value("mapping-review-modal-add"));
    }

    @Test
    @DisplayName("POST returns 422 with envelope {code: duplicate_mapping} when service throws DuplicateArchitectureElementMappingException")
    void createDuplicateReturns422() throws Exception {
        when(service.create(eq(PROJECT_ID), any(CreateArchitectureElementMappingRequest.class)))
            .thenThrow(new DuplicateArchitectureElementMappingException());

        String body = objectMapper.writeValueAsString(Map.of(
            "sourceArchitectureId", SOURCE_ARCH.toString(),
            "targetArchitectureId", TARGET_ARCH.toString(),
            "sourceElementType", "applications",
            "sourceElementId", "src-app-1",
            "targetElementType", "applications",
            "targetElementId", "tgt-app-1",
            "mappingType", "equivalent",
            "status", "confirmed"
        ));

        mockMvc.perform(post(BASE, PROJECT_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isUnprocessableEntity())
            .andExpect(jsonPath("$.code").value("duplicate_mapping"))
            .andExpect(jsonPath("$.message").value(
                DuplicateArchitectureElementMappingException.DEFAULT_MESSAGE));
    }

    @Test
    @DisplayName("PUT updates only mutable fields and returns 200 with updated DTO; created_by_task is overwritten server-side")
    void updateReturns200WithMutableFieldsAndServerSideCreatedByTask() throws Exception {
        when(service.update(eq(PROJECT_ID), eq(MAPPING_ID),
                any(UpdateArchitectureElementMappingRequest.class)))
            .thenReturn(fixtureDto("renamed", "needs_review",
                "mapping-review-modal-edit", 0.6));

        String body = objectMapper.writeValueAsString(Map.of(
            "mappingType", "renamed",
            "status", "needs_review",
            "notes", "user clarified rename rationale",
            "confidence", 0.6
        ));

        mockMvc.perform(put(BASE + "/{mappingId}", PROJECT_ID, MAPPING_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.mappingType").value("renamed"))
            .andExpect(jsonPath("$.status").value("needs_review"))
            .andExpect(jsonPath("$.confidence").value(0.6))
            .andExpect(jsonPath("$.createdByTask").value("mapping-review-modal-edit"));

        ArgumentCaptor<UpdateArchitectureElementMappingRequest> captor =
            ArgumentCaptor.forClass(UpdateArchitectureElementMappingRequest.class);
        verify(service).update(eq(PROJECT_ID), eq(MAPPING_ID), captor.capture());
        UpdateArchitectureElementMappingRequest sent = captor.getValue();
        // Only mutable fields are surfaced on the request DTO at all -- there
        // is no source/target arch or element id field on UpdateArchitectureElementMappingRequest.
        // (i.e. the service can't even receive immutable changes from this endpoint.)
        // Verify the body was bound correctly:
        // mappingType + status + notes + confidence (all four boxed types).
        org.assertj.core.api.Assertions.assertThat(sent.mappingType()).isEqualTo("renamed");
        org.assertj.core.api.Assertions.assertThat(sent.status()).isEqualTo("needs_review");
        org.assertj.core.api.Assertions.assertThat(sent.notes())
            .isEqualTo("user clarified rename rationale");
        org.assertj.core.api.Assertions.assertThat(sent.confidence()).isEqualTo(0.6);
    }

    @Test
    @DisplayName("DELETE returns 204 No Content")
    void deleteReturns204() throws Exception {
        mockMvc.perform(delete(BASE + "/{mappingId}", PROJECT_ID, MAPPING_ID))
            .andExpect(status().isNoContent());
        verify(service).delete(PROJECT_ID, MAPPING_ID);
    }
}
