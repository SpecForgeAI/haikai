package com.example.architecturemodel.dto;

import com.example.architecturemodel.model.dto.WorkItemDto;
import com.example.architecturemodel.model.dto.ProjectArtifactDto;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Tests for WorkItemDto and ProjectArtifactDto JSON serialization.
 *
 * Verifies snake_case property names and proper handling of optional fields.
 */
class WorkItemDtoTest {

    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        objectMapper.setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
        objectMapper.registerModule(new JavaTimeModule());
    }

    /**
     * Test WorkItemDto serializes with snake_case property names.
     */
    @Test
    void workItemDto_serialization_usesSnakeCase() throws Exception {
        UUID id = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID parentId = UUID.randomUUID();
        Instant now = Instant.now();

        WorkItemDto dto = new WorkItemDto(
            id,
            projectId,
            "EPIC",
            parentId,
            "Test Epic",
            "Description",
            "PLANNED",
            1,
            2,
            "Q1 2026",
            Map.of("key", "value"),
            "Jira",
            "EPIC-123",
            null,
            now,
            now
        );

        String json = objectMapper.writeValueAsString(dto);

        // Verify snake_case property names
        assertThat(json).contains("\"project_id\":\"" + projectId + "\"");
        assertThat(json).contains("\"parent_id\":\"" + parentId + "\"");
        assertThat(json).contains("\"sort_order\":1");
        assertThat(json).contains("\"target_window\":\"Q1 2026\"");
        assertThat(json).contains("\"external_system\":\"Jira\"");
        assertThat(json).contains("\"external_key\":\"EPIC-123\"");
        assertThat(json).contains("\"created_at\":");
        assertThat(json).contains("\"updated_at\":");
    }

    /**
     * Test WorkItemDto deserializes from snake_case JSON.
     */
    @Test
    void workItemDto_deserialization_fromSnakeCase() throws Exception {
        UUID projectIdValue = UUID.fromString("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
        String json = String.format("""
            {
                "id": "123e4567-e89b-12d3-a456-426614174000",
                "project_id": "%s",
                "type": "STORY",
                "parent_id": "123e4567-e89b-12d3-a456-426614174001",
                "title": "Test Story",
                "description": "A story",
                "status": "IN_PROGRESS",
                "sort_order": 5,
                "priority": 1,
                "target_window": "Q2 2026",
                "tags": {"label": "urgent"},
                "external_system": "Jira",
                "external_key": "STORY-456"
            }
            """, projectIdValue);

        WorkItemDto dto = objectMapper.readValue(json, WorkItemDto.class);

        assertThat(dto.projectId()).isEqualTo(projectIdValue);
        assertThat(dto.type()).isEqualTo("STORY");
        assertThat(dto.parentId()).isEqualTo(UUID.fromString("123e4567-e89b-12d3-a456-426614174001"));
        assertThat(dto.title()).isEqualTo("Test Story");
        assertThat(dto.sortOrder()).isEqualTo(5);
        assertThat(dto.targetWindow()).isEqualTo("Q2 2026");
        assertThat(dto.externalSystem()).isEqualTo("Jira");
        assertThat(dto.externalKey()).isEqualTo("STORY-456");
    }

    /**
     * Test WorkItemDto handles null optional fields.
     */
    @Test
    void workItemDto_serialization_handlesNullFields() throws Exception {
        WorkItemDto dto = new WorkItemDto(
            UUID.randomUUID(),
            UUID.randomUUID(),
            "INITIATIVE",
            null,  // No parent
            "Test Initiative",
            null,  // No description
            "PLANNED",
            0,
            null,  // No priority
            null,  // No target window
            null,  // No tags
            null,  // No external system
            null,  // No external key
            null,  // No external url
            Instant.now(),
            Instant.now()
        );

        String json = objectMapper.writeValueAsString(dto);

        assertThat(json).contains("\"parent_id\":null");
        assertThat(json).contains("\"description\":null");
        assertThat(json).contains("\"priority\":null");
    }

    /**
     * Test ProjectArtifactDto serializes with snake_case property names.
     */
    @Test
    void projectArtifactDto_serialization_usesSnakeCase() throws Exception {
        UUID id = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        Instant now = Instant.now();

        ProjectArtifactDto dto = new ProjectArtifactDto(
            id,
            projectId,
            "MISSION_MD",
            "# Mission\n\nOur mission is...",
            "AGENT_OS",
            1,
            now
        );

        String json = objectMapper.writeValueAsString(dto);

        assertThat(json).contains("\"project_id\":\"" + projectId + "\"");
        assertThat(json).contains("\"artifact_type\":\"MISSION_MD\"");
        assertThat(json).contains("\"created_at\":");
    }

    /**
     * Test ProjectArtifactDto deserializes from snake_case JSON.
     */
    @Test
    void projectArtifactDto_deserialization_fromSnakeCase() throws Exception {
        UUID projectIdValue = UUID.fromString("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
        String json = String.format("""
            {
                "id": "123e4567-e89b-12d3-a456-426614174000",
                "project_id": "%s",
                "artifact_type": "ROADMAP_MD",
                "content": "# Roadmap",
                "source": "USER_EDIT",
                "revision": 3
            }
            """, projectIdValue);

        ProjectArtifactDto dto = objectMapper.readValue(json, ProjectArtifactDto.class);

        assertThat(dto.projectId()).isEqualTo(projectIdValue);
        assertThat(dto.artifactType()).isEqualTo("ROADMAP_MD");
        assertThat(dto.content()).isEqualTo("# Roadmap");
        assertThat(dto.source()).isEqualTo("USER_EDIT");
        assertThat(dto.revision()).isEqualTo(3);
    }
}
