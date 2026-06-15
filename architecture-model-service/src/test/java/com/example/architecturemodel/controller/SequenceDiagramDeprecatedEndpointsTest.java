package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.entity.SequenceDiagramDto;
import com.example.architecturemodel.model.dto.entity.SequenceParticipantDto;
import com.example.architecturemodel.service.SequenceDiagramService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.*;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Tests for Task Group 5: Deprecate and Reimplement Sequence Diagram Endpoints.
 *
 * These tests verify:
 * 1. GET /api/sequence-diagrams/{id} reads from diagrams.typed_content_json
 * 2. PUT /api/sequence-diagrams/{id}/content writes to diagrams.typed_content_json
 * 3. Deprecated endpoints return deprecation warning headers
 * 4. Non-Sequence diagram returns appropriate error on sequence endpoint
 */
@ExtendWith(MockitoExtension.class)
class SequenceDiagramDeprecatedEndpointsTest {

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
    }

    /**
     * Test 1: GET /api/sequence-diagrams/{id} reads from diagrams.typed_content_json.
     *
     * When calling the deprecated GET endpoint, it should return the sequence diagram
     * content that was read from diagrams.typed_content_json (via the service).
     */
    @Test
    @DisplayName("Test 1: GET /api/sequence-diagrams/{id} reads from diagrams.typed_content_json")
    void testGetSequenceDiagramReadsFromTypedContentJson() throws Exception {
        String diagramId = "seq-diagram-1";

        // Create a sequence diagram DTO with content that would come from typed_content_json
        List<SequenceParticipantDto> participants = List.of(
            new SequenceParticipantDto("part-1", "Application", "app-1", 0)
        );

        SequenceDiagramDto diagramDto = new SequenceDiagramDto(
            diagramId,
            "mf-1",
            "Test Sequence",
            "Sequence",
            participants,
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList()
        );

        when(sequenceDiagramService.getSequenceDiagram(diagramId)).thenReturn(diagramDto);

        mockMvc.perform(get("/api/sequence-diagrams/{id}", diagramId))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value(diagramId))
            .andExpect(jsonPath("$.name").value("Test Sequence"))
            .andExpect(jsonPath("$.type").value("Sequence"))
            .andExpect(jsonPath("$.participants[0].id").value("part-1"))
            .andExpect(jsonPath("$.participants[0].ref_kind").value("Application"));

        verify(sequenceDiagramService).getSequenceDiagram(diagramId);
    }

    /**
     * Test 2: PUT /api/sequence-diagrams/{id}/content writes to diagrams.typed_content_json.
     *
     * When calling the deprecated PUT endpoint, it should save the content
     * to diagrams.typed_content_json (via the service) and return the updated diagram.
     */
    @Test
    @DisplayName("Test 2: PUT /api/sequence-diagrams/{id}/content writes to diagrams.typed_content_json")
    void testPutSequenceDiagramContentWritesToTypedContentJson() throws Exception {
        String diagramId = "seq-diagram-1";

        // Create the DTO to send
        List<SequenceParticipantDto> participants = List.of(
            new SequenceParticipantDto("part-1", "Application", "app-1", 0),
            new SequenceParticipantDto("part-2", "Service", "svc-1", 1)
        );

        SequenceDiagramDto inputDto = new SequenceDiagramDto(
            diagramId,
            "mf-1",
            "Test Sequence",
            "Sequence",
            participants,
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList()
        );

        // The service should return the saved diagram
        when(sequenceDiagramService.saveSequenceDiagramContent(eq(diagramId), any(SequenceDiagramDto.class)))
            .thenReturn(inputDto);

        String json = objectMapper.writeValueAsString(inputDto);

        mockMvc.perform(put("/api/sequence-diagrams/{id}/content", diagramId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(json))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value(diagramId))
            .andExpect(jsonPath("$.participants[0].id").value("part-1"))
            .andExpect(jsonPath("$.participants[1].id").value("part-2"));

        verify(sequenceDiagramService).saveSequenceDiagramContent(eq(diagramId), any(SequenceDiagramDto.class));
    }

    /**
     * Test 3: Deprecated endpoints return deprecation warning headers.
     *
     * Both GET and PUT deprecated endpoints should include the 'Deprecation: true' header.
     */
    @Test
    @DisplayName("Test 3: Deprecated endpoints return deprecation warning headers")
    void testDeprecatedEndpointsReturnDeprecationHeaders() throws Exception {
        String diagramId = "seq-diagram-1";

        // Set up for GET
        SequenceDiagramDto diagramDto = new SequenceDiagramDto(
            diagramId,
            "mf-1",
            "Test Sequence",
            "Sequence",
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList()
        );

        when(sequenceDiagramService.getSequenceDiagram(diagramId)).thenReturn(diagramDto);
        when(sequenceDiagramService.saveSequenceDiagramContent(eq(diagramId), any(SequenceDiagramDto.class)))
            .thenReturn(diagramDto);

        // Test GET endpoint has deprecation header
        mockMvc.perform(get("/api/sequence-diagrams/{id}", diagramId))
            .andExpect(status().isOk())
            .andExpect(header().string("Deprecation", "true"))
            .andExpect(header().exists("Sunset"));

        // Test PUT endpoint has deprecation header
        String json = objectMapper.writeValueAsString(diagramDto);
        mockMvc.perform(put("/api/sequence-diagrams/{id}/content", diagramId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(json))
            .andExpect(status().isOk())
            .andExpect(header().string("Deprecation", "true"))
            .andExpect(header().exists("Sunset"));
    }

    /**
     * Test 4: Non-Sequence diagram returns appropriate error on sequence endpoint.
     *
     * When trying to access a non-Sequence diagram via the sequence endpoint,
     * the service should throw an exception that results in a 400 error.
     */
    @Test
    @DisplayName("Test 4: Non-Sequence diagram returns appropriate error on sequence endpoint")
    void testNonSequenceDiagramReturnsError() throws Exception {
        String diagramId = "er-diagram-1";

        // Service throws exception for non-Sequence diagram
        when(sequenceDiagramService.getSequenceDiagram(diagramId))
            .thenThrow(new IllegalArgumentException("Diagram '" + diagramId + "' is not a Sequence diagram"));

        mockMvc.perform(get("/api/sequence-diagrams/{id}", diagramId))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.message").value("Diagram '" + diagramId + "' is not a Sequence diagram"));
    }

    /**
     * Test for 404 when diagram not found.
     */
    @Test
    @DisplayName("GET /api/sequence-diagrams/{id} returns 404 when diagram not found")
    void testGetSequenceDiagramNotFound() throws Exception {
        String diagramId = "nonexistent-id";

        when(sequenceDiagramService.getSequenceDiagram(diagramId))
            .thenThrow(new ResourceNotFoundException("Diagram not found: " + diagramId));

        mockMvc.perform(get("/api/sequence-diagrams/{id}", diagramId))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.message").value("Diagram not found: " + diagramId));
    }
}
