package com.example.architecturemodel.model.dto.discovery;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;

/**
 * DTO for an {@code endpoint_data_effects} row -- the endpoint-&gt;data-entity
 * data-effect edge.
 *
 * <h2>Wire format</h2>
 *
 * <p>AMS speaks {@code snake_case} at the wire by default (the global
 * {@code spring.jackson.property-naming-strategy: SNAKE_CASE} in
 * {@code application.yml}). This DTO relies on that global strategy; the
 * explicit {@code @JsonProperty("snake_case_name")} declarations below are
 * belt-and-braces and consistent with the {@code InterfaceLogicalEntityDto}
 * precedent. There is intentionally NO {@code @CamelCaseWire} annotation --
 * the gateway proxy, the discovery-service AMS client and the frontend API
 * typings all consume this in {@code snake_case} (per CLAUDE.md).</p>
 *
 * <h2>Boxed-type rule</h2>
 *
 * <p>{@code confidence} is a boxed {@link Double}. Future maintainers adding
 * numeric fields MUST use boxed types -- primitives silently wipe to 0 / false
 * on missing JSON during PATCH (see
 * {@code project_primitive_double_dto_overwrite.md}).</p>
 *
 * <h2>Path metadata</h2>
 *
 * <p>{@code pathMetadataJson} is a passthrough JSON object ({@link Map}) so a
 * future call-tree UI can read the structured ordered hop list (each hop = FQN
 * + method signature), the operation hint, and the {@code transactional} flag
 * without a schema or DTO migration.</p>
 *
 * <p>Spec: Endpoint&rarr;Data-Effect Call Graph for Discovery
 * (2026-05-29) -- Task Group 1.</p>
 */
public record EndpointDataEffectDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("endpoint_id")
    String endpointId,

    /**
     * Data Entity Point ID -- format {@code dep_log_<entityId>} (logical) or
     * {@code dep_phy_<entityId>} (physical). NOT a raw entity FK.
     */
    @JsonProperty("data_entity_point_id")
    String dataEntityPointId,

    /** Headline access mode: {@code read} / {@code write} / {@code read-write}. */
    @JsonProperty("access_mode")
    String accessMode,

    /**
     * Structured, ordered hop list + operation hint + {@code transactional}
     * flag. Passthrough JSON object.
     */
    @JsonProperty("path_metadata_json")
    Map<String, Object> pathMetadataJson,

    /** Boxed {@link Double} (PATCH-safe). */
    @JsonProperty("confidence")
    Double confidence,

    @JsonProperty("description")
    String description,

    @JsonProperty("tags")
    String tags,

    @JsonProperty("valid_from")
    String validFrom,

    @JsonProperty("valid_to")
    String validTo
) {}
