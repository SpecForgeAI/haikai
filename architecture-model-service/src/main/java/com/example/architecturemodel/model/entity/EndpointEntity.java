package com.example.architecturemodel.model.entity;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Type;

import java.util.Map;

@Entity
@Table(name = "endpoints")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class EndpointEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "interface_id", nullable = false)
    private String interfaceId;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "description")
    private String description;

    @Column(name = "endpoint_type")
    private String endpointType;

    @Column(name = "path_or_address")
    private String pathOrAddress;

    @Column(name = "protocol")
    private String protocol;

    @Column(name = "operation_verb")
    private String operationVerb;

    @Column(name = "direction")
    private String direction;

    @Column(name = "lifecycle_status")
    private String lifecycleStatus;

    @Column(name = "version")
    private String version;

    @Column(name = "tags")
    private String tags;

    @Column(name = "valid_from")
    private String validFrom;

    @Column(name = "valid_to")
    private String validTo;

    @Column(name = "request_data_entity_point_id")
    private String requestDataEntityPointId;

    @Column(name = "response_data_entity_point_id")
    private String responseDataEntityPointId;

    /**
     * Optional protocol-specific metadata blob. For SOAP endpoints this carries
     * {@code soap_action}, {@code request_root_element}, {@code request_namespace},
     * {@code response_root_element}, {@code request_dto_class},
     * {@code response_dto_class}, and {@code wsdl_source}.
     *
     * <p>Stored as a JSONB column. Boxed reference type ({@code Map}) so a PATCH
     * carrying no value preserves the existing column content (per
     * {@code project_primitive_double_dto_overwrite.md}); the update handler
     * MUST null-guard before assigning.</p>
     *
     * <p>Spec: SOAP Discovery -- Spring Classic Phase 1 (2026-05-17), D-5.</p>
     */
    @Type(JsonType.class)
    @Column(name = "protocol_metadata_json", columnDefinition = "jsonb")
    private Map<String, Object> protocolMetadataJson;

    /**
     * Per-endpoint RESPONSE CONTRACT block captured by the discovery
     * response-contract scanner: what response (status + body + headers) each
     * input produces. Top-level keys: {@code error_responses[]}, {@code auth},
     * {@code validation[]}, {@code serialization}, {@code status_codes},
     * {@code conditional_variants[]}, {@code provenance}, {@code confidence}.
     * JSONB blob; boxed reference type ({@link Map}) so a PATCH carrying no value
     * preserves the existing column content.
     *
     * <p>The block embeds its OWN internal {@code schema_version} -- it is NOT a
     * separate column, so the block shape evolves without a schema migration
     * (mirroring {@code BusinessLogicEntity.behavior} and Spec 1's
     * {@code EndpointDataEffectEntity.pathMetadataJson}). The embedded
     * {@code confidence} is a {@link Double} inside this map shape -- never a
     * top-level primitive column (a PATCH with no value preserves null rather
     * than wiping to 0.0; see {@code project_primitive_double_dto_overwrite.md}).</p>
     *
     * <p>Stored via the Hypersistence {@link JsonType}, the identical
     * JSONB-via-Hibernate idiom used by {@code protocolMetadataJson} /
     * {@code BusinessLogicEntity.behavior}. A null/absent block round-trips
     * cleanly (existing rows carry none -- additive + nullable).</p>
     *
     * <p>Spec: Per-endpoint response-contract capture for discovery
     * (2026-05-30) -- Task Group 1.</p>
     */
    @Type(JsonType.class)
    @Column(name = "response_contract", columnDefinition = "jsonb")
    private Map<String, Object> responseContract;

    /**
     * Per-endpoint REQUEST CONTRACT block captured by the discovery
     * request-contract scanner: how a correctly-formatted request to this
     * endpoint is constructed -- request content-type, required headers, request
     * param/field date-formats, and request-field validation -- mined from code
     * evidence. Top-level keys: {@code content_type}, {@code consumes[]},
     * {@code required_headers[]}, {@code param_formats[]},
     * {@code request_validation[]}, {@code provenance}, {@code confidence}.
     * JSONB blob; boxed reference type ({@link Map}) so a PATCH carrying no value
     * preserves the existing column content.
     *
     * <p>The block embeds its OWN internal {@code schema_version} -- it is NOT a
     * separate column, so the block shape evolves without a schema migration
     * (mirroring {@code responseContract}). The embedded {@code confidence} is a
     * {@link Double} inside this map shape -- never a top-level primitive column
     * (a PATCH with no value preserves null rather than wiping to 0.0; see
     * {@code project_primitive_double_dto_overwrite.md}).</p>
     *
     * <p>Stored via the Hypersistence {@link JsonType}, the identical
     * JSONB-via-Hibernate idiom used by {@code responseContract} /
     * {@code protocolMetadataJson}. A null/absent block round-trips cleanly
     * (existing rows carry none -- additive + nullable).</p>
     *
     * <p>Spec: Request Contract from Code Evidence (2026-06-19) -- Task Group 1.</p>
     */
    @Type(JsonType.class)
    @Column(name = "request_contract", columnDefinition = "jsonb")
    private Map<String, Object> requestContract;
}
