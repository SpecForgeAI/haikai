package com.example.architecturemodel.model.dto.library;

import com.example.architecturemodel.model.dto.entity.LibraryDto;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Response payload for the find-or-create Library endpoint.
 *
 * <p>{@code is_new} is {@code true} when the request inserted a new Library
 * row (and the same transaction inserted a derived ApplicationPoint with
 * {@code target_type='LIBRARY'}); {@code false} when the request matched an
 * existing row by {@code (model_file_id, name, ecosystem)}.</p>
 *
 * <p>{@code derived_application_point_id} carries the AP id that points at the
 * Library -- newly created when {@code is_new=true}, looked up when
 * {@code is_new=false}.</p>
 *
 * <p>Spec: 2026-05-06-library-discovery-integration -- Task Group 1.</p>
 */
public record LibraryFindOrCreateResponse(
    @JsonProperty("id")
    String id,

    @JsonProperty("derived_application_point_id")
    String derivedApplicationPointId,

    @JsonProperty("is_new")
    boolean isNew,

    @JsonProperty("library")
    LibraryDto library
) {}
