package com.example.architecturemodel.migration;

import com.example.architecturemodel.mapper.WorkItemMapper;
import com.example.architecturemodel.model.dto.WorkItemDto;
import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import jakarta.persistence.Column;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Migration verification tests for migration 046 (work_item.external_url).
 *
 * Since tests use H2 with hibernate ddl-auto=create-drop, and the work_item table
 * cannot be created by H2 due to the JSONB columnDefinition on tags_json, we verify
 * the entity field mappings and mapper behavior at the Java level instead.
 *
 * Spec: RM Increment 4 -- Jira Import for Roadmap Skeleton (Initiatives + Epics)
 * Task Group 1: Migration + Entity/DTO/Mapper Extension
 *
 * Tests 5-6 added by Task Group 4: Gap Analysis
 */
class WorkItemExternalUrlMigrationTest {

    /**
     * Test 1: Verify WorkItemEntity has externalUrl field with @Column(name = "external_url") via reflection.
     */
    @Test
    @DisplayName("WorkItemEntity has externalUrl field mapped to external_url column")
    void workItemEntityHasExternalUrlFieldWithCorrectColumnAnnotation() throws NoSuchFieldException {
        // Verify the field exists on the entity class
        Field externalUrlField = WorkItemEntity.class.getDeclaredField("externalUrl");
        assertThat(externalUrlField).isNotNull();
        assertThat(externalUrlField.getType()).isEqualTo(String.class);

        // Verify the @Column annotation maps to the correct column name
        Column columnAnnotation = externalUrlField.getAnnotation(Column.class);
        assertThat(columnAnnotation).isNotNull();
        assertThat(columnAnnotation.name()).isEqualTo("external_url");

        // Verify the field is nullable (default @Column(nullable = true))
        assertThat(columnAnnotation.nullable()).isTrue();
    }

    /**
     * Test 2: Verify builder and getter work for externalUrl (and null is accepted).
     */
    @Test
    @DisplayName("WorkItemEntity builder and getter work for externalUrl, including null")
    void workItemEntityBuilderAndGetterWorkForExternalUrl() {
        String url = "https://jira.example.com/browse/PROJ-123";

        // Verify externalUrl can be set via builder and retrieved via getter
        WorkItemEntity withUrl = WorkItemEntity.builder()
            .id(UUID.randomUUID())
            .projectId(UUID.fromString("11111111-1111-1111-1111-111111111111"))
            .type("INITIATIVE")
            .title("Test Initiative")
            .externalSystem("JIRA")
            .externalKey("PROJ-123")
            .externalUrl(url)
            .build();
        assertThat(withUrl.getExternalUrl()).isEqualTo(url);

        // Verify null is accepted (no externalUrl set)
        WorkItemEntity withoutUrl = WorkItemEntity.builder()
            .id(UUID.randomUUID())
            .projectId(UUID.fromString("11111111-1111-1111-1111-111111111111"))
            .type("EPIC")
            .title("Test Epic")
            .build();
        assertThat(withoutUrl.getExternalUrl()).isNull();
    }

    /**
     * Test 3: Verify WorkItemMapper.toDto() maps externalUrl from entity to DTO.
     */
    @Test
    @DisplayName("WorkItemMapper.toDto() maps externalUrl from entity to DTO")
    void workItemMapperToDtoMapsExternalUrl() {
        String url = "https://jira.example.com/browse/EPIC-42";
        Instant now = Instant.now();

        WorkItemEntity entity = WorkItemEntity.builder()
            .id(UUID.randomUUID())
            .projectId(UUID.fromString("11111111-1111-1111-1111-111111111111"))
            .type("EPIC")
            .title("Test Epic")
            .status("PLANNED")
            .externalSystem("JIRA")
            .externalKey("EPIC-42")
            .externalUrl(url)
            .createdAt(now)
            .updatedAt(now)
            .build();

        WorkItemDto dto = WorkItemMapper.toDto(entity);

        assertThat(dto).isNotNull();
        assertThat(dto.externalUrl()).isEqualTo(url);
        assertThat(dto.externalSystem()).isEqualTo("JIRA");
        assertThat(dto.externalKey()).isEqualTo("EPIC-42");

        // Also verify null externalUrl is mapped correctly
        WorkItemEntity entityNoUrl = WorkItemEntity.builder()
            .id(UUID.randomUUID())
            .projectId(UUID.fromString("11111111-1111-1111-1111-111111111111"))
            .type("INITIATIVE")
            .title("No URL")
            .status("PLANNED")
            .createdAt(now)
            .updatedAt(now)
            .build();

        WorkItemDto dtoNoUrl = WorkItemMapper.toDto(entityNoUrl);
        assertThat(dtoNoUrl.externalUrl()).isNull();
    }

