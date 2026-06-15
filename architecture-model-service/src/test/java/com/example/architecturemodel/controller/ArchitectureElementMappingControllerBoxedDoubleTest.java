package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.model.dto.ArchitectureElementMappingDto;
import com.example.architecturemodel.model.dto.UpdateArchitectureElementMappingRequest;
import com.example.architecturemodel.service.ArchitectureElementMappingService;
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
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Boxed-{@link Double} regression test for
 * {@link ArchitectureElementMappingController#update}.
 *
 * <p>Spec gap-fill (Task Group 8.3): the per-layer service test
 * ({@code ArchitectureElementMappingServiceTest.updateAllNullFieldsPreserveExistingValues})
 * proves that an all-null PATCH body preserves every mutable field at the
 * service layer (true PATCH semantics). THIS test guards the deserialisation
 * step BEFORE the service is reached: a JSON body that <em>omits</em>
 * {@code confidence} entirely must bind to {@code null} on the boxed
 * {@link Double} field (not silently default to {@code 0.0}).</p>
 *
 * <p>This is the documented regression in
 * {@code project_primitive_double_dto_overwrite.md}: a primitive
 * {@code double} field would deserialize a missing JSON key as {@code 0.0},
 * silently wiping the existing column to zero on PATCH. Switching the DTO
 * field to boxed {@link Double} preserves the missing-key semantic as
 * {@code null}, which the service then writes through to the entity.</p>
 *
 * <p>Spec: Create Target Baseline from Current State (2026-05-15) -- Task Group 8</p>
 */
@ExtendWith(MockitoExtension.class)
class ArchitectureElementMappingControllerBoxedDoubleTest {

    @Mock
    private ArchitectureElementMappingService service;

    private MockMvc mockMvc;

    private static final UUID PROJECT_ID =
        UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID MAPPING_ID =
        UUID.fromString("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static final String URL =
        "/api/projects/{projectId}/architecture-mappings/{mappingId}";

    @BeforeEach
    void setUp() {
        ArchitectureElementMappingController controller =
            new ArchitectureElementMappingController(service);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();
    }

    private static ArchitectureElementMappingDto fixtureDto() {
        Instant now = Instant.parse("2026-05-15T10:00:00Z");
        return new ArchitectureElementMappingDto(
            MAPPING_ID,
            PROJECT_ID,
            UUID.randomUUID(),
            UUID.randomUUID(),
            "applications",
            "src-app-1",
            "applications",
            "tgt-app-1",
            "equivalent",
            "confirmed",
            "mapping-review-modal-edit",
            now,
            now,
            null,
            null
        );
    }

    @Test
    @DisplayName(
        "PUT body that omits `confidence` binds the request DTO with confidence=null "
        + "(boxed-Double regression: primitive double would silently default to 0.0)")
    void putBodyOmittingConfidenceBindsAsNullOnBoxedDouble() throws Exception {
        when(service.update(eq(PROJECT_ID), eq(MAPPING_ID),
                any(UpdateArchitectureElementMappingRequest.class)))
            .thenReturn(fixtureDto());

        // JSON body that omits both `confidence` AND `notes` entirely. Both
        // are nullable boxed reference types on the DTO, so Jackson MUST
        // bind them to null (not 0.0 / not "" / not an empty Optional).
        // We also include `mappingType` and `status` so the controller's
        // happy path is exercised end-to-end.
        String body = "{\"mappingType\":\"equivalent\",\"status\":\"confirmed\"}";

        mockMvc.perform(put(URL, PROJECT_ID, MAPPING_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk());

        // Capture the request DTO Jackson bound from the body so we can
        // assert the omitted fields landed as null on the boxed Double /
        // String references (NOT 0.0 / not "").
        ArgumentCaptor<UpdateArchitectureElementMappingRequest> captor =
            ArgumentCaptor.forClass(UpdateArchitectureElementMappingRequest.class);
        verify(service).update(eq(PROJECT_ID), eq(MAPPING_ID), captor.capture());
        UpdateArchitectureElementMappingRequest bound = captor.getValue();

        assertThat(bound.mappingType()).isEqualTo("equivalent");
        assertThat(bound.status()).isEqualTo("confirmed");
        assertThat(bound.confidence())
            .as("Boxed Double MUST deserialize a missing JSON key as null, "
                + "NOT silently default to 0.0 (primitive-double regression)")
            .isNull();
        assertThat(bound.notes())
            .as("String reference type MUST deserialize a missing JSON key as null, "
                + "NOT empty string")
            .isNull();
    }
}
