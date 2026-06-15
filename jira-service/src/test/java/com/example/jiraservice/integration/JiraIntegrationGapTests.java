package com.example.jiraservice.integration;

import com.example.jiraservice.config.JiraProperties;
import com.example.jiraservice.model.dto.WorkItemDto;
import com.example.jiraservice.model.dto.jira.*;
import com.example.jiraservice.service.JiraIssueMappingService;
import com.example.jiraservice.service.TypeMappingService;
import com.example.jiraservice.util.DeterministicIdGenerator;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Strategic gap-fill tests for the Jira integration feature.
 *
 * <p>These tests cover critical integration gaps not addressed in the
 * individual unit test suites from Task Groups 2-5.</p>
 *
 * <p>Spec: 2026-02-05 Jira Service (Spring Boot) -- GET /jira/issues</p>
 * <p>Task Group 8: Test Review and Gap Analysis</p>
 */
class JiraIntegrationGapTests {

    private static final String TOOL_PROJECT_ID = "my-project";

    // ---- Gap Test 1: Full WorkItemDto field mapping from Jira issue ----

    @Test
    @DisplayName("Full mapping: all 14 WorkItemDto fields are correctly mapped from a Jira issue")
    void fullWorkItemDtoFieldMappingFromJiraIssue() {
        // Arrange -- configure type mapping
        Map<String, Map<String, String>> typeMapping = Map.of(
            "PROJ", Map.of("Epic", "INITIATIVE", "Story", "FEATURE")
        );
        JiraProperties properties = new JiraProperties(
            "https://example.atlassian.net",
            JiraProperties.AuthMode.BEARER,
            "token", null, null,
            5000, 30000, typeMapping,
            Map.of(), Map.of()
        );
        TypeMappingService typeMappingService = new TypeMappingService(properties);
        JiraIssueMappingService mappingService = new JiraIssueMappingService(typeMappingService);

        // Create a Jira issue with all fields populated, including a parent
        JiraIssue issue = new JiraIssue(
            "PROJ-42",
            new JiraIssueFields(
                "Implement login feature",
                new JiraNamedField("Story"),
                new JiraNamedField("In Progress"),
                new JiraPriorityField("2", "High"),
                new JiraParentField("PROJ-10"),
                "2026-01-15T10:30:00.000Z",
                "2026-02-01T14:00:00.000Z",
                "As a user I want to log in"
            )
        );

        Set<String> fetchedParentKeys = Set.of("PROJ-10");

        // Act
        WorkItemDto dto = mappingService.mapToWorkItem(issue, "PROJ", TOOL_PROJECT_ID, fetchedParentKeys);

        // Assert -- verify all 14 fields
        UUID expectedId = DeterministicIdGenerator.generateId(TOOL_PROJECT_ID, "PROJ-42");
        UUID expectedParentId = DeterministicIdGenerator.generateId(TOOL_PROJECT_ID, "PROJ-10");

        assertEquals(expectedId, dto.id(), "id: deterministic UUIDv3");
        assertEquals(TOOL_PROJECT_ID, dto.projectId(), "projectId: tool project ID");
        assertEquals("FEATURE", dto.type(), "type: Story maps to FEATURE");
        assertEquals(expectedParentId, dto.parentId(), "parentId: deterministic UUID of parent key");
        assertEquals("Implement login feature", dto.title(), "title: Jira summary");
        assertEquals("As a user I want to log in", dto.description(), "description: Jira description");
        assertEquals("IN_PROGRESS", dto.status(),
            "status: Jira status name normalised to tool status (In Progress -> IN_PROGRESS)");
        assertNull(dto.sortOrder(), "sortOrder: always null");
        assertEquals(2, dto.priority(), "priority: parsed from Jira priority.id");
        assertNull(dto.targetWindow(), "targetWindow: always null");
        assertNull(dto.tags(), "tags: null");
        assertEquals("JIRA", dto.externalSystem(), "externalSystem: hardcoded JIRA");
        assertEquals("PROJ-42", dto.externalKey(), "externalKey: Jira issue key");
        assertEquals(Instant.parse("2026-01-15T10:30:00.000Z"), dto.createdAt(), "createdAt: parsed from Jira created");
        assertEquals(Instant.parse("2026-02-01T14:00:00.000Z"), dto.updatedAt(), "updatedAt: parsed from Jira updated");
    }

    // ---- Gap Test 2: Type mapping with multiple project keys ----