    /**
     * Test 4: Verify WorkItemMapper.updateEntityFromDto() sets externalUrl on entity from DTO.
     */
    @Test
    @DisplayName("WorkItemMapper.updateEntityFromDto() sets externalUrl on entity from DTO")
    void workItemMapperUpdateEntityFromDtoSetsExternalUrl() {
        String url = "https://jira.example.com/browse/INIT-7";
        Instant now = Instant.now();

        // Create entity without externalUrl
        WorkItemEntity entity = WorkItemEntity.builder()
            .id(UUID.randomUUID())
            .projectId(UUID.fromString("11111111-1111-1111-1111-111111111111"))
            .type("INITIATIVE")
            .title("Original Title")
            .status("PLANNED")
            .createdAt(now)
            .updatedAt(now)
            .build();
        assertThat(entity.getExternalUrl()).isNull();

        // Create DTO with externalUrl
        WorkItemDto dto = new WorkItemDto(
            entity.getId(), UUID.fromString("11111111-1111-1111-1111-111111111111"), "INITIATIVE", null,
            "Updated Title", null, "PLANNED", 0, null, null, null,
            "JIRA", "INIT-7", url, now, now
        );

        // Update entity from DTO
        WorkItemMapper.updateEntityFromDto(entity, dto);

        // Verify externalUrl was set
        assertThat(entity.getExternalUrl()).isEqualTo(url);
        assertThat(entity.getTitle()).isEqualTo("Updated Title");

        // Null external fields now PRESERVE the stored value (patch semantics);
        // the explicit unlink sentinel is an empty-string external_key, which
        // clears all three external fields atomically.
        WorkItemDto dtoNullUrl = new WorkItemDto(
            entity.getId(), UUID.fromString("11111111-1111-1111-1111-111111111111"), "INITIATIVE", null,
            "Title Again", null, "PLANNED", 0, null, null, null,
            null, null, null, now, now
        );
        WorkItemMapper.updateEntityFromDto(entity, dtoNullUrl);
        assertThat(entity.getExternalUrl())
            .as("null externalUrl must preserve the stored value (patch semantics)")
            .isEqualTo(url);

        // Empty-string external_key sentinel clears all three external fields.
        WorkItemDto dtoUnlink = new WorkItemDto(
            entity.getId(), UUID.fromString("11111111-1111-1111-1111-111111111111"), "INITIATIVE", null,
            "Title Again", null, "PLANNED", 0, null, null, null,
            null, "", null, now, now
        );
        WorkItemMapper.updateEntityFromDto(entity, dtoUnlink);
        assertThat(entity.getExternalUrl()).isNull();
        assertThat(entity.getExternalKey()).isNull();
        assertThat(entity.getExternalSystem()).isNull();
    }

    // =========================================================================
    // Gap Analysis Tests (Task Group 4)
    // =========================================================================

