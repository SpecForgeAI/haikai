package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.mapper.EntityMapper;
import com.example.architecturemodel.model.dto.entity.EndpointDto;
import com.example.architecturemodel.model.entity.EndpointEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Focused tests for the new {@code endpoints.request_contract} JSONB column
 * (Liquibase changeset {@code 194}) and its exposure on {@link EndpointDto}
 * (Spec: Request Contract from Code Evidence, 2026-06-19 -- Task Group 1, sub-task
 * 1.1). Mirrors {@code EndpointResponseContractPersistenceTest} -- the direct
 * {@code response_contract} precedent this work clones.
 *
 * <p>Critical cases only (per the spec's 2-8 limit):</p>
 * <ol>
 *   <li>(a) An {@link EndpointEntity} carrying a populated {@code request_contract}
 *       block (content_type / consumes[] / required_headers[] / param_formats[] /
 *       request_validation[], a boxed {@link Double} {@code confidence}, and an
 *       internal {@code schema_version}) persists and re-reads as the SAME
 *       structured map (round-trip, no field loss).</li>
 *   <li>(b) A null {@code request_contract} round-trips cleanly (additive +
 *       nullable).</li>
 *   <li>(c) Wire format: {@link EndpointDto} serializes the field under the
 *       {@code snake_case} key {@code "request_contract"}, with NO
 *       {@code @CamelCaseWire} leakage.</li>
 *   <li>DTO &harr; entity mapping via {@link EntityMapper} carries
 *       {@code request_contract} through in both directions (no field loss).</li>
 * </ol>
 *
 * <p>The {@code @DataJpaTest} slice mirrors
 * {@code EndpointResponseContractPersistenceTest}: an H2 PostgreSQL-mode DB with a
 * {@code CREATE DOMAIN JSONB AS JSON} INIT alias (H2 has no native JSONB) so the
 * {@code request_contract} column is created from the {@code @Type(JsonType.class)}
 * mapping under Hibernate {@code create-drop}.</p>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:endpointrequestcontractdb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
})
class EndpointRequestContractPersistenceTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private EndpointRepository endpointRepository;

    @Autowired
    private ModelFileRepository modelFileRepository;

    private final EntityMapper entityMapper = new EntityMapper();

    private String modelFileId;

    @BeforeEach
    void setUp() {
        modelFileId = "ep-qc-mf-" + UUID.randomUUID();
        ModelFileEntity mf = ModelFileEntity.builder()
            .id(modelFileId)
            .filename("endpoint-request-contract-test.json")
            .isDefault(false)
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .build();
        modelFileRepository.save(mf);
    }

    /** A representative populated request-contract block (loose JSONB). */
    private static Map<String, Object> sampleRequestContract() {
        Map<String, Object> requiredHeader = new LinkedHashMap<>();
        requiredHeader.put("name", "X-Correlation-Id");
        requiredHeader.put("source", "@RequestHeader(required = true)");

        Map<String, Object> paramFormat = new LinkedHashMap<>();
        paramFormat.put("name", "businessDate");
        paramFormat.put("location", "query");
        paramFormat.put("format", "dd-MMM-yyyy");
        paramFormat.put("pattern", "dd-MMM-yyyy");
        paramFormat.put("source", "@DateTimeFormat(pattern = \"dd-MMM-yyyy\")");

        Map<String, Object> validationEntry = new LinkedHashMap<>();
        validationEntry.put("field", "quantity");
        validationEntry.put("constraint", "@Min(1)");
        validationEntry.put("failure_status", 400);
        validationEntry.put("message", "quantity must be at least {value}");

        Map<String, Object> provenance = new LinkedHashMap<>();
        provenance.put("source_files", List.of("src/main/java/com/foo/OrderController.java"));
        provenance.put("method_id", "com.foo.OrderController#create(OrderRequest)");

        Map<String, Object> contract = new LinkedHashMap<>();
        // Internal marker lives INSIDE the block (not a separate column).
        contract.put("schema_version", "request_contract.v1");
        contract.put("content_type", "application/json");
        contract.put("consumes", List.of("application/json"));
        contract.put("required_headers", List.of(requiredHeader));
        contract.put("param_formats", List.of(paramFormat));
        contract.put("request_validation", List.of(validationEntry));
        contract.put("provenance", provenance);
        // Embedded confidence -- a DOUBLE inside the JSONB, mapped to a boxed
        // Double; never a top-level primitive column.
        contract.put("confidence", 0.81);
        return contract;
    }

    private EndpointEntity newEndpoint(String id, Map<String, Object> requestContract) {
        return EndpointEntity.builder()
            .id(id)
            .modelFileId(modelFileId)
            .interfaceId("ifc-qc")
            .name("Create Order")
            .endpointType("REST")
            .pathOrAddress("/api/orders")
            .protocol("HTTP")
            .operationVerb("POST")
            .direction("Inbound")
            .requestContract(requestContract)
            .build();
    }

    @Test
    @DisplayName("(a) A populated request_contract block persists and re-reads as the same structured map (no field loss; embedded confidence + schema_version preserved)")
    void roundTripPreservesStructuredRequestContract() {
        EndpointEntity entity = newEndpoint("ep-qc-1", sampleRequestContract());

        endpointRepository.save(entity);
        entityManager.flush();
        entityManager.clear();

        EndpointEntity reloaded = endpointRepository.findById("ep-qc-1").orElseThrow();
        Map<String, Object> contract = reloaded.getRequestContract();
        assertThat(contract).isNotNull();
        assertThat(contract.get("schema_version")).isEqualTo("request_contract.v1");
        assertThat(contract.get("content_type")).isEqualTo("application/json");

        @SuppressWarnings("unchecked")
        List<String> consumes = (List<String>) contract.get("consumes");
        assertThat(consumes).containsExactly("application/json");

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> requiredHeaders =
            (List<Map<String, Object>>) contract.get("required_headers");
        assertThat(requiredHeaders).hasSize(1);
        assertThat(requiredHeaders.get(0)).containsEntry("name", "X-Correlation-Id");

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> paramFormats =
            (List<Map<String, Object>>) contract.get("param_formats");
        assertThat(paramFormats).hasSize(1);
        assertThat(paramFormats.get(0)).containsEntry("name", "businessDate");
        assertThat(paramFormats.get(0)).containsEntry("format", "dd-MMM-yyyy");

        // Embedded confidence survives as a numeric (boxed) value.
        assertThat(((Number) contract.get("confidence")).doubleValue()).isEqualTo(0.81);
    }

    @Test
    @DisplayName("(b) An endpoint with no request_contract persists and reads back as null (additive + nullable)")
    void nullRequestContractRoundTrips() {
        EndpointEntity entity = newEndpoint("ep-qc-null", null);

        endpointRepository.save(entity);
        entityManager.flush();
        entityManager.clear();

        EndpointEntity reloaded = endpointRepository.findById("ep-qc-null").orElseThrow();
        assertThat(reloaded.getRequestContract()).isNull();
        // Label-only columns are unaffected.
        assertThat(reloaded.getName()).isEqualTo("Create Order");
        assertThat(reloaded.getEndpointType()).isEqualTo("REST");
    }

    @Test
    @DisplayName("DTO <-> entity mapping carries request_contract through in both directions (passthrough Map, no field loss); the response_contract passthrough is unaffected")
    void mapperCarriesRequestContractBothDirections() {
        EndpointEntity entity = newEndpoint("ep-qc-map", sampleRequestContract());
        // Also set a response_contract to confirm the sibling passthrough is intact.
        entity.setResponseContract(Map.of("schema_version", "response-contract.v1"));

        // entity -> DTO (the read path)
        EndpointDto dto = entityMapper.toDto(entity);
        assertThat(dto.id()).isEqualTo("ep-qc-map");
        assertThat(dto.requestContract()).isEqualTo(sampleRequestContract());
        assertThat(dto.responseContract())
            .isEqualTo(Map.of("schema_version", "response-contract.v1"));

        // DTO -> entity (the write path; modelFileId injected by the mapper)
        EndpointEntity back = entityMapper.toEntity(dto, modelFileId);
        assertThat(back.getModelFileId()).isEqualTo(modelFileId);
        assertThat(back.getRequestContract()).isEqualTo(sampleRequestContract());
        assertThat(back.getResponseContract())
            .isEqualTo(Map.of("schema_version", "response-contract.v1"));
    }

    @Test
    @DisplayName("(c) Wire format: DTO serializes request_contract under the snake_case key; NO camelCase leakage; round-trips intact")
    void dtoSerializesRequestContractToSnakeCase() throws Exception {
        // Mirror the global AMS Jackson config
        // (spring.jackson.property-naming-strategy: SNAKE_CASE).
        ObjectMapper objectMapper = new ObjectMapper();
        objectMapper.setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);

        Map<String, Object> contract = new LinkedHashMap<>();
        contract.put("schema_version", "request_contract.v1");
        contract.put("content_type", "application/json");
        contract.put("confidence", null);

        // Canonical 16-arg constructor: requestContract is the final argument.
        EndpointDto dto = new EndpointDto(
            "ep-qc-wire", "Create Order", "Creates an order", "ifc-qc", "REST",
            "/api/orders", "HTTP", "POST", "Inbound",
            null, null, null, null,
            null, null, contract
        );

        String json = objectMapper.writeValueAsString(dto);

        // snake_case key present (top-level + the inner block markers).
        assertThat(json).contains("\"request_contract\"");
        assertThat(json).contains("\"schema_version\"");
        assertThat(json).contains("\"content_type\"");

        // confidence is emitted as null -- NOT coerced to 0.0 (boxed Double).
        assertThat(json).contains("\"confidence\":null");
        assertThat(json).doesNotContain("\"confidence\":0.0");

        // NO @CamelCaseWire leakage on the DTO's own snake_case fields.
        assertThat(json).doesNotContain("requestContract");
        assertThat(json).doesNotContain("interfaceId");
        assertThat(json).doesNotContain("pathOrAddress");

        // Round-trips back with the structured block intact.
        EndpointDto parsed = objectMapper.readValue(json, EndpointDto.class);
        assertThat(parsed.requestContract()).isNotNull();
        assertThat(parsed.requestContract().get("schema_version")).isEqualTo("request_contract.v1");
        assertThat(parsed.requestContract().get("content_type")).isEqualTo("application/json");
    }

    @Test
    @DisplayName("A null request_contract survives a PATCH-style mapper round-trip (boxed Map preserves null, no fabricated empty map)")
    void nullRequestContractSurvivesMapperRoundTrip() {
        // Backward-compatible 15-arg constructor (no requestContract) -> null block.
        EndpointDto dto = new EndpointDto(
            "ep-qc-patch", "Create Order", null, "ifc-qc", "REST",
            "/api/orders", "HTTP", "POST", "Inbound",
            null, null, null, null,
            null, null
        );
        assertThat(dto.requestContract()).isNull();

        EndpointEntity back = entityMapper.toEntity(dto, modelFileId);
        assertThat(back.getRequestContract()).isNull();

        EndpointDto roundTripped = entityMapper.toDto(back);
        assertThat(roundTripped.requestContract()).isNull();
    }
}
