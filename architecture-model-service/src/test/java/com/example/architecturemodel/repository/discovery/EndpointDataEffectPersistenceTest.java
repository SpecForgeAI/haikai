package com.example.architecturemodel.repository.discovery;

import com.example.architecturemodel.mapper.discovery.EndpointDataEffectMapper;
import com.example.architecturemodel.model.dto.discovery.EndpointDataEffectDto;
import com.example.architecturemodel.model.entity.discovery.EndpointDataEffectEntity;
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
 * Focused tests for the new {@code endpoint_data_effects} relationship surface
 * (Spec: Endpoint&rarr;Data-Effect Call Graph for Discovery, 2026-05-29 -- Task
 * Group 1, sub-task 1.1).
 *
 * <p>Critical cases only (4-6 max per the spec):</p>
 * <ol>
 *   <li>Repository round-trip: persist a row
 *       ({@code endpoint_id} &rarr; {@code data_entity_point_id} +
 *       {@code access_mode} + JSONB {@code path_metadata_json}) and read it
 *       back; the structured payload survives.</li>
 *   <li>{@code findByModelFileId} / {@code findByEndpointId} return the
 *       expected rows; {@code deleteByModelFileId} removes them (model-file
 *       scoping).</li>
 *   <li>{@code access_mode} accepts each of {@code read} / {@code write} /
 *       {@code read-write} (no DB-level enum constraint).</li>
 *   <li>DTO &harr; entity mapping preserves {@code access_mode},
 *       {@code confidence}, and the structured {@code path_metadata_json}
 *       payload (no field loss, both directions).</li>
 *   <li>Wire format is {@code snake_case} end-to-end (serialize the DTO; assert
 *       snake_case keys; assert NO camelCase leakage).</li>
 * </ol>
 *
 * <p>The {@code @DataJpaTest} slice uses the same H2 PostgreSQL-mode setup as
 * {@code DiscoveryFindingPersistenceTest}: a {@code CREATE DOMAIN JSONB AS JSON}
 * INIT alias (H2 has no native JSONB) and an explicit {@code org.h2.Driver}
 * override. The mapper / serialization cases use plain {@code new}'d objects
 * (no injected beans), mirroring the global
 * {@code spring.jackson.property-naming-strategy: SNAKE_CASE}.</p>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:endpointdataeffectsdb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON",
    "spring.datasource.driver-class-name=org.h2.Driver",
    "spring.datasource.username=sa",
    "spring.datasource.password=",
    "spring.liquibase.enabled=false",
    "spring.jpa.hibernate.ddl-auto=create-drop",
    "spring.jpa.properties.hibernate.dialect=org.hibernate.dialect.H2Dialect"
})
class EndpointDataEffectPersistenceTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private EndpointDataEffectRepository repository;

    /** A representative structured path-metadata payload (ordered hop list + hint + flag). */
    private static Map<String, Object> samplePathMetadata() {
        Map<String, Object> hop1 = new LinkedHashMap<>();
        hop1.put("fqn", "com.foo.OwnerController");
        hop1.put("method", "create(Owner)");
        Map<String, Object> hop2 = new LinkedHashMap<>();
        hop2.put("fqn", "com.foo.OwnerService");
        hop2.put("method", "save(Owner)");
        Map<String, Object> hop3 = new LinkedHashMap<>();
        hop3.put("fqn", "com.foo.OwnerRepository");
        hop3.put("method", "save(Owner)");

        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("hops", List.of(hop1, hop2, hop3));
        meta.put("operation_hint", "insert");
        meta.put("transactional", true);
        return meta;
    }

    private EndpointDataEffectEntity newEffect(String modelFileId, String endpointId,
                                               String dataEntityPointId, String accessMode,
                                               Double confidence) {
        return EndpointDataEffectEntity.builder()
            .id("ede-" + UUID.randomUUID())
            .modelFileId(modelFileId)
            .endpointId(endpointId)
            .dataEntityPointId(dataEntityPointId)
            .accessMode(accessMode)
            .pathMetadataJson(samplePathMetadata())
            .confidence(confidence)
            .description("OwnerController.create reads/writes Owner")
            .tags("discovery")
            .build();
    }

    @Test
    @DisplayName("Round-trip: persist endpoint_id -> data_entity_point_id + access_mode + JSONB path_metadata_json and read it back")
    void roundTripPreservesStructuredPayload() {
        String modelFileId = "mf-" + UUID.randomUUID();
        EndpointDataEffectEntity entity = newEffect(
            modelFileId, "endpoint-1", "dep_log_owner", "write", 0.92);

        EndpointDataEffectEntity saved = repository.saveAndFlush(entity);
        entityManager.clear();

        EndpointDataEffectEntity reloaded =
            repository.findById(saved.getId()).orElseThrow();

        assertThat(reloaded.getEndpointId()).isEqualTo("endpoint-1");
        assertThat(reloaded.getDataEntityPointId()).isEqualTo("dep_log_owner");
        assertThat(reloaded.getAccessMode()).isEqualTo("write");
        assertThat(reloaded.getConfidence()).isEqualTo(0.92);
        // Structured JSONB payload survives the round-trip with no field loss.
        Map<String, Object> meta = reloaded.getPathMetadataJson();
        assertThat(meta).isNotNull();
        assertThat(meta.get("operation_hint")).isEqualTo("insert");
        assertThat(meta.get("transactional")).isEqualTo(true);
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> hops = (List<Map<String, Object>>) meta.get("hops");
        assertThat(hops).hasSize(3);
        assertThat(hops.get(1).get("fqn")).isEqualTo("com.foo.OwnerService");
        assertThat(hops.get(1).get("method")).isEqualTo("save(Owner)");
    }

    @Test
    @DisplayName("findByModelFileId / findByEndpointId return expected rows; deleteByModelFileId removes them (model-file scoping)")
    void modelFileScopingQueriesAndDelete() {
        String modelA = "mf-A-" + UUID.randomUUID();
        String modelB = "mf-B-" + UUID.randomUUID();

        // Two rows in model A (one endpoint touched twice -> two data entities),
        // one row in model B (separate scope).
        repository.saveAndFlush(newEffect(modelA, "ep-A", "dep_log_owner", "read", 0.8));
        repository.saveAndFlush(newEffect(modelA, "ep-A", "dep_log_visit", "write", 0.8));
        repository.saveAndFlush(newEffect(modelB, "ep-B", "dep_log_pet", "read-write", 0.8));
        entityManager.clear();

        assertThat(repository.findByModelFileId(modelA)).hasSize(2);
        assertThat(repository.findByModelFileId(modelB)).hasSize(1);

        // findByEndpointId is endpoint-scoped (the two ep-A rows).
        assertThat(repository.findByEndpointId("ep-A")).hasSize(2);
        assertThat(repository.findByEndpointId("ep-B")).hasSize(1);

        // deleteByModelFileId removes ONLY model A's rows; model B is untouched.
        repository.deleteByModelFileId(modelA);
        entityManager.flush();
        entityManager.clear();
        assertThat(repository.findByModelFileId(modelA)).isEmpty();
        assertThat(repository.findByModelFileId(modelB)).hasSize(1);
    }

    @Test
    @DisplayName("access_mode accepts each of read / write / read-write (no DB-level enum constraint)")
    void accessModeAcceptsAllThreeValues() {
        String modelFileId = "mf-" + UUID.randomUUID();
        for (String mode : List.of("read", "write", "read-write")) {
            EndpointDataEffectEntity saved = repository.saveAndFlush(
                newEffect(modelFileId, "ep-" + mode, "dep_log_owner", mode, 0.75));
            entityManager.clear();
            EndpointDataEffectEntity reloaded =
                repository.findById(saved.getId()).orElseThrow();
            assertThat(reloaded.getAccessMode()).isEqualTo(mode);
        }
        assertThat(repository.findByModelFileId(modelFileId)).hasSize(3);
    }

    @Test
    @DisplayName("DTO <-> entity mapping preserves access_mode, confidence, and the structured path_metadata_json payload (no field loss)")
    void mapperPreservesAllFieldsBothDirections() {
        String modelFileId = "mf-map-" + UUID.randomUUID();
        EndpointDataEffectEntity entity = newEffect(
            modelFileId, "ep-map", "dep_phy_owner", "read-write", 0.61);
        entity.setValidFrom("2026-Q2");
        entity.setValidTo("2026-Q4");

        // entity -> DTO
        EndpointDataEffectDto dto = EndpointDataEffectMapper.toDto(entity);
        assertThat(dto.id()).isEqualTo(entity.getId());
        assertThat(dto.endpointId()).isEqualTo("ep-map");
        assertThat(dto.dataEntityPointId()).isEqualTo("dep_phy_owner");
        assertThat(dto.accessMode()).isEqualTo("read-write");
        assertThat(dto.confidence()).isEqualTo(0.61);
        assertThat(dto.pathMetadataJson()).isEqualTo(samplePathMetadata());
        assertThat(dto.description()).isEqualTo("OwnerController.create reads/writes Owner");
        assertThat(dto.tags()).isEqualTo("discovery");
        assertThat(dto.validFrom()).isEqualTo("2026-Q2");
        assertThat(dto.validTo()).isEqualTo("2026-Q4");

        // DTO -> entity (modelFileId injected by the mapper, not carried on the DTO)
        EndpointDataEffectEntity back = EndpointDataEffectMapper.toEntity(dto, modelFileId);
        assertThat(back.getModelFileId()).isEqualTo(modelFileId);
        assertThat(back.getEndpointId()).isEqualTo("ep-map");
        assertThat(back.getDataEntityPointId()).isEqualTo("dep_phy_owner");
        assertThat(back.getAccessMode()).isEqualTo("read-write");
        assertThat(back.getConfidence()).isEqualTo(0.61);
        assertThat(back.getPathMetadataJson()).isEqualTo(samplePathMetadata());
        assertThat(back.getValidFrom()).isEqualTo("2026-Q2");
        assertThat(back.getValidTo()).isEqualTo("2026-Q4");
    }

    @Test
    @DisplayName("Wire format is snake_case end-to-end: serialize the DTO, assert snake_case keys, assert NO camelCase leakage")
    void dtoSerializesToSnakeCaseOnly() throws Exception {
        // Mirror the global AMS Jackson config
        // (spring.jackson.property-naming-strategy: SNAKE_CASE).
        ObjectMapper objectMapper = new ObjectMapper();
        objectMapper.setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);

        EndpointDataEffectDto dto = new EndpointDataEffectDto(
            "ede-1",
            "endpoint-1",
            "dep_log_owner",
            "read-write",
            samplePathMetadata(),
            0.88,
            "desc",
            "tag",
            "2026-Q2",
            "2026-Q4"
        );

        String json = objectMapper.writeValueAsString(dto);

        // snake_case keys present.
        assertThat(json).contains("\"endpoint_id\"");
        assertThat(json).contains("\"data_entity_point_id\"");
        assertThat(json).contains("\"access_mode\"");
        assertThat(json).contains("\"path_metadata_json\"");
        assertThat(json).contains("\"valid_from\"");
        assertThat(json).contains("\"valid_to\"");

        // NO camelCase leakage.
        assertThat(json).doesNotContain("endpointId");
        assertThat(json).doesNotContain("dataEntityPointId");
        assertThat(json).doesNotContain("accessMode");
        assertThat(json).doesNotContain("pathMetadataJson");
        assertThat(json).doesNotContain("validFrom");
        assertThat(json).doesNotContain("validTo");

        // Round-trips back (deserialize) with the structured payload intact.
        EndpointDataEffectDto parsed = objectMapper.readValue(json, EndpointDataEffectDto.class);
        assertThat(parsed.endpointId()).isEqualTo("endpoint-1");
        assertThat(parsed.dataEntityPointId()).isEqualTo("dep_log_owner");
        assertThat(parsed.accessMode()).isEqualTo("read-write");
        assertThat(parsed.confidence()).isEqualTo(0.88);
        assertThat(parsed.pathMetadataJson()).containsEntry("operation_hint", "insert");
    }
}
