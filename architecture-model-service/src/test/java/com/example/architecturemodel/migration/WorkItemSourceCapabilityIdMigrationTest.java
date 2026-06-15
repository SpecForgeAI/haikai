package com.example.architecturemodel.migration;

import com.example.architecturemodel.mapper.WorkItemMapper;
import com.example.architecturemodel.model.dto.WorkItemDto;
import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import jakarta.persistence.Column;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Migration + entity/DTO/mapper verification for Liquibase changeset {@code 185}
 * ({@code work_item.source_capability_id}).
 *
 * <p>Spec: D4 -- Carry-over Completeness Gate (2026-06-14, Spec 4 of 6) -- Task
 * Group 1. The new {@code source_capability_id} column promotes D3's
 * blob-only provenance link to a structured column so the gate's coverage query
 * is a join, not a {@code book_of_work_json} re-parse.</p>
 *
 * <p>The {@code work_item} table is NOT created under the {@code @DataJpaTest} H2
 * harness elsewhere because of the JSONB {@code columnDefinition} on
 * {@code tags_json} (see {@code WorkItemExternalUrlMigrationTest}); the live
 * column apply + UUID round-trip is exercised by the JSONB-domain-aliased
 * {@code GeneratedMigrationBookOfWorkAppendCapabilityStoryColumnTest}. Here we
 * verify (a) the changeset SQL is well-formed + registered AFTER 184 (D5 left
 * free for 186), and (b) the entity field mapping + boxed PATCH-safe mapper
 * behaviour at the Java level.</p>
 */
class WorkItemSourceCapabilityIdMigrationTest {

