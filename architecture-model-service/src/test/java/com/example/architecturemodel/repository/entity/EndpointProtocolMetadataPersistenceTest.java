package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.dto.entity.EndpointDto;
import com.example.architecturemodel.model.entity.EndpointEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
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
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Persistence-layer tests for the new {@code endpoints.protocol_metadata_json}
 * JSONB column added by Liquibase changeset {@code 138}.
 *
 * <p>Spec: SOAP Discovery -- Spring Classic Phase 1 (2026-05-17), Task Group 9.</p>
 *
 * <p>Tests covered:</p>
 * <ol>
 *   <li>Liquibase changeset 138 applies cleanly to an existing populated
 *       {@code endpoints} table -- existing rows backfill to NULL. Verified
 *       here by inserting an {@link EndpointEntity} without
 *       {@code protocolMetadataJson} set and confirming the column is NULL on
 *       reload. (The H2 test DB rebuilds schema from JPA annotations rather
 *       than Liquibase, so the &quot;applies cleanly on populated table&quot;
 *       contract is enforced by Hibernate's nullable mapping -- same pattern
 *       used by {@code ApiBehaviourPersistenceTest}.)</li>
 *   <li>An {@link EndpointEntity} with {@code protocolMetadataJson} set
 *       round-trips through persist + reload (JSONB content matches).</li>
 *   <li>PATCH semantics: when a DTO carrying {@code protocolMetadataJson=null}
 *       is mapped onto a loaded entity, the existing JSONB column content is
 *       NOT wiped (boxed reference type + null-guard pattern per
 *       {@code project_primitive_double_dto_overwrite.md}).</li>
 * </ol>
 *
 * <p>The H2 PostgreSQL-mode test DB does not natively understand JSONB, so a
 * {@code CREATE DOMAIN JSONB AS JSON} INIT alias is registered on the JDBC
 * URL -- same pattern used by {@code ApiBehaviourPersistenceTest} and
 * {@code ServiceTechHintsResolvedPersistenceTest}.</p>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:endpointprotocolmetadb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
})
class EndpointProtocolMetadataPersistenceTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private EndpointRepository endpointRepository;

    @Autowired
    private ModelFileRepository modelFileRepository;

    private String modelFileId;

    @BeforeEach
    void setUp() {
        modelFileId = "ep-protometa-mf-" + UUID.randomUUID();
        ModelFileEntity mf = ModelFileEntity.builder()
            .id(modelFileId)
            .filename("endpoint-protocol-meta-test.json")
            .isDefault(false)
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .build();
        modelFileRepository.save(mf);
    }

    @Test
    @DisplayName("Existing endpoint rows backfill to NULL on the new protocol_metadata_json column")
    void existingRowsBackfillToNull() {
        EndpointEntity legacy = EndpointEntity.builder()
            .id("ep-legacy-1")
            .modelFileId(modelFileId)
            .interfaceId("ifc-legacy")
            .name("Legacy REST endpoint")
            .endpointType("REST")
            .pathOrAddress("/api/legacy")
            .protocol("HTTP")
            .operationVerb("GET")
            .direction("Inbound")
            .build();
        // Note: protocolMetadataJson left unset -- mirrors the post-migration
        // state of every row that existed before changeset 138 was applied.
        endpointRepository.save(legacy);
        entityManager.flush();
        entityManager.clear();

        EndpointEntity reloaded = endpointRepository.findById("ep-legacy-1").orElseThrow();
        assertThat(reloaded.getProtocolMetadataJson()).isNull();
        assertThat(reloaded.getName()).isEqualTo("Legacy REST endpoint");
    }

    @Test
    @DisplayName("Endpoint with protocolMetadataJson set round-trips through persist + reload")
    void protocolMetadataRoundTrips() {
        Map<String, Object> soapMeta = new LinkedHashMap<>();
        soapMeta.put("soap_action", "getCountry");
        soapMeta.put("request_root_element", "getCountryRequest");
        soapMeta.put("request_namespace", "https://spring.io/guides/gs-producing-web-service");
        soapMeta.put("response_root_element", "getCountryResponse");
        soapMeta.put("request_dto_class", "io.spring.guides.gs_producing_web_service.GetCountryRequest");
        soapMeta.put("response_dto_class", "io.spring.guides.gs_producing_web_service.GetCountryResponse");
        soapMeta.put("wsdl_source", "src/main/resources/countries.wsdl");

        EndpointEntity soapEndpoint = EndpointEntity.builder()
            .id("ep-soap-1")
            .modelFileId(modelFileId)
            .interfaceId("ifc-soap")
            .name("getCountry")
            .endpointType("SOAP")
            .pathOrAddress("/ws")
            .protocol("HTTP")
            .operationVerb("POST")
            .direction("Inbound")
            .protocolMetadataJson(soapMeta)
            .build();

        endpointRepository.save(soapEndpoint);
        entityManager.flush();
        entityManager.clear();

        EndpointEntity reloaded = endpointRepository.findById("ep-soap-1").orElseThrow();
        Map<String, Object> reloadedMeta = reloaded.getProtocolMetadataJson();
        assertThat(reloadedMeta).isNotNull();
        assertThat(reloadedMeta).containsEntry("soap_action", "getCountry");
        assertThat(reloadedMeta).containsEntry("request_root_element", "getCountryRequest");
        assertThat(reloadedMeta).containsEntry("request_namespace",
            "https://spring.io/guides/gs-producing-web-service");
        assertThat(reloadedMeta).containsEntry("response_root_element", "getCountryResponse");
        assertThat(reloadedMeta).containsEntry("request_dto_class",
            "io.spring.guides.gs_producing_web_service.GetCountryRequest");
        assertThat(reloadedMeta).containsEntry("response_dto_class",
            "io.spring.guides.gs_producing_web_service.GetCountryResponse");
        assertThat(reloadedMeta).containsEntry("wsdl_source", "src/main/resources/countries.wsdl");
    }

    /**
     * PATCH semantics: when a DTO comes in with {@code protocolMetadataJson=null}
     * (the JSON field was omitted on the wire), the existing column content
     * MUST NOT be wiped to NULL. We model the null-guard pattern at the call
     * site -- callers MUST null-check before assigning, mirroring
     * {@code ApiBehaviourOperationService.update}.
     *
     * <p>The DTO field is a boxed reference type ({@link Map}) -- not a Java
     * primitive -- so Jackson maps a missing JSON property to {@code null},
     * giving the call site the chance to null-guard. See
     * {@code project_primitive_double_dto_overwrite.md}.</p>
     */
    @Test
    @DisplayName("PATCH with protocol_metadata_json omitted (DTO field null) does not wipe the column")
    void patchOmittedFieldDoesNotWipeColumn() {
        Map<String, Object> originalMeta = new LinkedHashMap<>();
        originalMeta.put("soap_action", "greet");
        originalMeta.put("request_root_element", "greet");

        EndpointEntity persisted = EndpointEntity.builder()
            .id("ep-patch-1")
            .modelFileId(modelFileId)
            .interfaceId("ifc-patch")
            .name("greet")
            .endpointType("SOAP")
            .pathOrAddress("/ws/greetings")
            .protocol("HTTP")
            .operationVerb("POST")
            .direction("Inbound")
            .protocolMetadataJson(originalMeta)
            .build();
        endpointRepository.save(persisted);
        entityManager.flush();
        entityManager.clear();

        EndpointEntity loaded = endpointRepository.findById("ep-patch-1").orElseThrow();
        assertThat(loaded.getProtocolMetadataJson()).containsEntry("soap_action", "greet");

        // Simulate a PATCH request with `protocol_metadata_json` omitted on the
        // wire -- Jackson maps it to a null reference on the boxed DTO field.
        EndpointDto patchDto = new EndpointDto(
            loaded.getId(),
            "greet (renamed)",
            loaded.getDescription(),
            loaded.getInterfaceId(),
            loaded.getEndpointType(),
            loaded.getPathOrAddress(),
            loaded.getProtocol(),
            loaded.getOperationVerb(),
            loaded.getDirection(),
            loaded.getValidFrom(),
            loaded.getValidTo(),
            loaded.getRequestDataEntityPointId(),
            loaded.getResponseDataEntityPointId(),
            null, // protocol_metadata_json omitted on the wire
            null  // response_contract omitted on the wire
        );

        // Null-guard pattern: only assign when present on the DTO. This is the
        // same pattern used by ApiBehaviourOperationService.update for the
        // request_schema_json / response_schema_json JSONB columns.
        loaded.setName(patchDto.name());
        if (patchDto.protocolMetadataJson() != null) {
            loaded.setProtocolMetadataJson(patchDto.protocolMetadataJson());
        }

        endpointRepository.save(loaded);
        entityManager.flush();
        entityManager.clear();

        EndpointEntity reloaded = endpointRepository.findById("ep-patch-1").orElseThrow();
        assertThat(reloaded.getName()).isEqualTo("greet (renamed)");
        // Critical: column content survived the patch even though the DTO
        // field was null.
        assertThat(reloaded.getProtocolMetadataJson()).isNotNull();
        assertThat(reloaded.getProtocolMetadataJson()).containsEntry("soap_action", "greet");
        assertThat(reloaded.getProtocolMetadataJson()).containsEntry("request_root_element", "greet");
    }
}
