package com.example.jiraservice.controller;

import com.example.jiraservice.model.dto.WorkItemDto;
import com.example.jiraservice.model.dto.jira.*;
import com.example.jiraservice.service.ChildExpansionService;
import com.example.jiraservice.service.JiraIssueAttachmentService;
import com.example.jiraservice.service.JiraIssueCreateService;
import com.example.jiraservice.service.JiraIssueMappingService;
import com.example.jiraservice.service.JiraIssueTransitionService;
import com.example.jiraservice.service.JiraIssueUpdateService;
import com.example.jiraservice.service.JiraSearchService;
import com.example.jiraservice.util.DeterministicIdGenerator;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.hamcrest.Matchers.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Integration tests for {@link JiraIssueController} using MockMvc.
 *
 * <p>Tests HTTP endpoint behavior including parameter validation,
 * response structure, and child expansion.</p>
 */
@WebMvcTest(JiraIssueController.class)
class JiraIssueControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private JiraSearchService jiraSearchService;

    @MockBean
    private JiraIssueMappingService jiraIssueMappingService;

    @MockBean
    private ChildExpansionService childExpansionService;

    @MockBean
    private JiraIssueUpdateService jiraIssueUpdateService;

    @MockBean
    private JiraIssueCreateService jiraIssueCreateService;

    @MockBean
    private JiraIssueTransitionService jiraIssueTransitionService;

    @MockBean
    private JiraIssueAttachmentService jiraIssueAttachmentService;

    private static final String TOOL_PROJECT_ID = "my-project";
    private static final String JIRA_PROJECT_KEY = "TESTPROJ";

    // ---- Test 1 (MockMvc): GET /jira/issues without jiraProjectKey returns 400 ----

    @Test
    @DisplayName("GET /jira/issues without jiraProjectKey returns 400")
    void getIssuesWithoutJiraProjectKeyReturns400() throws Exception {
        mockMvc.perform(get("/jira/issues")
                .param("toolProjectId", TOOL_PROJECT_ID))
            .andExpect(status().isBadRequest());
    }

    // ---- Test 2 (MockMvc): GET /jira/issues without toolProjectId returns 400 ----

    @Test
    @DisplayName("GET /jira/issues without toolProjectId returns 400")
    void getIssuesWithoutToolProjectIdReturns400() throws Exception {
        mockMvc.perform(get("/jira/issues")
                .param("jiraProjectKey", JIRA_PROJECT_KEY))
            .andExpect(status().isBadRequest());
    }

    // ---- Test 3 (MockMvc): GET /jira/issues with blank jiraProjectKey returns 400 ----

    @Test
    @DisplayName("GET /jira/issues with blank jiraProjectKey returns 400")
    void getIssuesWithBlankJiraProjectKeyReturns400() throws Exception {
        mockMvc.perform(get("/jira/issues")
                .param("jiraProjectKey", "   ")
                .param("toolProjectId", TOOL_PROJECT_ID))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("Bad Request"))
            .andExpect(jsonPath("$.status").value(400))
            .andExpect(jsonPath("$.message").value(containsString("jiraProjectKey")));
    }

    // ---- Test 4 (MockMvc): GET /jira/issues with valid params returns 200 and JSON array ----

    @Test
    @DisplayName("GET /jira/issues with valid params returns 200 and JSON array")
    void getIssuesWithValidParamsReturns200AndJsonArray() throws Exception {
        // Arrange
        JiraIssue issue = new JiraIssue(
            "TESTPROJ-1",
            new JiraIssueFields(
                "Test Summary", new JiraNamedField("Story"),
                new JiraNamedField("To Do"), new JiraPriorityField("3", "Medium"),
                null, "2026-01-15T10:30:00.000Z", "2026-01-20T14:00:00.000Z",
                "Test description"
            )
        );
        JiraSearchResponse searchResponse = new JiraSearchResponse(List.of(issue), false, null);

        UUID expectedId = DeterministicIdGenerator.generateId(TOOL_PROJECT_ID, "TESTPROJ-1");
        WorkItemDto workItem = new WorkItemDto(
            expectedId, TOOL_PROJECT_ID, "FEATURE", null,
            "Test Summary", "Test description", "To Do",
            null, 3, null, null, "JIRA", "TESTPROJ-1",
            Instant.parse("2026-01-15T10:30:00.000Z"),
            Instant.parse("2026-01-20T14:00:00.000Z")
        );

        when(jiraSearchService.searchIssues(anyString(), anyInt())).thenReturn(searchResponse);
        when(jiraIssueMappingService.mapToWorkItem(any(JiraIssue.class), anyString(), anyString(), any(Set.class), nullable(Map.class)))
            .thenReturn(workItem);

        // Act & Assert
        mockMvc.perform(get("/jira/issues")
                .param("jiraProjectKey", JIRA_PROJECT_KEY)
                .param("toolProjectId", TOOL_PROJECT_ID))
            .andExpect(status().isOk())
            .andExpect(content().contentType("application/json"))
            .andExpect(jsonPath("$").isArray())
            .andExpect(jsonPath("$", hasSize(1)))
            .andExpect(jsonPath("$[0].id").value(expectedId.toString()))
            .andExpect(jsonPath("$[0].project_id").value(TOOL_PROJECT_ID))
            .andExpect(jsonPath("$[0].type").value("FEATURE"))
            .andExpect(jsonPath("$[0].external_system").value("JIRA"))
            .andExpect(jsonPath("$[0].external_key").value("TESTPROJ-1"))
            .andExpect(jsonPath("$[0].title").value("Test Summary"));
    }

    // ---- Test 5 (MockMvc): GET /jira/issues?expandChildren=true includes child issues ----

    @Test
    @DisplayName("GET /jira/issues?expandChildren=true includes child issues in response")
    void getIssuesWithExpandChildrenIncludesChildren() throws Exception {
        // Arrange -- parent issue
        JiraIssue parentIssue = new JiraIssue(
            "TESTPROJ-10",
            new JiraIssueFields(
                "Parent Epic", new JiraNamedField("Epic"),
                new JiraNamedField("In Progress"), new JiraPriorityField("1", "Highest"),
                null, "2026-01-10T08:00:00.000Z", "2026-01-15T12:00:00.000Z",
                "Parent description"
            )
        );
        JiraSearchResponse parentResponse = new JiraSearchResponse(List.of(parentIssue), false, null);

        UUID parentId = DeterministicIdGenerator.generateId(TOOL_PROJECT_ID, "TESTPROJ-10");
        WorkItemDto parentDto = new WorkItemDto(
            parentId, TOOL_PROJECT_ID, "INITIATIVE", null,
            "Parent Epic", "Parent description", "In Progress",
            null, 1, null, null, "JIRA", "TESTPROJ-10",
            Instant.parse("2026-01-10T08:00:00.000Z"),
            Instant.parse("2026-01-15T12:00:00.000Z")
        );

        // Arrange -- child issue
        JiraIssue childIssue = new JiraIssue(
            "TESTPROJ-20",
            new JiraIssueFields(
                "Child Story", new JiraNamedField("Story"),
                new JiraNamedField("To Do"), new JiraPriorityField("3", "Medium"),
                new JiraParentField("TESTPROJ-10"),
                "2026-01-12T09:00:00.000Z", "2026-01-16T11:00:00.000Z",
                "Child description"
            )
        );

        UUID childId = DeterministicIdGenerator.generateId(TOOL_PROJECT_ID, "TESTPROJ-20");
        WorkItemDto childDto = new WorkItemDto(
            childId, TOOL_PROJECT_ID, "FEATURE", parentId,
            "Child Story", "Child description", "To Do",
            null, 3, null, null, "JIRA", "TESTPROJ-20",
            Instant.parse("2026-01-12T09:00:00.000Z"),
            Instant.parse("2026-01-16T11:00:00.000Z")
        );

        when(jiraSearchService.searchIssues(anyString(), anyInt())).thenReturn(parentResponse);
        when(childExpansionService.fetchChildren(any(List.class))).thenReturn(List.of(childIssue));

        // First call maps the parent, second call maps the child
        when(jiraIssueMappingService.mapToWorkItem(any(JiraIssue.class), anyString(), anyString(), any(Set.class), nullable(Map.class)))
            .thenReturn(parentDto)
            .thenReturn(childDto);

        // Act & Assert
        mockMvc.perform(get("/jira/issues")
                .param("jiraProjectKey", JIRA_PROJECT_KEY)
                .param("toolProjectId", TOOL_PROJECT_ID)
                .param("expandChildren", "true"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$").isArray())
            .andExpect(jsonPath("$", hasSize(2)))
            .andExpect(jsonPath("$[0].external_key").value("TESTPROJ-10"))
            .andExpect(jsonPath("$[0].type").value("INITIATIVE"))
            .andExpect(jsonPath("$[1].external_key").value("TESTPROJ-20"))
            .andExpect(jsonPath("$[1].parent_id").value(parentId.toString()));
    }
}