    private String readClasspathResource(String path) throws Exception {
        try (var stream = Objects.requireNonNull(
            getClass().getClassLoader().getResourceAsStream(path),
            "missing classpath resource: " + path);
             var reader = new BufferedReader(
                 new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line).append('\n');
            }
            return sb.toString();
        }
    }

    // -------------------------------------------------------------------------
    // Changeset SQL + master-changelog registration (static smoke gate)
    // -------------------------------------------------------------------------

    @Test
    @DisplayName("changeset 185 SQL adds work_item.source_capability_id (UUID, nullable) and nothing else")
    void changeset185AddsSourceCapabilityIdColumnOnly() throws Exception {
        String sql = readClasspathResource(
            "db/changelog/sql/185-work-item-source-capability-id.sql");

        assertThat(sql)
            .contains("ALTER TABLE work_item")
            .contains("source_capability_id")
            .contains("UUID");

        // Nothing else: the only DDL statement is the single ADD COLUMN. No new
        // table, no other column, no index (D10: one small changeset).
        assertThat(sql)
            .as("changeset 185 must not create a table")
            .doesNotContain("CREATE TABLE");
    }

    @Test
    @DisplayName("db.changelog-master.yaml registers changeset 185 AFTER 184 with the columnExists-not precondition; 184 untouched")
    void masterChangelogRegisters185After184() throws Exception {
        String master = readClasspathResource("db/changelog/db.changelog-master.yaml");

        assertThat(master)
            .as("changeset 185 must be registered with its sqlFile path")
            .contains("id: 185-work-item-source-capability-id")
            .contains("db/changelog/sql/185-work-item-source-capability-id.sql");

        // 184 (D2's changeset) must still be present and unmodified.
        assertThat(master)
            .as("changeset 184 anchor must still be present -- verifies we did not delete/alter it")
            .contains("id: 184-discovery-capability")
            .contains("db/changelog/sql/184-discovery-capability.sql");

        // 185 must be registered AFTER 184 (the append point); D5 reserves 186.
        int idx184 = master.indexOf("id: 184-discovery-capability");
        int idx185 = master.indexOf("id: 185-work-item-source-capability-id");
        assertThat(idx184).isGreaterThan(-1);
        assertThat(idx185)
            .as("changeset 185 must be registered AFTER 184")
            .isGreaterThan(idx184);

        // The 185 precondition uses the columnExists-not idiom (re-runnable / safe).
        assertThat(master)
            .contains("columnName: source_capability_id");
    }

    // -------------------------------------------------------------------------
    // Entity field mapping (Java level -- the work_item table is not H2-creatable
    // under @DataJpaTest because of the JSONB tags_json columnDefinition)
    // -------------------------------------------------------------------------

    @Test
    @DisplayName("WorkItemEntity has a BOXED UUID sourceCapabilityId field mapped to source_capability_id (nullable)")
    void workItemEntityHasBoxedSourceCapabilityIdField() throws NoSuchFieldException {
        Field field = WorkItemEntity.class.getDeclaredField("sourceCapabilityId");
        assertThat(field).isNotNull();
        // BOXED UUID (reference type) per project_primitive_double_dto_overwrite.md
        // -- never a primitive, so a PATCH that omits it cannot wipe the column.
        assertThat(field.getType()).isEqualTo(UUID.class);

        Column column = field.getAnnotation(Column.class);
        assertThat(column).isNotNull();
        assertThat(column.name()).isEqualTo("source_capability_id");
        assertThat(column.nullable()).isTrue();
    }

    @Test
    @DisplayName("WorkItemEntity builder + getter round-trip sourceCapabilityId, including null")
    void workItemEntityBuilderAndGetterRoundTripSourceCapabilityId() {
        UUID capabilityId = UUID.randomUUID();
        WorkItemEntity withCapability = WorkItemEntity.builder()
            .id(UUID.randomUUID())
            .projectId(UUID.randomUUID())
            .type("STORY")
            .title("Capability story")
            .sourceCapabilityId(capabilityId)
            .build();
        assertThat(withCapability.getSourceCapabilityId()).isEqualTo(capabilityId);

        WorkItemEntity withoutCapability = WorkItemEntity.builder()
            .id(UUID.randomUUID())
            .projectId(UUID.randomUUID())
            .type("STORY")
            .title("Ordinary story")
            .build();
        assertThat(withoutCapability.getSourceCapabilityId()).isNull();
    }

    // -------------------------------------------------------------------------
    // Mapper round-trip (toDto / toEntity / null-guarded updateEntityFromDto)
    // -------------------------------------------------------------------------

    @Test
    @DisplayName("WorkItemMapper round-trips source_capability_id and PRESERVES it on a null PATCH")
    void workItemMapperRoundTripsAndPreservesSourceCapabilityId() {
        UUID capabilityId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        Instant now = Instant.now();

        WorkItemEntity entity = WorkItemEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .type("STORY")
            .title("Capability story")
            .status("PLANNED")
            .sourceCapabilityId(capabilityId)
            .createdAt(now)
            .updatedAt(now)
            .build();

        // toDto carries the column out.
        WorkItemDto dto = WorkItemMapper.toDto(entity);
        assertThat(dto.sourceCapabilityId()).isEqualTo(capabilityId);

        // toEntity carries it back in.
        WorkItemEntity rebuilt = WorkItemMapper.toEntity(dto, projectId);
        assertThat(rebuilt.getSourceCapabilityId()).isEqualTo(capabilityId);

        // updateEntityFromDto: a null source_capability_id PRESERVES the stored
        // value (boxed PATCH-safe semantics -- an omitted field never wipes it).
        WorkItemDto patchOmittingCapability = new WorkItemDto(
            entity.getId(), projectId, "STORY", null,
            "Renamed", null, "PLANNED", 0, null, null, null,
            null, null, null, now, now,
            null, null, null, Boolean.FALSE, null);
        WorkItemMapper.updateEntityFromDto(entity, patchOmittingCapability);
        assertThat(entity.getSourceCapabilityId())
            .as("null source_capability_id must preserve the stored value (PATCH semantics)")
            .isEqualTo(capabilityId);

        // A non-null source_capability_id on the DTO updates the column.
        UUID reassigned = UUID.randomUUID();
        WorkItemDto patchSettingCapability = new WorkItemDto(
            entity.getId(), projectId, "STORY", null,
            "Renamed again", null, "PLANNED", 0, null, null, null,
            null, null, null, now, now,
            null, null, null, Boolean.FALSE, reassigned);
        WorkItemMapper.updateEntityFromDto(entity, patchSettingCapability);
        assertThat(entity.getSourceCapabilityId()).isEqualTo(reassigned);
    }

    @Test
    @DisplayName("WorkItemDto serializes source_capability_id on the snake_case wire")
    void workItemDtoSerializesSourceCapabilityId() throws Exception {
        UUID capabilityId = UUID.randomUUID();
        Instant now = Instant.now();

        WorkItemDto dto = new WorkItemDto(
            UUID.randomUUID(), UUID.randomUUID(), "STORY", null,
            "Capability story", null, "PLANNED", 0, null, null, null,
            null, null, null, now, now,
            null, null, null, Boolean.FALSE, capabilityId);

        ObjectMapper mapper = new ObjectMapper();
        mapper.setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
        mapper.registerModule(new JavaTimeModule());
        String json = mapper.writeValueAsString(dto);

        assertThat(json).contains("\"source_capability_id\":\"" + capabilityId + "\"");

        WorkItemDto roundTripped = mapper.readValue(json, WorkItemDto.class);
        assertThat(roundTripped.sourceCapabilityId()).isEqualTo(capabilityId);
    }
}