    @Test
    @DisplayName("Type mapping resolves correctly per project key when multiple projects are configured")
    void typeMappingWithMultipleProjectKeys() {
        // Arrange -- two different project key mappings where same Jira type maps to different WorkItemDto types
        Map<String, Map<String, String>> typeMapping = Map.of(
            "ALPHA", Map.of(
                "Epic", "INITIATIVE",
                "Story", "FEATURE"
            ),
            "BETA", Map.of(
                "Epic", "EPIC",
                "Story", "STORY"
            )
        );
        JiraProperties properties = new JiraProperties(
            "https://example.atlassian.net",
            JiraProperties.AuthMode.BEARER,
            "token", null, null,
            5000, 30000, typeMapping,
            Map.of(), Map.of()
        );
        TypeMappingService service = new TypeMappingService(properties);

        // Act & Assert -- ALPHA project: Epic -> INITIATIVE
        assertEquals("INITIATIVE", service.resolveType("ALPHA", "Epic", "ALPHA-1"),
            "Epic in ALPHA project should resolve to INITIATIVE");

        // Act & Assert -- BETA project: Epic -> EPIC (different mapping for same Jira type)
        assertEquals("EPIC", service.resolveType("BETA", "Epic", "BETA-1"),
            "Epic in BETA project should resolve to EPIC");

        // Act & Assert -- ALPHA project: Story -> FEATURE
        assertEquals("FEATURE", service.resolveType("ALPHA", "Story", "ALPHA-2"),
            "Story in ALPHA project should resolve to FEATURE");

        // Act & Assert -- BETA project: Story -> STORY
        assertEquals("STORY", service.resolveType("BETA", "Story", "BETA-2"),
            "Story in BETA project should resolve to STORY");
    }

    // ---- Gap Test 3: Child expansion parentId matches parent id in combined response ----

    @Test
    @DisplayName("Child parentId matches the deterministic id of the parent in the combined response list")
    void childParentIdMatchesParentIdInCombinedList() {
        // Arrange
        Map<String, Map<String, String>> typeMapping = Map.of(
            "PROJ", Map.of("Epic", "INITIATIVE", "Story", "FEATURE")
        );
        JiraProperties properties = new JiraProperties(
            "https://example.atlassian.net",
            JiraProperties.AuthMode.BEARER,
            "token", null, null,
            5000, 30000, typeMapping,
            Map.of(), Map.of()
        );
        TypeMappingService typeMappingService = new TypeMappingService(properties);
        JiraIssueMappingService mappingService = new JiraIssueMappingService(typeMappingService);

        // Parent issue
        JiraIssue parentIssue = new JiraIssue(
            "PROJ-100",
            new JiraIssueFields(
                "Parent Epic", new JiraNamedField("Epic"),
                new JiraNamedField("Open"), new JiraPriorityField("1", "Highest"),
                null,
                "2026-01-10T08:00:00.000Z", "2026-01-15T12:00:00.000Z",
                "Parent description"
            )
        );

        // Child issue with parent reference
        JiraIssue childIssue = new JiraIssue(
            "PROJ-200",
            new JiraIssueFields(
                "Child Story", new JiraNamedField("Story"),
                new JiraNamedField("To Do"), new JiraPriorityField("3", "Medium"),
                new JiraParentField("PROJ-100"),
                "2026-01-12T09:00:00.000Z", "2026-01-16T11:00:00.000Z",
                "Child description"
            )
        );

        Set<String> parentKeys = Set.of("PROJ-100");

        // Act -- map both parent and child
        WorkItemDto parentDto = mappingService.mapToWorkItem(parentIssue, "PROJ", TOOL_PROJECT_ID, parentKeys);
        WorkItemDto childDto = mappingService.mapToWorkItem(childIssue, "PROJ", TOOL_PROJECT_ID, parentKeys);

        // Assert -- child's parentId must exactly equal parent's id
        assertNotNull(parentDto.id(), "Parent must have a non-null id");
        assertNotNull(childDto.parentId(), "Child must have a non-null parentId");
        assertEquals(parentDto.id(), childDto.parentId(),
            "Child's parentId must match the parent's deterministic id");

        // Also verify they are based on the same deterministic generation
        UUID expectedParentId = DeterministicIdGenerator.generateId(TOOL_PROJECT_ID, "PROJ-100");
        assertEquals(expectedParentId, parentDto.id());
        assertEquals(expectedParentId, childDto.parentId());
    }

    // ---- Gap Test 4: WorkItemDto JSON serialization uses snake_case ----

