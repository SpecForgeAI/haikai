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
 * Focused tests for the new {@code endpoints.response_contract} JSONB column
 * (Liquibase changeset {@code 168}) and its exposure on {@link EndpointDto}
 * (Spec: Per-endpoint response-contract capture for discovery, 2026-05-30 --
 * Task Group 1, sub-task 1.1).
 *
 * <p>Critical cases only (per the spec's 2-8 limit):</p>
 * <ol>
 *   <li>(a) An {@link EndpointEntity} carrying a populated
 *       {@code response_contract} block (incl. a boxed {@link Double}
 *       {@code confidence} and an internal {@code schema_version}) persists and
 *       re-reads as the SAME structured map (round-trip, no field loss).</li>
 *   <li>(b) A null {@code response_contract} round-trips cleanly -- an endpoint
 *       with no contract persists and reads back as {@code null} (additive +
 *       nullable).</li>
 *   <li>(c) Wire format: {@link EndpointDto} serializes the field under the
 *       {@code snake_case} key {@code "response_contract"}, the embedded
 *       {@code confidence: null} is preserved (NOT coerced to {@code 0.0}), and
 *       there is NO {@code @CamelCaseWire} leakage.</li>
 *   <li>DTO &harr; entity mapping via {@link EntityMapper} carries
 *       {@code response_contract} through in both directions (passthrough
 *       {@link Map}, no field loss), and a null block survives a PATCH-style
 *       mapper round-trip.</li>
 * </ol>
 *
 * <p>The {@code @DataJpaTest} slice mirrors
 * {@code EndpointProtocolMetadataPersistenceTest} and
 * {@code BusinessLogicBehaviorPersistenceTest}: an H2 PostgreSQL-mode DB with a
 * {@code CREATE DOMAIN JSONB AS JSON} INIT alias (H2 has no native JSONB) so the
 * {@code response_contract} column is created from the {@code @Type(JsonType.class)}
 * mapping under Hibernate {@code create-drop}. {@link EntityMapper} is a
 * dependency-free {@code @Component}, so the mapping / serialization cases simply
 * {@code new} it.</p>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:endpointresponsecontractdb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
})
class EndpointResponseContractPersistenceTest {

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
        modelFileId = "ep-rc-mf-" + UUID.randomUUID();
        ModelFileEntity mf = ModelFileEntity.builder()
            .id(modelFileId)
            .filename("endpoint-response-contract-test.json")
            .isDefault(false)
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .build();
        modelFileRepository.save(mf);
    }

    /** A representative populated response-contract block (loose JSONB). */
    private static Map<String, Object> sampleResponseContract() {
        Map<String, Object> errorResponse = new LinkedHashMap<>();
        errorResponse.put("exception", "com.foo.OrderNotFoundException");
        errorResponse.put("status", 404);
        errorResponse.put("body_shape", "{ \"error\": \"<message>\" }");
        errorResponse.put("source", "@ControllerAdvice com.foo.ApiErrorHandler#notFound");

        Map<String, Object> auth = new LinkedHashMap<>();
        auth.put("required_roles", List.of("ROLE_ADMIN"));
        auth.put("expected_unauthenticated_status", 401);
        auth.put("expected_forbidden_status", 403);
        auth.put("source", "@PreAuthorize");

        Map<String, Object> validationEntry = new LinkedHashMap<>();
        validationEntry.put("field", "quantity");
        validationEntry.put("constraint", "@Min(1)");
        validationEntry.put("failure_status", 400);
        validationEntry.put("message", "quantity must be at least {value}");

        Map<String, Object> serialization = new LinkedHashMap<>();
        serialization.put("null_handling", "NON_NULL omits nulls");
        serialization.put("date_format", "iso-8601");
        serialization.put("field_naming", "snake_case");
        serialization.put("envelope", "bare object");
        serialization.put("headers", List.of());

        Map<String, Object> statusCodes = new LinkedHashMap<>();
        statusCodes.put("success", 201);
        statusCodes.put("location_header", true);

        Map<String, Object> conditionalVariant = new LinkedHashMap<>();
        conditionalVariant.put("condition", "@Profile(\"legacy\")");
        conditionalVariant.put("response_summary", "wraps body in { data: ... }");

        Map<String, Object> provenance = new LinkedHashMap<>();
        provenance.put("source_files", List.of("src/main/java/com/foo/OrderController.java"));
        provenance.put("method_id", "com.foo.OrderController#create(OrderRequest)");
        provenance.put("advice_ids", List.of("com.foo.ApiErrorHandler#notFound"));

        Map<String, Object> contract = new LinkedHashMap<>();
        // Internal marker lives INSIDE the block (not a separate column).
        contract.put("schema_version", "response-contract.v1");
        contract.put("error_responses", List.of(errorResponse));
        contract.put("auth", auth);
        contract.put("validation", List.of(validationEntry));
        contract.put("serialization", serialization);
        contract.put("status_codes", statusCodes);
        contract.put("conditional_variants", List.of(conditionalVariant));
        contract.put("provenance", provenance);
        // Embedded confidence -- a DOUBLE inside the JSONB, mapped to a boxed
        // Double; never a top-level primitive column.
        contract.put("confidence", 0.74);
        return contract;
    }

    private EndpointEntity newEndpoint(String id, Map<String, Object> responseContract) {
        return EndpointEntity.builder()
            .id(id)
            .modelFileId(modelFileId)
            .interfaceId("ifc-rc")
            .name("Create Order")
            .endpointType("REST")
            .pathOrAddress("/api/orders")
            .protocol("HTTP")
            .operationVerb("POST")
            .direction("Inbound")
            .responseContract(responseContract)
            .build();
    }

    @Test
    @DisplayName("(a) A populated response_contract block persists and re-reads as the same structured map (no field loss; embedded confidence + schema_version preserved)")
    void roundTripPreservesStructuredResponseContract() {
        EndpointEntity entity = newEndpoint("ep-rc-1", sampleResponseContract());

        endpointRepository.save(entity);
        entityManager.flush();
        entityManager.clear();

        EndpointEntity reloaded = endpointRepository.findById("ep-rc-1").orElseThrow();
        Map<String, Object> contract = reloaded.getResponseContract();
        assertThat(contract).isNotNull();
        assertThat(contract.get("schema_version")).isEqualTo("response-contract.v1");

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> errorResponses =
            (List<Map<String, Object>>) contract.get("error_responses");
        assertThat(errorResponses).hasSize(1);
        assertThat(errorResponses.get(0)).containsEntry("exception", "com.foo.OrderNotFoundException");
        assertThat(((Number) errorResponses.get(0).get("status")).intValue()).isEqualTo(404);

        @SuppressWarnings("unchecked")
        Map<String, Object> auth = (Map<String, Object>) contract.get("auth");
        @SuppressWarnings("unchecked")
        List<String> requiredRoles = (List<String>) auth.get("required_roles");
        assertThat(requiredRoles).containsExactly("ROLE_ADMIN");
        assertThat(((Number) auth.get("expected_unauthenticated_status")).intValue()).isEqualTo(401);
        assertThat(((Number) auth.get("expected_forbidden_status")).intValue()).isEqualTo(403);

        @SuppressWarnings("unchecked")
        Map<String, Object> statusCodes = (Map<String, Object>) contract.get("status_codes");
        assertThat(((Number) statusCodes.get("success")).intValue()).isEqualTo(201);
        assertThat(statusCodes.get("location_header")).isEqualTo(Boolean.TRUE);

        // Embedded confidence survives as a numeric (boxed) value.
        assertThat(((Number) contract.get("confidence")).doubleValue()).isEqualTo(0.74);
    }

    @Test
    @DisplayName("(b) An endpoint with no response_contract persists and reads back as null (additive + nullable)")
    void nullResponseContractRoundTrips() {
        EndpointEntity entity = newEndpoint("ep-rc-null", null);

        endpointRepository.save(entity);
        entityManager.flush();
        entityManager.clear();

        EndpointEntity reloaded = endpointRepository.findById("ep-rc-null").orElseThrow();
        assertThat(reloaded.getResponseContract()).isNull();
        // Label-only columns are unaffected.
        assertThat(reloaded.getName()).isEqualTo("Create Order");
        assertThat(reloaded.getEndpointType()).isEqualTo("REST");
    }

    @Test
    @DisplayName("DTO <-> entity mapping carries response_contract through in both directions (passthrough Map, no field loss)")
    void mapperCarriesResponseContractBothDirections() {
        EndpointEntity entity = newEndpoint("ep-rc-map", sampleResponseContract());

        // entity -> DTO (the read path)
        EndpointDto dto = entityMapper.toDto(entity);
        assertThat(dto.id()).isEqualTo("ep-rc-map");
        assertThat(dto.responseContract()).isEqualTo(sampleResponseContract());

        // DTO -> entity (the write path; modelFileId injected by the mapper)
        EndpointEntity back = entityMapper.toEntity(dto, modelFileId);
        assertThat(back.getModelFileId()).isEqualTo(modelFileId);
        assertThat(back.getResponseContract()).isEqualTo(sampleResponseContract());
    }

    @Test
    @DisplayName("(c) Wire format: DTO serializes response_contract under the snake_case key; confidence:null is preserved (not coerced to 0.0); NO camelCase leakage")
    void dtoSerializesResponseContractToSnakeCaseWithNullConfidencePreserved() throws Exception {
        // Mirror the global AMS Jackson config
        // (spring.jackson.property-naming-strategy: SNAKE_CASE).
        ObjectMapper objectMapper = new ObjectMapper();
        objectMapper.setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);

        // A contract whose embedded confidence is explicitly null -- the static
        // pass left it unset. It MUST survive as null, never as 0.0.
        Map<String, Object> contract = new LinkedHashMap<>();
        contract.put("schema_version", "response-contract.v1");
        contract.put("status_codes", Map.of("success", 200, "location_header", false));
        contract.put("confidence", null);

        EndpointDto dto = new EndpointDto(
            "ep-rc-wire", "Create Order", "Creates an order", "ifc-rc", "REST",
            "/api/orders", "HTTP", "POST", "Inbound",
            null, null, null, null,
            null, contract
        );

        String json = objectMapper.writeValueAsString(dto);

        // snake_case key present (top-level + the inner block markers).
        assertThat(json).contains("\"response_contract\"");
        assertThat(json).contains("\"schema_version\"");
        assertThat(json).contains("\"status_codes\"");
        assertThat(json).contains("\"location_header\"");

        // confidence is emitted as null -- NOT coerced to 0.0.
        assertThat(json).contains("\"confidence\":null");
        assertThat(json).doesNotContain("\"confidence\":0.0");

        // NO @CamelCaseWire leakage on the DTO's own snake_case fields.
        assertThat(json).doesNotContain("responseContract");
        assertThat(json).doesNotContain("interfaceId");
        assertThat(json).doesNotContain("pathOrAddress");

        // Round-trips back with the structured block intact and confidence null.
        EndpointDto parsed = objectMapper.readValue(json, EndpointDto.class);
        assertThat(parsed.responseContract()).isNotNull();
        assertThat(parsed.responseContract().get("schema_version")).isEqualTo("response-contract.v1");
        assertThat(parsed.responseContract().containsKey("confidence")).isTrue();
        assertThat(parsed.responseContract().get("confidence")).isNull();
    }

    @Test
    @DisplayName("A null response_contract survives a PATCH-style mapper round-trip (boxed Map preserves null, no fabricated empty map)")
    void nullResponseContractSurvivesMapperRoundTrip() {
        EndpointDto dto = new EndpointDto(
            "ep-rc-patch", "Create Order", null, "ifc-rc", "REST",
            "/api/orders", "HTTP", "POST", "Inbound",
            null, null, null, null,
            null, null // response_contract absent on the wire
        );

        EndpointEntity back = entityMapper.toEntity(dto, modelFileId);
        assertThat(back.getResponseContract()).isNull();

        EndpointDto roundTripped = entityMapper.toDto(back);
        assertThat(roundTripped.responseContract()).isNull();
    }
}
