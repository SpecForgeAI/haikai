package com.example.architecturemodel.dto;

import com.example.architecturemodel.model.dto.*;
import com.example.architecturemodel.model.dto.export.ProjectSnapshotDto;
import com.example.architecturemodel.model.dto.export.SnapshotMeta;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Tests for ProjectSnapshotDto and SnapshotMeta records.
 *
 * Spec 2026-01-06: Project Snapshot JSON Export
 * Task Group 1: DTO Layer Tests
 */
class ProjectSnapshotDtoTest {

    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        objectMapper.setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
        objectMapper.registerModule(new JavaTimeModule());
        objectMapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
    }

    @Test
    @DisplayName("SnapshotMeta serializes with snapshot_version, exported_at, export_kind fields")
    void testSnapshotMetaSerializesCorrectFields() throws Exception {
        Instant exportedAt = Instant.parse("2026-01-06T12:00:00Z");
        SnapshotMeta meta = new SnapshotMeta(1, exportedAt, "PROJECT_SNAPSHOT");

        String json = objectMapper.writeValueAsString(meta);

        assertThat(json).contains("\"snapshot_version\":1");
        assertThat(json).contains("\"exported_at\":");
        assertThat(json).contains("\"export_kind\":\"PROJECT_SNAPSHOT\"");
    }

    @Test
    @DisplayName("exported_at serializes as ISO-8601 UTC timestamp")
    void testExportedAtSerializesAsIso8601() throws Exception {
        Instant exportedAt = Instant.parse("2026-01-06T14:30:45.123Z");
        SnapshotMeta meta = new SnapshotMeta(1, exportedAt, "PROJECT_SNAPSHOT");

        String json = objectMapper.writeValueAsString(meta);

        // ISO-8601 format check
        assertThat(json).contains("\"exported_at\":\"2026-01-06T14:30:45.123Z\"");
    }

    @Test
    @DisplayName("ProjectSnapshotDto assembles correctly with all nested DTOs")
    void testProjectSnapshotDtoAssemblesCorrectly() throws Exception {
        // Create test data
        UUID projectId = UUID.randomUUID();
        Instant now = Instant.now();

        SnapshotMeta meta = new SnapshotMeta(1, now, "PROJECT_SNAPSHOT");

        ProjectDto project = new ProjectDto(
            projectId,
            "Test Project",
            "/projects/test",
            null,  // projectHierarchy
            null,  // organisationId
            null,  // repoUrl
            true,
            now,
            now
        );

        // Empty metaModel for testing structure - using helper
        ArchitectureModelDto model = createEmptyModel();

        List<WorkItemDto> workItems = List.of(
            new WorkItemDto(
                UUID.randomUUID(),
                projectId,
                "INITIATIVE",
                null,
                "Test Initiative",
                "Description",
                "PLANNED",
                1,
                1,
                "Q1 2026",
                null,
                null,
                null,
                null,
                now,
                now
            )
        );

        List<ProjectArtifactDto> artifacts = List.of(
            new ProjectArtifactDto(
                UUID.randomUUID(),
                projectId,
                "MISSION_MD",
                "# Mission",
                "AGENT_OS",
                1,
                now
            )
        );

        ProjectSnapshotDto snapshot = new ProjectSnapshotDto(meta, project, model, workItems, artifacts);

        String json = objectMapper.writeValueAsString(snapshot);

        // Verify top-level fields use snake_case
        assertThat(json).contains("\"meta\":");
        assertThat(json).contains("\"project\":");
        assertThat(json).contains("\"model\":");
        assertThat(json).contains("\"work_items\":");
        assertThat(json).contains("\"artifacts\":");

        // Verify nested fields
        assertThat(json).contains("\"snapshot_version\":1");
        assertThat(json).contains("\"export_kind\":\"PROJECT_SNAPSHOT\"");
        assertThat(json).contains("\"Test Project\"");
    }

    @Test
    @DisplayName("JSON serialization produces correct snake_case field names")
    void testJsonSerializationProducesSnakeCaseFieldNames() throws Exception {
        Instant now = Instant.now();
        UUID projectId = UUID.randomUUID();

        ProjectDto project = new ProjectDto(
            projectId,
            "Test",
            "/test",
            null,  // projectHierarchy
            null,  // organisationId
            null,  // repoUrl
            true,
            now,
            now
        );

        // Empty model using helper
        ArchitectureModelDto model = createEmptyModel();

        SnapshotMeta meta = new SnapshotMeta(1, now, "PROJECT_SNAPSHOT");

        ProjectSnapshotDto snapshot = new ProjectSnapshotDto(
            meta, project, model, List.of(), List.of()
        );

        String json = objectMapper.writeValueAsString(snapshot);

        // Verify snake_case for work_items (not workItems)
        assertThat(json).contains("\"work_items\":");
        assertThat(json).doesNotContain("\"workItems\":");

        // Verify snake_case in meta
        assertThat(json).contains("\"snapshot_version\":");
        assertThat(json).doesNotContain("\"snapshotVersion\":");
        assertThat(json).contains("\"exported_at\":");
        assertThat(json).doesNotContain("\"exportedAt\":");
        assertThat(json).contains("\"export_kind\":");
        assertThat(json).doesNotContain("\"exportKind\":");
    }

    /**
     * Helper method to create an empty ArchitectureModelDto.
     */
    private ArchitectureModelDto createEmptyModel() {
        MetaModelEntitiesDto entities = com.example.architecturemodel.testsupport.TestMetaModelFactory.emptyEntities();
        MetaModelRelationshipsDto relationships = com.example.architecturemodel.testsupport.TestMetaModelFactory.emptyRelationships();
        return new ArchitectureModelDto(new MetaModelDto(entities, relationships), List.of());
    }
}