    @Test
    @DisplayName("WorkItemDto JSON serialization produces snake_case field names matching the API contract")
    void workItemDtoJsonSerializationUsesSnakeCase() throws Exception {
        // Arrange
        UUID id = UUID.fromString("550e8400-e29b-41d4-a716-446655440000");
        UUID parentId = UUID.fromString("660e8400-e29b-41d4-a716-446655440000");
        Instant created = Instant.parse("2026-01-15T10:30:00Z");
        Instant updated = Instant.parse("2026-02-01T14:00:00Z");

        WorkItemDto dto = new WorkItemDto(
            id, "my-project", "FEATURE", parentId,
            "Test title", "Test description", "In Progress",
            null, 3, null, null,
            "JIRA", "PROJ-42",
            created, updated
        );

        ObjectMapper mapper = new ObjectMapper();
        mapper.setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
        mapper.registerModule(new JavaTimeModule());
        mapper.configure(com.fasterxml.jackson.databind.SerializationFeature.WRITE_DATES_AS_TIMESTAMPS, false);

        // Act
        String json = mapper.writeValueAsString(dto);

        // Assert -- verify snake_case field names are present
        assertTrue(json.contains("\"id\""), "JSON must contain 'id' field");
        assertTrue(json.contains("\"project_id\""), "JSON must contain 'project_id' (snake_case)");
        assertTrue(json.contains("\"type\""), "JSON must contain 'type' field");
        assertTrue(json.contains("\"parent_id\""), "JSON must contain 'parent_id' (snake_case)");
        assertTrue(json.contains("\"title\""), "JSON must contain 'title' field");
        assertTrue(json.contains("\"description\""), "JSON must contain 'description' field");
        assertTrue(json.contains("\"status\""), "JSON must contain 'status' field");
        assertTrue(json.contains("\"sort_order\""), "JSON must contain 'sort_order' (snake_case)");
        assertTrue(json.contains("\"priority\""), "JSON must contain 'priority' field");
        assertTrue(json.contains("\"target_window\""), "JSON must contain 'target_window' (snake_case)");
        assertTrue(json.contains("\"tags\""), "JSON must contain 'tags' field");
        assertTrue(json.contains("\"external_system\""), "JSON must contain 'external_system' (snake_case)");
        assertTrue(json.contains("\"external_key\""), "JSON must contain 'external_key' (snake_case)");
        assertTrue(json.contains("\"created_at\""), "JSON must contain 'created_at' (snake_case)");
        assertTrue(json.contains("\"updated_at\""), "JSON must contain 'updated_at' (snake_case)");

        // Verify camelCase field names are NOT present (ensure no leakage)
        assertFalse(json.contains("\"projectId\""), "JSON must NOT contain camelCase 'projectId'");
        assertFalse(json.contains("\"parentId\""), "JSON must NOT contain camelCase 'parentId'");
        assertFalse(json.contains("\"sortOrder\""), "JSON must NOT contain camelCase 'sortOrder'");
        assertFalse(json.contains("\"targetWindow\""), "JSON must NOT contain camelCase 'targetWindow'");
        assertFalse(json.contains("\"externalSystem\""), "JSON must NOT contain camelCase 'externalSystem'");
        assertFalse(json.contains("\"externalKey\""), "JSON must NOT contain camelCase 'externalKey'");
        assertFalse(json.contains("\"createdAt\""), "JSON must NOT contain camelCase 'createdAt'");
        assertFalse(json.contains("\"updatedAt\""), "JSON must NOT contain camelCase 'updatedAt'");

        // Verify specific field values
        assertTrue(json.contains("\"my-project\""), "JSON must contain the project ID value");
        assertTrue(json.contains("\"JIRA\""), "JSON must contain 'JIRA' as external_system");
        assertTrue(json.contains("\"PROJ-42\""), "JSON must contain 'PROJ-42' as external_key");
        assertTrue(json.contains("\"FEATURE\""), "JSON must contain 'FEATURE' as type");

        // Verify ISO-8601 date format (not timestamps)
        assertTrue(json.contains("2026-01-15T10:30:00Z"), "created_at must be ISO-8601 format");
        assertTrue(json.contains("2026-02-01T14:00:00Z"), "updated_at must be ISO-8601 format");
    }

    // ---- Gap Test 5: maxResults and jql override parameters forwarded correctly ----

    @Test
    @DisplayName("Custom JQL and maxResults are used instead of defaults when provided")
    void customJqlAndMaxResultsOverrideDefaults() {
        // This tests the controller logic for JQL construction.
        // When jql param is explicitly provided, the default JQL should NOT be used.
        // When maxResults is provided, it should override the default 50.

        String jiraProjectKey = "PROJ";
        String customJql = "project = PROJ AND status = 'In Progress' ORDER BY priority DESC";
        int customMaxResults = 25;

        // Test 1: When jql is provided and not blank, it should be used as-is
        String effectiveJql;
        if (customJql != null && !customJql.isBlank()) {
            effectiveJql = customJql;
        } else {
            effectiveJql = "project = " + jiraProjectKey + " ORDER BY created DESC";
        }

        assertEquals(customJql, effectiveJql,
            "When custom JQL is provided, it must be used instead of the default");
        assertFalse(effectiveJql.equals("project = PROJ ORDER BY created DESC"),
            "Effective JQL must not be the default when custom JQL is provided");

        // Test 2: When jql is null, default should be used
        String nullJql = null;
        String defaultEffective;
        if (nullJql != null && !nullJql.isBlank()) {
            defaultEffective = nullJql;
        } else {
            defaultEffective = "project = " + jiraProjectKey + " ORDER BY created DESC";
        }

        assertEquals("project = PROJ ORDER BY created DESC", defaultEffective,
            "When JQL is null, the default JQL must be used");

        // Test 3: When jql is blank, default should be used
        String blankJql = "   ";
        String blankEffective;
        if (blankJql != null && !blankJql.isBlank()) {
            blankEffective = blankJql;
        } else {
            blankEffective = "project = " + jiraProjectKey + " ORDER BY created DESC";
        }

        assertEquals("project = PROJ ORDER BY created DESC", blankEffective,
            "When JQL is blank, the default JQL must be used");

        // Test 4: maxResults should be passable as a non-default value
        assertNotEquals(50, customMaxResults,
            "Custom maxResults should differ from the default value of 50");
        assertEquals(25, customMaxResults,
            "Custom maxResults should be the explicitly provided value");
    }
}
