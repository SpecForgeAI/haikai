package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.*;
import com.example.architecturemodel.model.dto.diagram.*;
import com.example.architecturemodel.model.dto.entity.*;
import com.example.architecturemodel.model.dto.relationship.*;
import com.example.architecturemodel.service.DiagramExportService;
import com.example.architecturemodel.service.ModelService;
import com.example.architecturemodel.testsupport.TestMetaModelFactory;
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

import java.time.OffsetDateTime;
import java.util.Collections;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@ExtendWith(MockitoExtension.class)
class ModelControllerTest {

    @Mock
    private ModelService modelService;

    @Mock
    private DiagramExportService diagramExportService;

    private MockMvc mockMvc;
    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        ModelController controller = new ModelController(modelService, diagramExportService);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();

        objectMapper = new ObjectMapper();
        objectMapper.setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
        objectMapper.registerModule(new JavaTimeModule());
    }

    @Test
    void getModelFilenames_returnsOk() throws Exception {
        ModelFileSummaryDto summary = new ModelFileSummaryDto(
            "mf-1", "test-model", "Description",
            OffsetDateTime.now(), OffsetDateTime.now(), false, "tags"
        );
        when(modelService.getModelFilenames()).thenReturn(List.of(summary));

        mockMvc.perform(get("/api/model/filenames"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].filename").value("test-model"));
    }

    @Test
    void loadModel_withFilename_returnsOk() throws Exception {
        ArchitectureModelDto model = createEmptyModel();
        when(modelService.loadModel("test-model")).thenReturn(model);

        mockMvc.perform(get("/api/model").param("filename", "test-model"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.metaModel").exists())
            .andExpect(jsonPath("$.diagrams").isArray());
    }

    @Test
    void loadModel_notFound_returns404() throws Exception {
        when(modelService.loadModel("nonexistent"))
            .thenThrow(new ResourceNotFoundException("Model file not found: nonexistent"));

        mockMvc.perform(get("/api/model").param("filename", "nonexistent"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.message").value("Model file not found: nonexistent"));
    }

    @Test
    void saveModel_validModel_returnsOk() throws Exception {
        ModelFileSummaryDto summary = new ModelFileSummaryDto(
            "mf-1", "test-model", null,
            OffsetDateTime.now(), OffsetDateTime.now(), false, null
        );
        when(modelService.saveModel(eq("test-model"), any(ArchitectureModelDto.class)))
            .thenReturn(summary);

        ArchitectureModelDto model = createEmptyModel();
        String json = objectMapper.writeValueAsString(model);

        mockMvc.perform(put("/api/model")
                .param("filename", "test-model")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.filename").value("test-model"));
    }

    @Test
    void saveModel_missingFilename_returns400() throws Exception {
        ArchitectureModelDto model = createEmptyModel();
        String json = objectMapper.writeValueAsString(model);

        mockMvc.perform(put("/api/model")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json))
            .andExpect(status().isBadRequest());
    }

    @Test
    void saveModel_blankFilename_returns400() throws Exception {
        ArchitectureModelDto model = createEmptyModel();
        String json = objectMapper.writeValueAsString(model);

        mockMvc.perform(put("/api/model")
                .param("filename", "")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json))
            .andExpect(status().isBadRequest());
    }

    @Test
    void deleteModel_existingFile_returns204() throws Exception {
        doNothing().when(modelService).deleteModel("test-model");

        mockMvc.perform(delete("/api/model").param("filename", "test-model"))
            .andExpect(status().isNoContent());
    }

    @Test
    void deleteModel_notFound_returns404() throws Exception {
        doThrow(new ResourceNotFoundException("Model file not found: nonexistent"))
            .when(modelService).deleteModel("nonexistent");

        mockMvc.perform(delete("/api/model").param("filename", "nonexistent"))
            .andExpect(status().isNotFound());
    }

    private ArchitectureModelDto createEmptyModel() {
        MetaModelDto metaModel = new MetaModelDto(
            TestMetaModelFactory.emptyEntities(),
            TestMetaModelFactory.emptyRelationships()
        );
        return new ArchitectureModelDto(metaModel, Collections.emptyList());
    }
}
