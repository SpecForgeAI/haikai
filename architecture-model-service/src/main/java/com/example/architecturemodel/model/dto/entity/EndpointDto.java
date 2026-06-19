package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;

public record EndpointDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("name")
    String name,

    @JsonProperty("description")
    String description,

    @JsonProperty("interface_id")
    String interfaceId,

    @JsonProperty("endpoint_type")
    String endpointType,

    @JsonProperty("path_or_address")
    String pathOrAddress,

    @JsonProperty("protocol")
    String protocol,

    @JsonProperty("operation_verb")
    String operationVerb,

    @JsonProperty("direction")
    String direction,

    @JsonProperty("valid_from")
    String validFrom,

    @JsonProperty("valid_to")
    String validTo,

    @JsonProperty("request_data_entity_point_id")
    String requestDataEntityPointId,

    @JsonProperty("response_data_entity_point_id")
    String responseDataEntityPointId,

    /**
     * Optional protocol-specific metadata blob (JSONB column on the
     * {@code endpoints} table). Carries SOAP {@code soap_action},
     * {@code request_root_element}, {@code request_namespace},
     * {@code response_root_element}, {@code request_dto_class},
     * {@code response_dto_class}, and {@code wsdl_source}.
     *
     * <p>Reference type so an omitted field on PATCH does NOT overwrite the
     * existing column to {@code null}. PATCH handlers MUST null-guard before
     * applying (per {@code project_primitive_double_dto_overwrite.md}).</p>
     *
     * <p>Spec: SOAP Discovery -- Spring Classic Phase 1 (2026-05-17), D-5.</p>
     */
    @JsonProperty("protocol_metadata_json")
    Map<String, Object> protocolMetadataJson,

    /**
     * Per-endpoint RESPONSE CONTRACT blob (JSONB column on the {@code endpoints}
     * table): what response (status + body + headers) each input produces.
     * Top-level keys {@code error_responses[]}, {@code auth}, {@code validation[]},
     * {@code serialization}, {@code status_codes}, {@code conditional_variants[]},
     * {@code provenance}, and a boxed {@link Double} {@code confidence}; the block
     * embeds its own internal {@code schema_version} so its shape can evolve with
     * no further migration.
     *
     * <p>Passthrough {@link Map} (reference type) so an omitted field on PATCH
     * does NOT overwrite the existing column to {@code null}, and so the embedded
     * {@code confidence} stays a boxed {@link Double} rather than wiping to 0.0
     * (per {@code project_primitive_double_dto_overwrite.md}). snake_case wire key
     * {@code "response_contract"}; consistent with this DTO's snake_case
     * convention -- there is intentionally NO {@code @CamelCaseWire}.</p>
     *
     * <p>Spec: Per-endpoint response-contract capture for discovery
     * (2026-05-30) -- Task Group 1.</p>
     */
    @JsonProperty("response_contract")
    Map<String, Object> responseContract,

    /**
     * Per-endpoint REQUEST CONTRACT blob (JSONB column on the {@code endpoints}
     * table): how a correctly-formatted request is constructed -- request
     * content-type, required headers, request param/field date-formats, and
     * request-field validation -- mined from code evidence. Top-level keys
     * {@code content_type}, {@code consumes[]}, {@code required_headers[]},
     * {@code param_formats[]}, {@code request_validation[]}, {@code provenance},
     * and a boxed {@link Double} {@code confidence}; the block embeds its own
     * internal {@code schema_version} so its shape can evolve with no further
     * migration.
     *
     * <p>Passthrough {@link Map} (reference type) so an omitted field on PATCH
     * does NOT overwrite the existing column to {@code null}, and so the embedded
     * {@code confidence} stays a boxed {@link Double} rather than wiping to 0.0
     * (per {@code project_primitive_double_dto_overwrite.md}). snake_case wire key
     * {@code "request_contract"}; consistent with this DTO's snake_case
     * convention -- there is intentionally NO {@code @CamelCaseWire}.</p>
     *
     * <p>Spec: Request Contract from Code Evidence (2026-06-19) -- Task Group 1.</p>
     */
    @JsonProperty("request_contract")
    Map<String, Object> requestContract
) {

    /**
     * Backward-compatible 15-arg constructor (without {@code requestContract})
     * so existing call sites that predate the {@code request_contract} field
     * continue to compile. Delegates to the canonical 16-arg constructor with a
     * {@code null} {@code requestContract} (additive + nullable; an absent block
     * round-trips as {@code null}).
     */
    public EndpointDto(
        String id,
        String name,
        String description,
        String interfaceId,
        String endpointType,
        String pathOrAddress,
        String protocol,
        String operationVerb,
        String direction,
        String validFrom,
        String validTo,
        String requestDataEntityPointId,
        String responseDataEntityPointId,
        Map<String, Object> protocolMetadataJson,
        Map<String, Object> responseContract
    ) {
        this(
            id, name, description, interfaceId, endpointType, pathOrAddress,
            protocol, operationVerb, direction, validFrom, validTo,
            requestDataEntityPointId, responseDataEntityPointId,
            protocolMetadataJson, responseContract, null);
    }
}
