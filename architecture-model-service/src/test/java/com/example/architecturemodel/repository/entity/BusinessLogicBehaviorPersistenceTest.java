package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.mapper.EntityMapper;
import com.example.architecturemodel.model.dto.entity.BusinessLogicDto;
import com.example.architecturemodel.model.entity.BusinessLogicEntity;
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
 * Focused tests for the new {@code behavior} JSONB column on the
 * {@code business_logics} entity and its exposure on {@code BusinessLogicDto}
 * (Spec: Business-logic behaviour capture for discovery, 2026-05-29 -- Task
 * Group 1, sub-task 1.1).
 *
 * <p>Critical cases only (per the spec's 2-8 limit):</p>
 * <ol>
 *   <li>A {@code BusinessLogicEntity} carrying a populated 7-part
 *       {@code behavior} map persists and re-reads as the SAME structured map
 *       (round-trip, no field loss; embedded confidence preserved).</li>
 *   <li>A null {@code behavior} round-trips cleanly (existing rows carry
 *       none).</li>
 *   <li>DTO &harr; entity mapping via {@link EntityMapper} carries
 *       {@code behavior} through in both directions (passthrough {@link Map}, no
 *       field loss).</li>
 *   <li>Wire format: the DTO serializes the block under the {@code snake_case}
 *       key {@code "behavior"} with the embedded confidence preserved as a boxed
 *       {@link Double}; round-trips back; NO {@code @CamelCaseWire}.</li>
 *   <li>A null {@code behavior} survives a PATCH-style mapper round-trip (the
 *       boxed {@link Map} preserves null rather than fabricating an empty
 *       map).</li>
 * </ol>
 *
 * <p>The {@code @DataJpaTest} slice mirrors {@code EndpointDataEffectPersistenceTest}:
 * an H2 PostgreSQL-mode DB with a {@code CREATE DOMAIN JSONB AS JSON} INIT alias
 * (H2 has no native JSONB) and an explicit {@code org.h2.Driver} override. The
 * Hibernate {@code create-drop} schema is generated from the entity, so the
 * {@code behavior} column is created from the {@code @Type(JsonType.class)}
 * mapping. {@link EntityMapper} is a dependency-free {@code @Component}, so the
 * mapping / serialization cases simply {@code new} it.</p>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:businesslogicbehaviordb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON",
    "spring.datasource.driver-class-name=org.h2.Driver",
    "spring.datasource.username=sa",
    "spring.datasource.password=",
    "spring.liquibase.enabled=false",
    "spring.jpa.hibernate.ddl-auto=create-drop",
    "spring.jpa.properties.hibernate.dialect=org.hibernate.dialect.H2Dialect"
})
class BusinessLogicBehaviorPersistenceTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private BusinessLogicRepository repository;

    private final EntityMapper entityMapper = new EntityMapper();

    /** A representative populated 7-part behaviour block (loose JSONB). */
    private static Map<String, Object> sampleBehavior() {
        Map<String, Object> io = new LinkedHashMap<>();
        io.put("inputs", List.of("owner: Owner"));
        io.put("output", "Owner (persisted)");

        Map<String, Object> validation = new LinkedHashMap<>();
        validation.put("checks", List.of("owner.lastName != null"));
        validation.put("on_failure", "IllegalArgumentException -> 400");

        Map<String, Object> behavior = new LinkedHashMap<>();
        // Internal markers live INSIDE the block (not separate columns).
        behavior.put("schema_version", "behaviour.v1");
        behavior.put("source_hash", "sha256:deadbeef");
        behavior.put("method_id", "com.foo.OwnerService#save(Owner)");
        behavior.put("io", io);
        behavior.put("validation", validation);
        behavior.put("transformation", "trims name, defaults city to 'Madison'");
        behavior.put("data_effects", List.of("insert Owner"));
        behavior.put("side_effects", List.of("publishes OwnerCreated event"));
        behavior.put("edge_cases", List.of("null owner -> 400"));
        // Embedded confidence (part 7) -- a DOUBLE inside the JSONB, mapped to a
        // boxed Double; never a top-level primitive column.
        behavior.put("confidence", 0.82);
        return behavior;
    }

    private BusinessLogicEntity newBusinessLogic(String modelFileId, Map<String, Object> behavior) {
        return BusinessLogicEntity.builder()
            .id("bl-" + UUID.randomUUID())
            .modelFileId(modelFileId)
            .name("OwnerService.save")
            .typeText("TRANSFORMATION")
            .descriptionMd("Persists an Owner")
            .tags("discovery")
            .behavior(behavior)
            .validFrom("2026-Q2")
            .validTo("2026-Q4")
            .build();
    }

    @Test
    @DisplayName("Round-trip: a populated 7-part behavior map persists and re-reads as the same structured map (no field loss)")
    void roundTripPreservesStructuredBehavior() {
        String modelFileId = "mf-" + UUID.randomUUID();
        BusinessLogicEntity entity = newBusinessLogic(modelFileId, sampleBehavior());

        BusinessLogicEntity saved = repository.saveAndFlush(entity);
        entityManager.clear();

        BusinessLogicEntity reloaded = repository.findById(saved.getId()).orElseThrow();

        Map<String, Object> behavior = reloaded.getBehavior();
        assertThat(behavior).isNotNull();
        assertThat(behavior.get("schema_version")).isEqualTo("behaviour.v1");
        assertThat(behavior.get("source_hash")).isEqualTo("sha256:deadbeef");
        assertThat(behavior.get("method_id")).isEqualTo("com.foo.OwnerService#save(Owner)");
        assertThat(behavior.get("transformation")).isEqualTo("trims name, defaults city to 'Madison'");

        @SuppressWarnings("unchecked")
        Map<String, Object> io = (Map<String, Object>) behavior.get("io");
        assertThat(io.get("output")).isEqualTo("Owner (persisted)");
        @SuppressWarnings("unchecked")
        List<Object> inputs = (List<Object>) io.get("inputs");
        assertThat(inputs).containsExactly("owner: Owner");

        // Embedded confidence survives as a numeric value.
        assertThat(((Number) behavior.get("confidence")).doubleValue()).isEqualTo(0.82);
    }

    @Test
    @DisplayName("Null behavior round-trips cleanly (existing rows carry none)")
    void nullBehaviorRoundTrips() {
        String modelFileId = "mf-" + UUID.randomUUID();
        BusinessLogicEntity entity = newBusinessLogic(modelFileId, null);

        BusinessLogicEntity saved = repository.saveAndFlush(entity);
        entityManager.clear();

        BusinessLogicEntity reloaded = repository.findById(saved.getId()).orElseThrow();
        assertThat(reloaded.getBehavior()).isNull();
        // The label-only columns are unaffected.
        assertThat(reloaded.getName()).isEqualTo("OwnerService.save");
        assertThat(reloaded.getTypeText()).isEqualTo("TRANSFORMATION");
    }

    @Test
    @DisplayName("DTO <-> entity mapping carries behavior through in both directions (passthrough Map, no field loss)")
    void mapperCarriesBehaviorBothDirections() {
        String modelFileId = "mf-map-" + UUID.randomUUID();
        BusinessLogicEntity entity = newBusinessLogic(modelFileId, sampleBehavior());

        // entity -> DTO
        BusinessLogicDto dto = entityMapper.toDto(entity);
        assertThat(dto.id()).isEqualTo(entity.getId());
        assertThat(dto.name()).isEqualTo("OwnerService.save");
        assertThat(dto.typeText()).isEqualTo("TRANSFORMATION");
        assertThat(dto.behavior()).isEqualTo(sampleBehavior());
        assertThat(dto.validFrom()).isEqualTo("2026-Q2");
        assertThat(dto.validTo()).isEqualTo("2026-Q4");

        // DTO -> entity (modelFileId injected by the mapper, not carried on the DTO)
        BusinessLogicEntity back = entityMapper.toEntity(dto, modelFileId);
        assertThat(back.getModelFileId()).isEqualTo(modelFileId);
        assertThat(back.getName()).isEqualTo("OwnerService.save");
        assertThat(back.getBehavior()).isEqualTo(sampleBehavior());
        assertThat(back.getValidFrom()).isEqualTo("2026-Q2");
    }

    @Test
    @DisplayName("Wire format: DTO serializes behavior under snake_case key, confidence preserved as a boxed Double, round-trips; NO camelCase leakage")
    void dtoSerializesBehaviorToSnakeCaseWithBoxedConfidence() throws Exception {
        // Mirror the global AMS Jackson config
        // (spring.jackson.property-naming-strategy: SNAKE_CASE).
        ObjectMapper objectMapper = new ObjectMapper();
        objectMapper.setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);

        BusinessLogicDto dto = new BusinessLogicDto(
            "bl-1",
            "OwnerService.save",
            "TRANSFORMATION",
            "Persists an Owner",
            "discovery",
            sampleBehavior(),
            "2026-Q2",
            "2026-Q4"
        );

        String json = objectMapper.writeValueAsString(dto);

        // snake_case keys present (top-level + the inner block markers).
        assertThat(json).contains("\"behavior\"");
        assertThat(json).contains("\"type_text\"");
        assertThat(json).contains("\"description_md\"");
        assertThat(json).contains("\"valid_from\"");
        assertThat(json).contains("\"schema_version\"");
        assertThat(json).contains("\"source_hash\"");

        // NO camelCase leakage on the DTO's own fields (no @CamelCaseWire).
        assertThat(json).doesNotContain("typeText");
        assertThat(json).doesNotContain("descriptionMd");
        assertThat(json).doesNotContain("validFrom");
        assertThat(json).doesNotContain("validTo");

        // Round-trips back with the structured block + embedded confidence intact.
        BusinessLogicDto parsed = objectMapper.readValue(json, BusinessLogicDto.class);
        assertThat(parsed.behavior()).isNotNull();
        assertThat(parsed.behavior().get("schema_version")).isEqualTo("behaviour.v1");
        assertThat(parsed.behavior().get("method_id")).isEqualTo("com.foo.OwnerService#save(Owner)");
        // The embedded confidence parses back as a numeric (boxed) value, not a primitive default.
        Object confidence = parsed.behavior().get("confidence");
        assertThat(confidence).isInstanceOf(Double.class);
        assertThat(((Number) confidence).doubleValue()).isEqualTo(0.82);
    }

    @Test
    @DisplayName("A null behavior survives a PATCH-style mapper round-trip (boxed Map preserves null, no fabricated empty map)")
    void nullBehaviorSurvivesMapperRoundTrip() {
        String modelFileId = "mf-null-" + UUID.randomUUID();
        BusinessLogicDto dto = new BusinessLogicDto(
            "bl-null",
            "NoBehaviour",
            "CALCULATION",
            null,
            null,
            null,   // behavior absent
            null,
            null
        );

        BusinessLogicEntity back = entityMapper.toEntity(dto, modelFileId);
        assertThat(back.getBehavior()).isNull();

        BusinessLogicDto roundTripped = entityMapper.toDto(back);
        assertThat(roundTripped.behavior()).isNull();
    }
}
