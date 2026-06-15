package com.example.jiraservice.service;

import com.example.jiraservice.model.dto.jira.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.IntStream;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/**
 * Unit tests for {@link ChildExpansionService}.
 *
 * <p>Verifies that parent keys are correctly batched into groups of 50
 * for secondary JQL queries, and that child issues are aggregated
 * across all batches.</p>
 */
@ExtendWith(MockitoExtension.class)
class ChildExpansionServiceTest {

    @Mock
    private JiraSearchService jiraSearchService;

    private ChildExpansionService childExpansionService;

    @BeforeEach
    void setUp() {
        childExpansionService = new ChildExpansionService(jiraSearchService);
    }

    @Test
    @DisplayName("Batches parent keys into groups of 50 for secondary JQL queries")
    void batchesParentKeysIntoGroupsOf50() {
        // Arrange -- create 120 parent keys (should produce 3 batches: 50, 50, 20)
        List<String> parentKeys = new ArrayList<>();
        IntStream.rangeClosed(1, 120).forEach(i -> parentKeys.add("PROJ-" + i));

        JiraSearchResponse emptyResponse = new JiraSearchResponse(List.of(), true, null);
        when(jiraSearchService.searchIssues(anyString(), anyInt())).thenReturn(emptyResponse);

        // Act
        childExpansionService.fetchChildren(parentKeys);

        // Assert -- verify 3 JQL calls were made (120 keys / 50 per batch = 3 batches)
        ArgumentCaptor<String> jqlCaptor = ArgumentCaptor.forClass(String.class);
        verify(jiraSearchService, times(3)).searchIssues(jqlCaptor.capture(), eq(50));

        List<String> capturedJqls = jqlCaptor.getAllValues();

        // First batch should contain PROJ-1 through PROJ-50
        assertTrue(capturedJqls.get(0).contains("PROJ-1"),
            "First batch JQL should contain PROJ-1");
        assertTrue(capturedJqls.get(0).contains("PROJ-50"),
            "First batch JQL should contain PROJ-50");
        assertFalse(capturedJqls.get(0).contains("PROJ-51"),
            "First batch JQL should not contain PROJ-51");

        // Second batch should contain PROJ-51 through PROJ-100
        assertTrue(capturedJqls.get(1).contains("PROJ-51"),
            "Second batch JQL should contain PROJ-51");
        assertTrue(capturedJqls.get(1).contains("PROJ-100"),
            "Second batch JQL should contain PROJ-100");

        // Third batch should contain PROJ-101 through PROJ-120
        assertTrue(capturedJqls.get(2).contains("PROJ-101"),
            "Third batch JQL should contain PROJ-101");
        assertTrue(capturedJqls.get(2).contains("PROJ-120"),
            "Third batch JQL should contain PROJ-120");

        // All JQL queries should use parent in (...) syntax and ORDER BY created DESC
        for (String jql : capturedJqls) {
            assertTrue(jql.startsWith("parent in ("),
                "JQL should start with 'parent in ('. Actual: " + jql);
            assertTrue(jql.endsWith("ORDER BY created DESC"),
                "JQL should end with 'ORDER BY created DESC'. Actual: " + jql);
        }
    }
}
