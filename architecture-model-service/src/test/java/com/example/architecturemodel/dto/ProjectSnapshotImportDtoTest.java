package com.example.architecturemodel.dto;

import com.example.architecturemodel.model.dto.*;
import com.example.architecturemodel.model.dto.export.ProjectSnapshotDto;
import com.example.architecturemodel.model.dto.export.ProjectSnapshotImportRequestDto;
import com.example.architecturemodel.model.dto.export.ProjectSnapshotImportResultDto;
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
 * Tests for ProjectSnapshotImportRequestDto and ProjectSnapshotImportResultDto.
 *
 * Spec 2026-01-06: Project Snapshot JSON Import
 * Task Group 1: DTO Layer Tests
 */
class ProjectSnapshotImportDtoTest {

    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        objectMapper.setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
        objectMapper.registerModule(new JavaTimeModule());
        objectMapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
    }

    @Test
    @DisplayName("ProjectSnapshotImportRequestDto deserializes from JSON with all fields")
    void testImportRequestDtoDeserializesWithAllFields() throws Exception {
        String json = """
            {
                "snapshot": {
                    "meta": {
                        "snapshot_version": 1,
                        "exported_at": "2026-01-06T12:00:00Z",
                        "export_kind": "PROJECT_SNAPSHOT"
                    },
                    "project": {
                        "id": "550e8400-e29b-41d4-a716-446655440000",
                        "name": "Original Project",
                        "project_parent_folder": "/original/path",
                        "is_active": true,
                        "created_at": "2026-01-06T10:00:00Z",
                        "updated_at": "2026-01-06T11:00:00Z"
                    },
                    "model": {
                        "metaModel": {
                            "entities": {},
                            "relationships": {}
                        },
                        "diagrams": []
                    },
                    "work_items": [],
                    "artifacts": []
                },
                "import_as_name": "Imported Project",
                "project_parent_folder": "/new/path",
                "set_active": false
            }
            """;

        ProjectSnapshotImportRequestDto result = objectMapper.readValue(json, ProjectSnapshotImportRequestDto.class);

        assertThat(result.snapshot()).isNotNull();
        assertThat(result.snapshot().meta().snapshotVersion()).isEqualTo(1);
        assertThat(result.importAsName()).isEqualTo("Imported Project");
        assertThat(result.projectParentFolder()).isEqualTo("/new/path");
        assertThat(result.setActive()).isFalse();
    }

    @Test
    @DisplayName("ProjectSnapshotImportResultDto serializes with correct snake_case field names")
    void testImportResultDtoSerializesWithSnakeCase() throws Exception {
        UUID projectId = UUID.randomUUID();
        Instant now = Instant.now();

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

        ProjectSnapshotImportResultDto result = new ProjectSnapshotImportResultDto(
            project,
            true,
            5,
            3,
            List.of("Warning 1", "Warning 2")
        );

        String json = objectMapper.writeValueAsString(result);

        assertThat(json).contains("\"project\":");
        assertThat(json).contains("\"model_saved\":true");
        assertThat(json).contains("\"work_items_inserted\":5");
        assertThat(json).contains("\"artifacts_inserted\":3");
        assertThat(json).contains("\"warnings\":[\"Warning 1\",\"Warning 2\"]");
        // Verify no camelCase
        assertThat(json).doesNotContain("\"modelSaved\"");
        assertThat(json).doesNotContain("\"workItemsInserted\"");
        assertThat(json).doesNotContain("\"artifactsInserted\"");
    }

    @Test
    @DisplayName("effectiveSetActive returns true when setActive is null or omitted")
    void testEffectiveSetActiveDefaultsToTrue() throws Exception {
        // Test with null setActive
        String jsonWithoutSetActive = """
            {
                "snapshot": {
                    "meta": {"snapshot_version": 1, "exported_at": "2026-01-06T12:00:00Z", "export_kind": "PROJECT_SNAPSHOT"},
                    "project": {"id": "550e8400-e29b-41d4-a716-446655440000", "name": "Test", "project_parent_folder": "/path", "is_active": true},
                    "model": {"metaModel": {"entities": {}, "relationships": {}}, "diagrams": []},
                    "work_items": [],
                    "artifacts": []
                },
                "project_parent_folder": "/new/path"
            }
            """;

        ProjectSnapshotImportRequestDto resultWithNull = objectMapper.readValue(jsonWithoutSetActive, ProjectSnapshotImportRequestDto.class);
        assertThat(resultWithNull.setActive()).isNull();
        assertThat(resultWithNull.effectiveSetActive()).isTrue();

        // Test with explicit true
        String jsonWithTrue = """
            {
                "snapshot": {
                    "meta": {"snapshot_version": 1, "exported_at": "2026-01-06T12:00:00Z", "export_kind": "PROJECT_SNAPSHOT"},
                    "project": {"id": "550e8400-e29b-41d4-a716-446655440000", "name": "Test", "project_parent_folder": "/path", "is_active": true},
                    "model": {"metaModel": {"entities": {}, "relationships": {}}, "diagrams": []},
                    "work_items": [],
                    "artifacts": []
                },
                "project_parent_folder": "/new/path",
                "set_active": true
            }
            """;

        ProjectSnapshotImportRequestDto resultWithTrue = objectMapper.readValue(jsonWithTrue, ProjectSnapshotImportRequestDto.class);
        assertThat(resultWithTrue.effectiveSetActive()).isTrue();

        // Test with explicit false
        String jsonWithFalse = """
            {
                "snapshot": {
                    "meta": {"snapshot_version": 1, "exported_at": "2026-01-06T12:00:00Z", "export_kind": "PROJECT_SNAPSHOT"},
                    "project": {"id": "550e8400-e29b-41d4-a716-446655440000", "name": "Test", "project_parent_folder": "/path", "is_active": true},
                    "model": {"metaModel": {"entities": {}, "relationships": {}}, "diagrams": []},
                    "work_items": [],
                    "artifacts": []
                },
                "project_parent_folder": "/new/path",
                "set_active": false
            }
            """;

        ProjectSnapshotImportRequestDto resultWithFalse = objectMapper.readValue(jsonWithFalse, ProjectSnapshotImportRequestDto.class);
        assertThat(resultWithFalse.effectiveSetActive()).isFalse();
    }

    @Test
    @DisplayName("Request fields accept both snake_case and camelCase via JsonAlias")
    void testJsonAliasHandlesSnakeCaseAndCamelCase() throws Exception {
        // Test with camelCase fields
        String camelCaseJson = """
            {
                "snapshot": {
                    "meta": {"snapshot_version": 1, "exported_at": "2026-01-06T12:00:00Z", "export_kind": "PROJECT_SNAPSHOT"},
                    "project": {"id": "550e8400-e29b-41d4-a716-446655440000", "name": "Test Project", "project_parent_folder": "/path", "is_active": true},
                    "model": {"metaModel": {"entities": {}, "relationships": {}}, "diagrams": []},
                    "work_items": [],
                    "artifacts": []
                },
                "importAsName": "Renamed Project",
                "projectParentFolder": "/camel/path",
                "setActive": true
            }
            """;

        ProjectSnapshotImportRequestDto camelResult = objectMapper.readValue(camelCaseJson, ProjectSnapshotImportRequestDto.class);
        assertThat(camelResult.importAsName()).isEqualTo("Renamed Project");
        assertThat(camelResult.projectParentFolder()).isEqualTo("/camel/path");
        assertThat(camelResult.setActive()).isTrue();

        // Test with snake_case fields
        String snakeCaseJson = """
            {
                "snapshot": {
                    "meta": {"snapshot_version": 1, "exported_at": "2026-01-06T12:00:00Z", "export_kind": "PROJECT_SNAPSHOT"},
                    "project": {"id": "550e8400-e29b-41d4-a716-446655440000", "name": "Test Project", "project_parent_folder": "/path", "is_active": true},
                    "model": {"metaModel": {"entities": {}, "relationships": {}}, "diagrams": []},
                    "work_items": [],
                    "artifacts": []
                },
                "import_as_name": "Snake Project",
                "project_parent_folder": "/snake/path",
                "set_active": false
            }
            """;

        ProjectSnapshotImportRequestDto snakeResult = objectMapper.readValue(snakeCaseJson, ProjectSnapshotImportRequestDto.class);
        assertThat(snakeResult.importAsName()).isEqualTo("Snake Project");
        assertThat(snakeResult.projectParentFolder()).isEqualTo("/snake/path");
        assertThat(snakeResult.setActive()).isFalse();
    }

    @Test
    @DisplayName("effectiveProjectName returns importAsName when provided, otherwise snapshot project name")
    void testEffectiveProjectName() {
        UUID projectId = UUID.randomUUID();
        Instant now = Instant.now();

        ProjectDto project = new ProjectDto(projectId, "Original Name", "/path", null, null, null, true, now, now);
        SnapshotMeta meta = new SnapshotMeta(1, now, "PROJECT_SNAPSHOT");
        ArchitectureModelDto model = createEmptyModel();
        ProjectSnapshotDto snapshot = new ProjectSnapshotDto(meta, project, model, List.of(), List.of());

        // Test with importAsName provided
        ProjectSnapshotImportRequestDto withOverride = new ProjectSnapshotImportRequestDto(
            snapshot, "Override Name", "/new/path", true, null
        );
        assertThat(withOverride.effectiveProjectName()).isEqualTo("Override Name");

        // Test with blank importAsName
        ProjectSnapshotImportRequestDto withBlank = new ProjectSnapshotImportRequestDto(
            snapshot, "  ", "/new/path", true, null
        );
        assertThat(withBlank.effectiveProjectName()).isEqualTo("Original Name");

        // Test with null importAsName
        ProjectSnapshotImportRequestDto withNull = new ProjectSnapshotImportRequestDto(
            snapshot, null, "/new/path", true, null
        );
        assertThat(withNull.effectiveProjectName()).isEqualTo("Original Name");
    }

    @Test
    @DisplayName("ProjectSnapshotImportResultDto.of creates result with empty warnings")
    void testResultDtoOfFactoryMethod() {
        UUID projectId = UUID.randomUUID();
        Instant now = Instant.now();

        ProjectDto project = new ProjectDto(projectId, "Test", "/path", null, null, null, true, now, now);

        ProjectSnapshotImportResultDto result = ProjectSnapshotImportResultDto.of(project, true, 10, 5);

        assertThat(result.project()).isEqualTo(project);
        assertThat(result.modelSaved()).isTrue();
        assertThat(result.workItemsInserted()).isEqualTo(10);
        assertThat(result.artifactsInserted()).isEqualTo(5);
        assertThat(result.warnings()).isEmpty();
    }

    /**
     * Helper method to create an empty ArchitectureModelDto.
     */
    private ArchitectureModelDto createEmptyModel() {
        MetaModelEntitiesDto entities = new MetaModelEntitiesDto(
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of()
        );

        MetaModelRelationshipsDto relationships = new MetaModelRelationshipsDto(
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of()
        );

        MetaModelDto metaModel = new MetaModelDto(entities, relationships);
        return new ArchitectureModelDto(metaModel, List.of());
    }
}
