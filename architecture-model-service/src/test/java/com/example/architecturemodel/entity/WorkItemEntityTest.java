package com.example.architecturemodel.entity;

import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.example.architecturemodel.model.entity.ProjectArtifactEntity;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for WorkItemEntity and ProjectArtifactEntity.
 *
 * Tests entity field mappings, builder patterns, and JSONB handling.
 */
class WorkItemEntityTest {

    private static final UUID PROJECT_ID = UUID.fromString("00000000-0000-0000-0000-000000000123");

    /**
     * Test WorkItemEntity builder creates entity with all fields.
     */
    @Test
    void workItemEntity_builder_setsAllFields() {
        UUID id = UUID.randomUUID();
        UUID parentId = UUID.randomUUID();
        Instant now = Instant.now();
        Map<String, Object> tags = new HashMap<>();
        tags.put("priority", "high");
        tags.put("sprint", 5);

        WorkItemEntity entity = WorkItemEntity.builder()
            .id(id)
            .projectId(PROJECT_ID)
            .type("EPIC")
            .parentId(parentId)
            .title("Test Epic")
            .description("Epic description")
            .status("IN_PROGRESS")
            .sortOrder(2)
            .priority(1)
            .targetWindow("Q2 2026")
            .tagsJson(tags)
            .externalSystem("Jira")
            .externalKey("EPIC-456")
            .createdAt(now)
            .updatedAt(now)
            .build();

        assertThat(entity.getId()).isEqualTo(id);
        assertThat(entity.getProjectId()).isEqualTo(PROJECT_ID);
        assertThat(entity.getType()).isEqualTo("EPIC");
        assertThat(entity.getParentId()).isEqualTo(parentId);
        assertThat(entity.getTitle()).isEqualTo("Test Epic");
        assertThat(entity.getDescription()).isEqualTo("Epic description");
        assertThat(entity.getStatus()).isEqualTo("IN_PROGRESS");
        assertThat(entity.getSortOrder()).isEqualTo(2);
        assertThat(entity.getPriority()).isEqualTo(1);
        assertThat(entity.getTargetWindow()).isEqualTo("Q2 2026");
        assertThat(entity.getTagsJson()).isEqualTo(tags);
        assertThat(entity.getExternalSystem()).isEqualTo("Jira");
        assertThat(entity.getExternalKey()).isEqualTo("EPIC-456");
        assertThat(entity.getCreatedAt()).isEqualTo(now);
        assertThat(entity.getUpdatedAt()).isEqualTo(now);
    }

    /**
     * Test WorkItemEntity builder defaults.
     */
    @Test
    void workItemEntity_builder_appliesDefaults() {
        WorkItemEntity entity = WorkItemEntity.builder()
            .id(UUID.randomUUID())
            .projectId(PROJECT_ID)
            .type("INITIATIVE")
            .title("Test Initiative")
            .build();

        assertThat(entity.getStatus()).isEqualTo("PLANNED");
        assertThat(entity.getSortOrder()).isEqualTo(0);
        assertThat(entity.getCreatedAt()).isNotNull();
        assertThat(entity.getUpdatedAt()).isNotNull();
    }

    /**
     * Test WorkItemEntity tags_json JSONB handling with complex map.
     */
    @Test
    void workItemEntity_tagsJson_handlesComplexMap() {
        Map<String, Object> tags = new HashMap<>();
        tags.put("string", "value");
        tags.put("number", 42);
        tags.put("boolean", true);
        tags.put("nested", Map.of("inner", "data"));

        WorkItemEntity entity = WorkItemEntity.builder()
            .id(UUID.randomUUID())
            .projectId(PROJECT_ID)
            .type("STORY")
            .title("Test Story")
            .tagsJson(tags)
            .build();

        assertThat(entity.getTagsJson()).containsEntry("string", "value");
        assertThat(entity.getTagsJson()).containsEntry("number", 42);
        assertThat(entity.getTagsJson()).containsEntry("boolean", true);
        assertThat(entity.getTagsJson().get("nested")).isInstanceOf(Map.class);
    }

    /**
     * Test ProjectArtifactEntity builder creates entity with all fields.
     */
    @Test
    void projectArtifactEntity_builder_setsAllFields() {
        UUID id = UUID.randomUUID();
        Instant now = Instant.now();

        ProjectArtifactEntity entity = ProjectArtifactEntity.builder()
            .id(id)
            .projectId(PROJECT_ID)
            .artifactType("ROADMAP_MD")
            .content("# Roadmap\n\n## Q1 Goals...")
            .source("USER_EDIT")
            .revision(3)
            .createdAt(now)
            .build();

        assertThat(entity.getId()).isEqualTo(id);
        assertThat(entity.getProjectId()).isEqualTo(PROJECT_ID);
        assertThat(entity.getArtifactType()).isEqualTo("ROADMAP_MD");
        assertThat(entity.getContent()).isEqualTo("# Roadmap\n\n## Q1 Goals...");
        assertThat(entity.getSource()).isEqualTo("USER_EDIT");
        assertThat(entity.getRevision()).isEqualTo(3);
        assertThat(entity.getCreatedAt()).isEqualTo(now);
    }

    /**
     * Test ProjectArtifactEntity builder defaults.
     */
    @Test
    void projectArtifactEntity_builder_appliesDefaults() {
        ProjectArtifactEntity entity = ProjectArtifactEntity.builder()
            .id(UUID.randomUUID())
            .projectId(PROJECT_ID)
            .artifactType("MISSION_MD")
            .content("# Mission")
            .build();

        assertThat(entity.getSource()).isEqualTo("AGENT_OS");
        assertThat(entity.getRevision()).isEqualTo(1);
        assertThat(entity.getCreatedAt()).isNotNull();
    }
}
