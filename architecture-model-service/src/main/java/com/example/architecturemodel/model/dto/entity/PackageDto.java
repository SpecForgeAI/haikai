package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Package DTO - represents a package within a PackageSet.
 *
 * Extended with standard_source and standard_key fields for Package Set Standards Import.
 * These fields are NULL for user-created packages.
 *
 * Spec: Package Set Standards Import (Iteration 6)
 */
public record PackageDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("package_set_id")
    String packageSetId,

    @JsonProperty("name")
    String name,

    @JsonProperty("purpose")
    String purpose,

    @JsonProperty("sort_order")
    Integer sortOrder,

    /**
     * Source of the import: "COMPANY" or "PROJECT".
     * NULL for user-created packages.
     */
    @JsonProperty("standard_source")
    String standardSource,

    /**
     * Optional compound key for imported packages (e.g., "JavaCrud:controller").
     */
    @JsonProperty("standard_key")
    String standardKey
) {}
