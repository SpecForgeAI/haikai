package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.WorkItemDto;
import com.example.architecturemodel.model.dto.bookofwork.BookOfWorkUploadRequestDto;
import com.example.architecturemodel.model.dto.bookofwork.BookOfWorkUploadResultDto;
import com.example.architecturemodel.service.BookOfWorkUploadService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Unit tests for BookOfWorkController.
 *
 * Spec 2026-01-10: Upload Book of Work from Markdown
 * Task Group 3.1: Tests for BookOfWorkController functionality
 */
@WebMvcTest(BookOfWorkController.class)
class BookOfWorkControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private BookOfWorkUploadService bookOfWorkUploadService;

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final String UPLOAD_URL = "/api/projects/{projectId}/book-of-work/upload";

    @Test
    @DisplayName("POST endpoint returns 200 with valid markdown content")
    void testPostEndpointReturns200WithValidContent() throws Exception {
        // Given
        String markdown = "## Initiative\n### Epic\n#### Feature\n##### Story";
        BookOfWorkUploadRequestDto request = new BookOfWorkUploadRequestDto(markdown);

        WorkItemDto workItem = new WorkItemDto(
                UUID.randomUUID(), PROJECT_ID, "INITIATIVE", null,
                "Initiative", null, "PLANNED", 0, null, null, null, null, null, null,
                Instant.now(), Instant.now()
        );

        BookOfWorkUploadResultDto result = BookOfWorkUploadResultDto.of(
                PROJECT_ID, List.of(workItem), 1, 1, 1, 1
        );

        when(bookOfWorkUploadService.uploadBookOfWork(eq(PROJECT_ID), eq(markdown)))
                .thenReturn(result);

        // When/Then
        mockMvc.perform(post(UPLOAD_URL, PROJECT_ID)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.project_id").value(PROJECT_ID.toString()))
                .andExpect(jsonPath("$.work_items").isArray())
                .andExpect(jsonPath("$.import_summary.initiatives_created").value(1))
                .andExpect(jsonPath("$.import_summary.epics_created").value(1))
                .andExpect(jsonPath("$.import_summary.features_created").value(1))
                .andExpect(jsonPath("$.import_summary.stories_created").value(1));
    }

    @Test
    @DisplayName("POST endpoint returns 404 when project not found")
    void testPostEndpointReturns404WhenProjectNotFound() throws Exception {
        // Given
        String markdown = "## Initiative";
        BookOfWorkUploadRequestDto request = new BookOfWorkUploadRequestDto(markdown);

        when(bookOfWorkUploadService.uploadBookOfWork(any(UUID.class), anyString()))
                .thenThrow(new ResourceNotFoundException("Project not found: non-existent"));

        // When/Then
        mockMvc.perform(post(UPLOAD_URL, UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("POST endpoint returns 400 for empty content")
    void testPostEndpointReturns400ForEmptyContent() throws Exception {
        // Given: Request with blank content - should fail validation
        BookOfWorkUploadRequestDto request = new BookOfWorkUploadRequestDto("");

        // When/Then
        mockMvc.perform(post(UPLOAD_URL, PROJECT_ID)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("POST endpoint returns 400 for content with no valid headings")
    void testPostEndpointReturns400ForContentWithNoValidHeadings() throws Exception {
        // Given
        String invalidMarkdown = "# Only H1 heading\nNo valid content";
        BookOfWorkUploadRequestDto request = new BookOfWorkUploadRequestDto(invalidMarkdown);

        when(bookOfWorkUploadService.uploadBookOfWork(eq(PROJECT_ID), eq(invalidMarkdown)))
                .thenThrow(new IllegalArgumentException("No valid headings (H2-H5) found in the Book of Work file."));

        // When/Then
        mockMvc.perform(post(UPLOAD_URL, PROJECT_ID)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("Response contains all work items and accurate counts")
    void testResponseContainsAllWorkItemsAndAccurateCounts() throws Exception {
        // Given: 2 initiatives, 3 epics
        String markdown = "## Init1\n### Epic1\n### Epic2\n## Init2\n### Epic3";
        BookOfWorkUploadRequestDto request = new BookOfWorkUploadRequestDto(markdown);

        Instant now = Instant.now();
        List<WorkItemDto> workItems = List.of(
                new WorkItemDto(UUID.randomUUID(), PROJECT_ID, "INITIATIVE", null, "Init1", null, "PLANNED", 0, null, null, null, null, null, null, now, now),
                new WorkItemDto(UUID.randomUUID(), PROJECT_ID, "EPIC", UUID.randomUUID(), "Epic1", null, "PLANNED", 0, null, null, null, null, null, null, now, now),
                new WorkItemDto(UUID.randomUUID(), PROJECT_ID, "EPIC", UUID.randomUUID(), "Epic2", null, "PLANNED", 1, null, null, null, null, null, null, now, now),
                new WorkItemDto(UUID.randomUUID(), PROJECT_ID, "INITIATIVE", null, "Init2", null, "PLANNED", 1, null, null, null, null, null, null, now, now),
                new WorkItemDto(UUID.randomUUID(), PROJECT_ID, "EPIC", UUID.randomUUID(), "Epic3", null, "PLANNED", 0, null, null, null, null, null, null, now, now)
        );

        BookOfWorkUploadResultDto result = BookOfWorkUploadResultDto.of(
                PROJECT_ID, workItems, 2, 3, 0, 0
        );

        when(bookOfWorkUploadService.uploadBookOfWork(eq(PROJECT_ID), eq(markdown)))
                .thenReturn(result);

        // When/Then
        mockMvc.perform(post(UPLOAD_URL, PROJECT_ID)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.work_items.length()").value(5))
                .andExpect(jsonPath("$.import_summary.initiatives_created").value(2))
                .andExpect(jsonPath("$.import_summary.epics_created").value(3))
                .andExpect(jsonPath("$.import_summary.features_created").value(0))
                .andExpect(jsonPath("$.import_summary.stories_created").value(0))
                .andExpect(jsonPath("$.import_summary.total_created").value(5));
    }
}
