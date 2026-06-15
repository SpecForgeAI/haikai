package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.entity.*;
import com.example.architecturemodel.service.SequenceDiagramService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.Collections;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Controller tests for SequenceDiagramController.
 * Focused tests for the PUT /api/sequence-diagrams/{id}/content endpoint.
 */
@ExtendWith(MockitoExtension.class)
class SequenceDiagramControllerTest {

    @Mock
    private SequenceDiagramService sequenceDiagramService;

    private MockMvc mockMvc;
    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        SequenceDiagramController controller = new SequenceDiagramController(sequenceDiagramService);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();

        objectMapper = new ObjectMapper();
        objectMapper.setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
        objectMapper.registerModule(new JavaTimeModule());
    }

    /**
     * Test: PUT /api/sequence-diagrams/{id}/content with valid full payload returns OK.
     */
    @Test
    void saveSequenceDiagramContent_validPayload_returnsOk() throws Exception {
        String diagramId = "sd-1";
        SequenceDiagramDto inputDto = createFullSequenceDiagramDto(diagramId);
        SequenceDiagramDto resultDto = createFullSequenceDiagramDto(diagramId);

        when(sequenceDiagramService.saveSequenceDiagramContent(eq(diagramId), any(SequenceDiagramDto.class)))
            .thenReturn(resultDto);

        String json = objectMapper.writeValueAsString(inputDto);

        mockMvc.perform(put("/api/sequence-diagrams/{id}/content", diagramId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(json))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value(diagramId))
            .andExpect(jsonPath("$.name").value("Test Sequence Diagram"))
            .andExpect(jsonPath("$.participants").isArray())
            .andExpect(jsonPath("$.participants[0].ref_kind").value("Application"))
            .andExpect(jsonPath("$.messages").isArray())
            .andExpect(jsonPath("$.sequence_nodes").isArray());

        verify(sequenceDiagramService).saveSequenceDiagramContent(eq(diagramId), any(SequenceDiagramDto.class));
    }

    /**
     * Test: PUT /api/sequence-diagrams/{id}/content returns 404 for non-existent diagram.
     */
    @Test
    void saveSequenceDiagramContent_nonExistentDiagram_returns404() throws Exception {
        String diagramId = "non-existent";
        SequenceDiagramDto inputDto = createEmptySequenceDiagramDto(diagramId);

        when(sequenceDiagramService.saveSequenceDiagramContent(eq(diagramId), any(SequenceDiagramDto.class)))
            .thenThrow(new ResourceNotFoundException("Sequence diagram not found: " + diagramId));

        String json = objectMapper.writeValueAsString(inputDto);

        mockMvc.perform(put("/api/sequence-diagrams/{id}/content", diagramId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(json))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.message").value("Sequence diagram not found: " + diagramId));
    }

    /**
     * Test: PUT /api/sequence-diagrams/{id}/content returns 400 for validation failure.
     */
    @Test
    void saveSequenceDiagramContent_validationFailure_returns400() throws Exception {
        String diagramId = "sd-1";
        SequenceDiagramDto inputDto = createSequenceDiagramDtoWithInvalidParticipant(diagramId);

        when(sequenceDiagramService.saveSequenceDiagramContent(eq(diagramId), any(SequenceDiagramDto.class)))
            .thenThrow(new IllegalArgumentException("Invalid participant ref_kind: InvalidKind"));

        String json = objectMapper.writeValueAsString(inputDto);

        mockMvc.perform(put("/api/sequence-diagrams/{id}/content", diagramId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(json))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.message").value("Invalid participant ref_kind: InvalidKind"));
    }

    /**
     * Test: PUT /api/sequence-diagrams/{id}/content returns 400 for blank ID.
     */
    @Test
    void saveSequenceDiagramContent_blankId_returns400() throws Exception {
        SequenceDiagramDto inputDto = createEmptySequenceDiagramDto("sd-1");
        String json = objectMapper.writeValueAsString(inputDto);

        mockMvc.perform(put("/api/sequence-diagrams/{id}/content", "   ")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json))
            .andExpect(status().isBadRequest());
    }

    // ============================================================================
    // Helper methods
    // ============================================================================

    private SequenceDiagramDto createFullSequenceDiagramDto(String id) {
        return new SequenceDiagramDto(
            id,
            "mf-1",
            "Test Sequence Diagram",
            "UML",
            List.of(
                new SequenceParticipantDto("p-1", "Application", "app-1", 0),
                new SequenceParticipantDto("p-2", "Service", "svc-1", 1)
            ),
            List.of(
                new SequenceMessageDto("m-1", "ex-1", "Request", "p-1", "p-2", "Method", "method-1", null, null, null, null, null, null),
                new SequenceMessageDto("m-2", "ex-1", "Response", "p-2", "p-1", null, null, "OK", null, null, null, null, null)
            ),
            Collections.emptyList(),
            Collections.emptyList(),
            List.of(
                new SequenceNodeDto("n-1", "Message", "m-1", null, 0, null, null),
                new SequenceNodeDto("n-2", "Message", "m-2", null, 1, null, null)
            )
        );
    }

    private SequenceDiagramDto createEmptySequenceDiagramDto(String id) {
        return new SequenceDiagramDto(
            id,
            "mf-1",
            "Empty Diagram",
            "UML",
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList()
        );
    }

    private SequenceDiagramDto createSequenceDiagramDtoWithInvalidParticipant(String id) {
        return new SequenceDiagramDto(
            id,
            "mf-1",
            "Diagram with Invalid Participant",
            "UML",
            List.of(new SequenceParticipantDto("p-1", "InvalidKind", "app-1", 0)),
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList()
        );
    }
}
