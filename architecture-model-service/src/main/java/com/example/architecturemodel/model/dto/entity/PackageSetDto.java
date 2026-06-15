package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * PackageSet DTO - represents a group of packages for service design.
 *
 * Extended with standard_key and standard_source fields for Package Set Standards Import.
 * These fields are NULL for user-created package sets.
 *
 * Spec: Package Set Standards Import (Iteration 6)
 */
public record PackageSetDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("name")
    String name,

    /**
     * Unique key for imported package sets (e.g., "JavaCrud").
     * NULL for user-created package sets.
     */
    @JsonProperty("standard_key")
    String standardKey,

    /**
     * Source of the import: "COMPANY" or "PROJECT".
     * NULL for user-created package sets.
     */
    @JsonProperty("standard_source")
    String standardSource
) {}
