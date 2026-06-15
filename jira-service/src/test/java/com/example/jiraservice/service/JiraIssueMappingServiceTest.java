package com.example.jiraservice.service;

import com.example.jiraservice.model.dto.WorkItemDto;
import com.example.jiraservice.model.dto.jira.*;
import com.example.jiraservice.util.DeterministicIdGenerator;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link JiraIssueMappingService}.
 *
 * <p>Verifies correct mapping of Jira issue objects to WorkItemDto records,
 * including deterministic ID generation, parent reference linkage,
 * and field mapping rules.</p>
 */
@ExtendWith(MockitoExtension.class)
class JiraIssueMappingServiceTest {

    @Mock
    private TypeMappingService typeMappingService;

    private JiraIssueMappingService mappingService;

    private static final String TOOL_PROJECT_ID = "my-project";
    private static final String JIRA_PROJECT_KEY = "PROJ";

    @BeforeEach
    void setUp() {
        mappingService = new JiraIssueMappingService(typeMappingService);
    }

    private JiraIssue createTestIssue(String key, String summary, String issueTypeName,
                                       String statusName, String priorityId, String priorityName,
                                       JiraParentField parent, String created, String updated,
                                       Object description) {
        return new JiraIssue(
            key,
            new JiraIssueFields(
                summary,
                new JiraNamedField(issueTypeName),
                new JiraNamedField(statusName),
                new JiraPriorityField(priorityId, priorityName),
                parent,
                created,
                updated,
                description
            )
        );
    }

    @Test
    @DisplayName("externalSystem is hardcoded to JIRA and externalKey is Jira issue key")
    void externalSystemIsJiraAndExternalKeyIsIssueKey() {
        // Arrange
        JiraIssue issue = createTestIssue(
            "PROJ-123", "Test issue", "Story", "To Do",
            "3", "Medium", null,
            "2026-01-15T10:30:00.000Z", "2026-01-20T14:00:00.000Z",
            "Some description"
        );
        when(typeMappingService.resolveType(anyString(), anyString(), anyString(), isNull()))
            .thenReturn("STORY");

        // Act
        WorkItemDto dto = mappingService.mapToWorkItem(issue, JIRA_PROJECT_KEY, TOOL_PROJECT_ID, Set.of());

        // Assert
        assertEquals("JIRA", dto.externalSystem(),
            "externalSystem must be hardcoded to 'JIRA'");
        assertEquals("PROJ-123", dto.externalKey(),
            "externalKey must be the Jira issue key");
    }

    @Test
    @DisplayName("id is deterministic UUIDv3 from toolProjectId + issueKey")
    void idIsDeterministicUuidFromToolProjectIdAndIssueKey() {
        // Arrange
        JiraIssue issue = createTestIssue(
            "PROJ-456", "Another issue", "Epic", "In Progress",
            "1", "Highest", null,
            "2026-01-15T10:30:00.000Z", "2026-01-20T14:00:00.000Z",
            null
        );
        when(typeMappingService.resolveType(anyString(), anyString(), anyString(), isNull()))
            .thenReturn("INITIATIVE");

        UUID expectedId = DeterministicIdGenerator.generateId(TOOL_PROJECT_ID, "PROJ-456");

        // Act
        WorkItemDto dto = mappingService.mapToWorkItem(issue, JIRA_PROJECT_KEY, TOOL_PROJECT_ID, Set.of());

        // Assert
        assertEquals(expectedId, dto.id(),
            "WorkItemDto.id must be deterministic UUIDv3 from toolProjectId:issueKey");
    }

    @Test
    @DisplayName("parentId is deterministic UUID of parent issue key when parent exists and is fetched")
    void parentIdIsDeterministicUuidWhenParentExistsAndIsFetched() {
        // Arrange
        JiraIssue issue = createTestIssue(
            "PROJ-200", "Child issue", "Story", "To Do",
            "3", "Medium", new JiraParentField("PROJ-100"),
            "2026-01-15T10:30:00.000Z", "2026-01-20T14:00:00.000Z",
            null
        );
        when(typeMappingService.resolveType(anyString(), anyString(), anyString(), isNull()))
            .thenReturn("STORY");

        Set<String> fetchedParentKeys = Set.of("PROJ-100", "PROJ-101");
        UUID expectedParentId = DeterministicIdGenerator.generateId(TOOL_PROJECT_ID, "PROJ-100");

        // Act
        WorkItemDto dto = mappingService.mapToWorkItem(issue, JIRA_PROJECT_KEY, TOOL_PROJECT_ID, fetchedParentKeys);

        // Assert
        assertEquals(expectedParentId, dto.parentId(),
            "parentId must be the deterministic UUID of the parent issue key when parent is in fetchedParentKeys");
    }

    @Test
    @DisplayName("parentId is null when no parent exists")
    void parentIdIsNullWhenNoParent() {
        // Arrange
        JiraIssue issue = createTestIssue(
            "PROJ-300", "Root issue", "Epic", "Open",
            "2", "High", null, // no parent
            "2026-01-15T10:30:00.000Z", "2026-01-20T14:00:00.000Z",
            "Description"
        );
        when(typeMappingService.resolveType(anyString(), anyString(), anyString(), isNull()))
            .thenReturn("INITIATIVE");

        // Act
        WorkItemDto dto = mappingService.mapToWorkItem(issue, JIRA_PROJECT_KEY, TOOL_PROJECT_ID, Set.of());

        // Assert
        assertNull(dto.parentId(),
            "parentId must be null when the issue has no parent");
    }
}
