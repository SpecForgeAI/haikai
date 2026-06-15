package com.example.architecturemodel.model.dto.library;

import com.example.architecturemodel.model.dto.entity.ApplicationPointDto;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Response payload for the find-or-create ApplicationPoint endpoint.
 *
 * <p>{@code is_new} is {@code true} when the request inserted a new
 * ApplicationPoint row; {@code false} when the request matched an existing
 * row by {@code (model_file_id, target_type, target_ref_id)}.</p>
 *
 * <p>Fix #5 (synthetic-placeholder removal): the discovery-service uses
 * this endpoint to self-heal a missing AP for a Service or Library root
 * before kicking off a library-scoped scan, so {@code source_application_point_id}
 * FK values inserted into {@code code_unit_dependencies} are always real
 * UUIDs.</p>
 */
public record ApplicationPointFindOrCreateResponse(
    @JsonProperty("id")
    String id,

    @JsonProperty("is_new")
    boolean isNew,

    @JsonProperty("application_point")
    ApplicationPointDto applicationPoint
) {}
