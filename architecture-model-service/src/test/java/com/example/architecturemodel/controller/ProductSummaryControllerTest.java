package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.ProductSummaryDto;
import com.example.architecturemodel.model.dto.ProductSummaryDto.InitiativeSummary;
import com.example.architecturemodel.model.dto.ProductSummaryDto.EpicSummary;
import com.example.architecturemodel.model.dto.ProductSummaryDto.FeatureSummary;
import com.example.architecturemodel.service.ProductSummaryService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Unit tests for ProductSummaryController.
 *
 * Spec: Implement Assistant Stage 3 - Bootstrap Phase
 * Task 1.1: Tests for product summary endpoint
 */
@WebMvcTest(ProductSummaryController.class)
class ProductSummaryControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private ProductSummaryService productSummaryService;

    private static final UUID PROJECT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final String BASE_URL = "/api/projects/{projectId}/product-summary";

    @Test
    void getProductSummary_validProject_returns200WithHierarchicalStructure() throws Exception {
        // Arrange
        FeatureSummary feature1 = new FeatureSummary("feat-1", "User Login", "Enable user authentication");
        FeatureSummary feature2 = new FeatureSummary("feat-2", "User Registration", "Allow new users to sign up");
        EpicSummary epic1 = new EpicSummary("epic-1", "Authentication", "User authentication system", List.of(feature1, feature2));
        InitiativeSummary initiative1 = new InitiativeSummary("init-1", "User Management", "Comprehensive user management", List.of(epic1));

        ProductSummaryDto response = new ProductSummaryDto(List.of(initiative1));

        when(productSummaryService.getProductSummary(eq(PROJECT_ID))).thenReturn(response);

        // Act & Assert
        mockMvc.perform(get(BASE_URL, PROJECT_ID))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.initiatives").isArray())
            .andExpect(jsonPath("$.initiatives[0].id").value("init-1"))
            .andExpect(jsonPath("$.initiatives[0].title").value("User Management"))
            .andExpect(jsonPath("$.initiatives[0].description").value("Comprehensive user management"))
            .andExpect(jsonPath("$.initiatives[0].epics").isArray())
            .andExpect(jsonPath("$.initiatives[0].epics[0].id").value("epic-1"))
            .andExpect(jsonPath("$.initiatives[0].epics[0].title").value("Authentication"))
            .andExpect(jsonPath("$.initiatives[0].epics[0].features").isArray())
            .andExpect(jsonPath("$.initiatives[0].epics[0].features[0].id").value("feat-1"))
            .andExpect(jsonPath("$.initiatives[0].epics[0].features[0].title").value("User Login"));
    }

    @Test
    void getProductSummary_emptyProject_returnsEmptyInitiatives() throws Exception {
        // Arrange
        ProductSummaryDto response = new ProductSummaryDto(List.of());

        when(productSummaryService.getProductSummary(eq(PROJECT_ID))).thenReturn(response);

        // Act & Assert
        mockMvc.perform(get(BASE_URL, PROJECT_ID))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.initiatives").isArray())
            .andExpect(jsonPath("$.initiatives").isEmpty());
    }

    @Test
    void getProductSummary_nonExistentProject_returns404() throws Exception {
        // Arrange
                UUID unknownProjectId = UUID.fromString("22222222-2222-2222-2222-222222222222");
        when(productSummaryService.getProductSummary(eq(unknownProjectId)))
            .thenThrow(new ResourceNotFoundException("Project not found: " + unknownProjectId));

        // Act & Assert
        mockMvc.perform(get(BASE_URL, unknownProjectId.toString()))
            .andExpect(status().isNotFound());
    }

    @Test
    void getProductSummary_blankProjectId_returns400() throws Exception {
        // Act & Assert
        mockMvc.perform(get("/api/projects/{projectId}/product-summary", "   "))
            .andExpect(status().isBadRequest());
    }

    @Test
    void getProductSummary_malformedProjectId_returns400() throws Exception {
        // A non-UUID path segment triggers MethodArgumentTypeMismatchException,
        // which must map to 400 Bad Request, not fall through to the 500 catch-all.
        mockMvc.perform(get("/api/projects/{projectId}/product-summary", "not-a-uuid"))
            .andExpect(status().isBadRequest());
    }

    @Test
    void getProductSummary_excludesStoriesAndDetailedSpecs() throws Exception {
        // Arrange - response should only contain Initiative, Epic, Feature (no Story level)
        FeatureSummary feature = new FeatureSummary("feat-1", "Dashboard", "Main dashboard view");
        EpicSummary epic = new EpicSummary("epic-1", "UI", "User interface", List.of(feature));
        InitiativeSummary initiative = new InitiativeSummary("init-1", "Frontend", "Frontend development", List.of(epic));

        ProductSummaryDto response = new ProductSummaryDto(List.of(initiative));

        when(productSummaryService.getProductSummary(eq(PROJECT_ID))).thenReturn(response);

        // Act & Assert - verify structure has only 3 levels (no stories)
        mockMvc.perform(get(BASE_URL, PROJECT_ID))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.initiatives[0].epics[0].features[0].title").value("Dashboard"))
            // Features should not have children (stories are excluded)
            .andExpect(jsonPath("$.initiatives[0].epics[0].features[0].stories").doesNotExist());
    }

    @Test
    void getProductSummary_responseIsConciseForLLMContext() throws Exception {
        // Arrange - verify only essential fields (id, title, description) are included
        FeatureSummary feature = new FeatureSummary("feat-1", "API Gateway", "Central API gateway");
        EpicSummary epic = new EpicSummary("epic-1", "Infrastructure", "Core infrastructure", List.of(feature));
        InitiativeSummary initiative = new InitiativeSummary("init-1", "Platform", "Platform development", List.of(epic));

        ProductSummaryDto response = new ProductSummaryDto(List.of(initiative));

        when(productSummaryService.getProductSummary(eq(PROJECT_ID))).thenReturn(response);

        // Act & Assert - verify concise structure with only id, title, description
        mockMvc.perform(get(BASE_URL, PROJECT_ID))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.initiatives[0].id").exists())
            .andExpect(jsonPath("$.initiatives[0].title").exists())
            .andExpect(jsonPath("$.initiatives[0].description").exists())
            // Should not include extra fields like status, spec, etc.
            .andExpect(jsonPath("$.initiatives[0].status").doesNotExist())
            .andExpect(jsonPath("$.initiatives[0].spec").doesNotExist());
    }
}
