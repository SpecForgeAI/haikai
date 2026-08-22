package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.mapper.EntityMapper;
import com.example.architecturemodel.model.dto.entity.PhysicalDataAttributeDto;
import com.example.architecturemodel.model.dto.entity.PhysicalDataEntityDto;
import com.example.architecturemodel.model.dto.relationship.LogicalDataEntityRelationshipDto;
import com.example.architecturemodel.model.entity.LogicalDataEntityRelationshipEntity;
import com.example.architecturemodel.model.entity.PhysicalDataAttributeEntity;
import com.example.architecturemodel.model.entity.PhysicalDataEntityEntity;
import com.example.architecturemodel.repository.relationship.LogicalDataEntityRelationshipRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Focused tests for the DB Structural Fidelity enrichment (Spec: 2026-05-29 --
 * Task Group 1, sub-task 1.1): the new structural columns on
 * {@code physical_data_attributes}, the constraint/index JSONB metadata on
 * {@code physical_data_entities}, and the FK join/referenced columns on
 * {@code logical_data_entity_relationships}.
 *
 * <p>Critical cases only (per the spec's 2-8 limit):</p>
 * <ol>
 *   <li>{@code PhysicalDataAttributeEntity} round-trips the new boxed fields
 *       ({@code source_type} / {@code scale} / {@code precision} /
 *       {@code column_default} / {@code ordinal} / {@code is_identity}) through a
 *       repository save AND a PATCH-style mapper round-trip; nulls are preserved
 *       (boxed types -- per {@code project_primitive_double_dto_overwrite.md}).</li>
 *   <li>{@code PhysicalDataEntityEntity} round-trips the constraint/index JSONB
 *       shape ({@code primary_key} / {@code unique_constraints[]} /
 *       {@code check_constraints[]} / {@code indexes[]}) with no field loss.</li>
 *   <li>{@code LogicalDataEntityRelationshipEntity} round-trips the FK
 *       {@code join_columns} + {@code referenced_columns}.</li>
 *   <li>Wire format is {@code snake_case} for all three DTOs (serialize; assert
 *       snake_case keys; assert NO camelCase leakage on the new fields); NO
 *       {@code @CamelCaseWire}.</li>
 * </ol>
 *
 * <p>The {@code @DataJpaTest} slice mirrors {@code BusinessLogicBehaviorPersistenceTest}:
 * an H2 PostgreSQL-mode DB with a {@code CREATE DOMAIN JSONB AS JSON} INIT alias
 * (H2 has no native JSONB) and an explicit {@code org.h2.Driver} override. The
 * Hibernate {@code create-drop} schema is generated from the entities, so the
 * new columns are created from the entity mappings. {@link EntityMapper} is a
 * dependency-free {@code @Component}, so the mapping / serialization cases simply
 * {@code new} it.</p>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:dbstructfidelitydb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON",
    "spring.datasource.driver-class-name=org.h2.Driver",
    "spring.datasource.username=sa",
    "spring.datasource.password=",
    "spring.liquibase.enabled=false",
    "spring.jpa.hibernate.ddl-auto=create-drop",
    "spring.jpa.properties.hibernate.dialect=org.hibernate.dialect.H2Dialect"
})
class DbStructuralFidelityPersistenceTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private PhysicalDataAttributeRepository attributeRepository;

    @Autowired
    private PhysicalDataEntityRepository entityRepository;

    @Autowired
    private LogicalDataEntityRelationshipRepository relationshipRepository;

    private final EntityMapper entityMapper = new EntityMapper();

    /** A representative constraint/index metadata block (the agreed shape). */
    private static Map<String, Object> sampleConstraintsMetadata() {
        Map<String, Object> pk = new LinkedHashMap<>();
        pk.put("name", "pk_orders");
        pk.put("columns", List.of("id"));

        Map<String, Object> uq = new LinkedHashMap<>();
        uq.put("name", "uq_orders_order_no");
        uq.put("columns", List.of("order_no"));

        Map<String, Object> chk = new LinkedHashMap<>();
        chk.put("name", "chk_orders_amount_positive");
        chk.put("expression", "amount > 0");

        Map<String, Object> idx = new LinkedHashMap<>();
        idx.put("name", "idx_orders_customer_id");
        idx.put("columns", List.of("customer_id"));
        idx.put("is_unique", false);

        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("primary_key", pk);
        meta.put("unique_constraints", List.of(uq));
        meta.put("check_constraints", List.of(chk));
        meta.put("indexes", List.of(idx));
        return meta;
    }

    /** A representative FK column block. */
    private static Map<String, Object> sampleFkColumns() {
        Map<String, Object> fk = new LinkedHashMap<>();
        fk.put("join_columns", List.of("customer_id"));
        fk.put("referenced_columns", List.of("id"));
        return fk;
    }

    @Test
    @DisplayName("PhysicalDataAttribute round-trips the new boxed structural fields; nulls preserved through a PATCH-style mapper round-trip")
    void attributeRoundTripsNewFieldsAndPreservesNulls() {
        String modelFileId = "mf-" + UUID.randomUUID();
        PhysicalDataAttributeEntity entity = PhysicalDataAttributeEntity.builder()
            .id("pa-" + UUID.randomUUID())
            .modelFileId(modelFileId)
            .physicalEntityId("pe-1")
            .name("amount")
            .dataType("numeric")
            .isPrimaryKey(false)
            .isNullable(true)
            .tags("discovery")
            .sourceType("numeric(10,2)")
            .scale(2)
            .precision(10)
            .columnDefault("0.00")
            .ordinal(3)
            .isIdentity(false)
            .build();

        PhysicalDataAttributeEntity saved = attributeRepository.saveAndFlush(entity);
        entityManager.clear();

        PhysicalDataAttributeEntity reloaded =
            attributeRepository.findById(saved.getId()).orElseThrow();
        assertThat(reloaded.getSourceType()).isEqualTo("numeric(10,2)");
        assertThat(reloaded.getScale()).isEqualTo(2);
        assertThat(reloaded.getPrecision()).isEqualTo(10);
        assertThat(reloaded.getColumnDefault()).isEqualTo("0.00");
        assertThat(reloaded.getOrdinal()).isEqualTo(3);
        assertThat(reloaded.getIsIdentity()).isFalse();

        // Mapper carries the new fields through in both directions (no field loss).
        PhysicalDataAttributeDto dto = entityMapper.toDto(reloaded);
        assertThat(dto.sourceType()).isEqualTo("numeric(10,2)");
        assertThat(dto.scale()).isEqualTo(2);
        assertThat(dto.precision()).isEqualTo(10);
        assertThat(dto.columnDefault()).isEqualTo("0.00");
        assertThat(dto.ordinal()).isEqualTo(3);
        assertThat(dto.isIdentity()).isFalse();

        // PATCH-style: a DTO carrying NO structural values maps to nulls on the
        // entity (boxed Integer/Boolean preserve null -- no wipe to 0 / false).
        PhysicalDataAttributeDto patchDto = new PhysicalDataAttributeDto(
            "pa-null", "code", null, "pe-1", "varchar",
            false, true, null,
            null, null, null, null, null, null);
        PhysicalDataAttributeEntity patched = entityMapper.toEntity(patchDto, modelFileId);
        assertThat(patched.getSourceType()).isNull();
        assertThat(patched.getScale()).isNull();
        assertThat(patched.getPrecision()).isNull();
        assertThat(patched.getColumnDefault()).isNull();
        assertThat(patched.getOrdinal()).isNull();
        assertThat(patched.getIsIdentity()).isNull();

        // ...and round-trips back to the DTO as nulls (not fabricated defaults).
        PhysicalDataAttributeDto roundTripped = entityMapper.toDto(patched);
        assertThat(roundTripped.scale()).isNull();
        assertThat(roundTripped.ordinal()).isNull();
        assertThat(roundTripped.isIdentity()).isNull();
    }

    @Test
    @DisplayName("PhysicalDataEntity round-trips the constraint/index JSONB metadata (PK / unique / check / index) with no field loss")
    void entityRoundTripsConstraintsMetadata() {
        String modelFileId = "mf-" + UUID.randomUUID();
        PhysicalDataEntityEntity entity = PhysicalDataEntityEntity.builder()
            .id("pe-" + UUID.randomUUID())
            .modelFileId(modelFileId)
            .name("orders")
            .physicalType("Table")
            .databaseName("salesdb")
            .constraintsMetadata(sampleConstraintsMetadata())
            .build();

        PhysicalDataEntityEntity saved = entityRepository.saveAndFlush(entity);
        entityManager.clear();

        PhysicalDataEntityEntity reloaded =
            entityRepository.findById(saved.getId()).orElseThrow();
        Map<String, Object> meta = reloaded.getConstraintsMetadata();
        assertThat(meta).isNotNull();

        @SuppressWarnings("unchecked")
        Map<String, Object> pk = (Map<String, Object>) meta.get("primary_key");
        assertThat(pk.get("name")).isEqualTo("pk_orders");
        assertThat((List<Object>) pk.get("columns")).containsExactly("id");

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> uniques = (List<Map<String, Object>>) meta.get("unique_constraints");
        assertThat(uniques).hasSize(1);
        assertThat(uniques.get(0).get("name")).isEqualTo("uq_orders_order_no");

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> checks = (List<Map<String, Object>>) meta.get("check_constraints");
        assertThat(checks.get(0).get("expression")).isEqualTo("amount > 0");

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> indexes = (List<Map<String, Object>>) meta.get("indexes");
        assertThat(indexes.get(0).get("name")).isEqualTo("idx_orders_customer_id");
        assertThat(indexes.get(0).get("is_unique")).isEqualTo(false);

        // Mapper carries the JSONB through in both directions.
        PhysicalDataEntityDto dto = entityMapper.toDto(reloaded);
        assertThat(dto.constraintsMetadata()).isEqualTo(sampleConstraintsMetadata());
        PhysicalDataEntityEntity back = entityMapper.toEntity(dto, modelFileId);
        assertThat(back.getConstraintsMetadata()).isEqualTo(sampleConstraintsMetadata());

        // Null metadata round-trips cleanly (existing rows carry none).
        PhysicalDataEntityEntity nullMeta = entityRepository.saveAndFlush(
            PhysicalDataEntityEntity.builder()
                .id("pe-null-" + UUID.randomUUID())
                .modelFileId(modelFileId)
                .name("legacy")
                .build());
        entityManager.clear();
        assertThat(entityRepository.findById(nullMeta.getId()).orElseThrow()
            .getConstraintsMetadata()).isNull();
    }

    @Test
    @DisplayName("LogicalDataEntityRelationship round-trips the FK join_columns + referenced_columns; point-id endpoints unchanged")
    void relationshipRoundTripsFkColumns() {
        String modelFileId = "mf-" + UUID.randomUUID();
        LogicalDataEntityRelationshipEntity entity = LogicalDataEntityRelationshipEntity.builder()
            .id("rel-" + UUID.randomUUID())
            .modelFileId(modelFileId)
            .fromDataEntityPointId("dep_phy_order")
            .toDataEntityPointId("dep_phy_customer")
            .cardinality("MANY_TO_ONE")
            .relationship("ASSOCIATION")
            .fkColumns(sampleFkColumns())
            .build();

        LogicalDataEntityRelationshipEntity saved = relationshipRepository.saveAndFlush(entity);
        entityManager.clear();

        LogicalDataEntityRelationshipEntity reloaded =
            relationshipRepository.findById(saved.getId()).orElseThrow();
        // The data_entity_points endpoints are unchanged.
        assertThat(reloaded.getFromDataEntityPointId()).isEqualTo("dep_phy_order");
        assertThat(reloaded.getToDataEntityPointId()).isEqualTo("dep_phy_customer");

        Map<String, Object> fk = reloaded.getFkColumns();
        assertThat(fk).isNotNull();
        assertThat((List<Object>) fk.get("join_columns")).containsExactly("customer_id");
        assertThat((List<Object>) fk.get("referenced_columns")).containsExactly("id");

        // Mapper carries fk_columns through in both directions.
        LogicalDataEntityRelationshipDto dto = entityMapper.toDto(reloaded);
        assertThat(dto.fkColumns()).isEqualTo(sampleFkColumns());
        LogicalDataEntityRelationshipEntity back = entityMapper.toEntity(dto, modelFileId);
        assertThat(back.getFkColumns()).isEqualTo(sampleFkColumns());

        // Null fk_columns round-trips cleanly.
        LogicalDataEntityRelationshipEntity nullFk = relationshipRepository.saveAndFlush(
            LogicalDataEntityRelationshipEntity.builder()
                .id("rel-null-" + UUID.randomUUID())
                .modelFileId(modelFileId)
                .fromDataEntityPointId("dep_phy_a")
                .toDataEntityPointId("dep_phy_b")
                .build());
        entityManager.clear();
        assertThat(relationshipRepository.findById(nullFk.getId()).orElseThrow()
            .getFkColumns()).isNull();
    }

    @Test
    @DisplayName("Wire format: the three DTOs serialize the new fields under snake_case keys; NO camelCase leakage; round-trips back")
    void dtosSerializeNewFieldsToSnakeCaseOnly() throws Exception {
        // Mirror the global AMS Jackson config
        // (spring.jackson.property-naming-strategy: SNAKE_CASE).
        ObjectMapper objectMapper = new ObjectMapper();
        objectMapper.setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);

        PhysicalDataAttributeDto attrDto = new PhysicalDataAttributeDto(
            "pa-1", "amount", "Order amount", "pe-1", "numeric",
            false, true, "discovery",
            "numeric(10,2)", 2, 10, "0.00", 3, true);
        String attrJson = objectMapper.writeValueAsString(attrDto);
        assertThat(attrJson).contains("\"source_type\"");
        assertThat(attrJson).contains("\"column_default\"");
        assertThat(attrJson).contains("\"is_identity\"");
        assertThat(attrJson).contains("\"scale\"");
        assertThat(attrJson).contains("\"precision\"");
        assertThat(attrJson).contains("\"ordinal\"");
        // No camelCase leakage on the new (or existing) fields.
        assertThat(attrJson).doesNotContain("sourceType");
        assertThat(attrJson).doesNotContain("columnDefault");
        assertThat(attrJson).doesNotContain("isIdentity");
        PhysicalDataAttributeDto attrParsed =
            objectMapper.readValue(attrJson, PhysicalDataAttributeDto.class);
        assertThat(attrParsed.sourceType()).isEqualTo("numeric(10,2)");
        assertThat(attrParsed.scale()).isEqualTo(2);
        assertThat(attrParsed.isIdentity()).isTrue();

        PhysicalDataEntityDto entityDto = new PhysicalDataEntityDto(
            "pe-1", "orders", "Orders table", "Table", "salesdb",
            "discovery", "2026-Q2", "2026-Q4", sampleConstraintsMetadata(), null, null);
        String entityJson = objectMapper.writeValueAsString(entityDto);
        assertThat(entityJson).contains("\"constraints_metadata\"");
        assertThat(entityJson).contains("\"primary_key\"");
        assertThat(entityJson).contains("\"unique_constraints\"");
        assertThat(entityJson).contains("\"check_constraints\"");
        assertThat(entityJson).doesNotContain("constraintsMetadata");
        PhysicalDataEntityDto entityParsed =
            objectMapper.readValue(entityJson, PhysicalDataEntityDto.class);
        assertThat(entityParsed.constraintsMetadata()).isNotNull();
        @SuppressWarnings("unchecked")
        Map<String, Object> parsedPk =
            (Map<String, Object>) entityParsed.constraintsMetadata().get("primary_key");
        assertThat(parsedPk.get("name")).isEqualTo("pk_orders");

        LogicalDataEntityRelationshipDto relDto = new LogicalDataEntityRelationshipDto(
            "rel-1", "dep_phy_order", "dep_phy_customer", "MANY_TO_ONE", "ASSOCIATION",
            "Order->Customer FK", "discovery", "2026-Q2", "2026-Q4", sampleFkColumns());
        String relJson = objectMapper.writeValueAsString(relDto);
        assertThat(relJson).contains("\"fk_columns\"");
        assertThat(relJson).contains("\"join_columns\"");
        assertThat(relJson).contains("\"referenced_columns\"");
        assertThat(relJson).doesNotContain("fkColumns");
        LogicalDataEntityRelationshipDto relParsed =
            objectMapper.readValue(relJson, LogicalDataEntityRelationshipDto.class);
        assertThat(relParsed.fkColumns()).isNotNull();
        assertThat((List<Object>) relParsed.fkColumns().get("join_columns")).containsExactly("customer_id");
    }
}