    /**
     * Test 5 (TG4 Gap): Verify WorkItemMapper.toEntity() maps externalUrl from DTO to entity.
     * TG1 covered toDto() and updateEntityFromDto() but not toEntity().
     */
    @Test
    @DisplayName("WorkItemMapper.toEntity() maps externalUrl from DTO to entity")
    void workItemMapperToEntityMapsExternalUrl() {
        String url = "https://jira.example.com/browse/PROJ-55";
        UUID projectId = UUID.fromString("22222222-2222-2222-2222-222222222222");
        Instant now = Instant.now();

        // Create a DTO with externalUrl set
        WorkItemDto dto = new WorkItemDto(
            UUID.randomUUID(), projectId, "EPIC", null,
            "Epic from Jira", "Some description", "PLANNED", 1, null, null, null,
            "JIRA", "PROJ-55", url, now, now
        );

        // Convert DTO to entity via toEntity()
        WorkItemEntity entity = WorkItemMapper.toEntity(dto, projectId);

        // Verify externalUrl was mapped from DTO to entity
        assertThat(entity).isNotNull();
        assertThat(entity.getExternalUrl()).isEqualTo(url);
        assertThat(entity.getExternalSystem()).isEqualTo("JIRA");
        assertThat(entity.getExternalKey()).isEqualTo("PROJ-55");
        assertThat(entity.getProjectId()).isEqualTo(projectId);
        assertThat(entity.getType()).isEqualTo("EPIC");
        assertThat(entity.getTitle()).isEqualTo("Epic from Jira");

        // Also verify null externalUrl is handled correctly
        WorkItemDto dtoNullUrl = new WorkItemDto(
            UUID.randomUUID(), projectId, "INITIATIVE", null,
            "Manual Initiative", null, "PLANNED", 0, null, null, null,
            null, null, null, now, now
        );

        WorkItemEntity entityNullUrl = WorkItemMapper.toEntity(dtoNullUrl, projectId);
        assertThat(entityNullUrl).isNotNull();
        assertThat(entityNullUrl.getExternalUrl()).isNull();
    }

    /**
     * Test 6 (TG4 Gap): Verify WorkItemDto record serializes external_url in JSON output
     * via Jackson ObjectMapper round-trip.
     */
    @Test
    @DisplayName("WorkItemDto JSON serialization includes external_url field")
    void workItemDtoJsonSerializationIncludesExternalUrl() throws Exception {
        String url = "https://jira.example.com/browse/INIT-99";
        UUID id = UUID.randomUUID();
        Instant now = Instant.now();

        WorkItemDto dto = new WorkItemDto(
            id, UUID.fromString("33333333-3333-3333-3333-333333333333"), "INITIATIVE", null,
            "JSON Test", null, "PLANNED", 0, null, null, null,
            "JIRA", "INIT-99", url, now, now
        );

        // Serialize to JSON
        ObjectMapper mapper = new ObjectMapper();
        mapper.registerModule(new JavaTimeModule());
        String json = mapper.writeValueAsString(dto);

        // Verify the JSON contains the external_url field with the correct value
        assertThat(json).contains("\"external_url\"");
        assertThat(json).contains(url);
        assertThat(json).contains("\"external_system\"");
        assertThat(json).contains("\"JIRA\"");
        assertThat(json).contains("\"external_key\"");
        assertThat(json).contains("\"INIT-99\"");

        // Deserialize back and verify round-trip
        WorkItemDto deserialized = mapper.readValue(json, WorkItemDto.class);
        assertThat(deserialized.externalUrl()).isEqualTo(url);
        assertThat(deserialized.externalSystem()).isEqualTo("JIRA");
        assertThat(deserialized.externalKey()).isEqualTo("INIT-99");
        assertThat(deserialized.id()).isEqualTo(id);

        // Verify null external_url serialization
        WorkItemDto dtoNullUrl = new WorkItemDto(
            UUID.randomUUID(), UUID.fromString("33333333-3333-3333-3333-333333333333"), "EPIC", null,
            "No URL", null, "PLANNED", 0, null, null, null,
            null, null, null, now, now
        );

        String jsonNull = mapper.writeValueAsString(dtoNullUrl);
        WorkItemDto deserializedNull = mapper.readValue(jsonNull, WorkItemDto.class);
        assertThat(deserializedNull.externalUrl()).isNull();
    }
}
