package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * Library DTO -- parallel to {@link ServiceDto}.
 *
 * Mirrors {@link ServiceDto} field-for-field for the shared envelope, the
 * library-specific fields, and the 5 tech-hints columns. Adds the 6
 * Infrastructure spec-7 provenance fields after the tech-hints block.
 *
 * model_file_id is server-side only and is intentionally NOT exposed.
 *
 * Spec: 2026-05-05-library-backend-foundation
 */
public record LibraryDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("name")
    String name,

    @JsonProperty("description")
    String description,

    @JsonProperty("tags")
    String tags,

    @JsonProperty("valid_from")
    String validFrom,

    @JsonProperty("valid_to")
    String validTo,

    /**
     * Library ecosystem. Doc-only allowed values: MAVEN, NPM, PYPI, NUGET,
     * GO, OTHER. NO DB CHECK.
     */
    @JsonProperty("ecosystem")
    String ecosystem,

    @JsonProperty("repo_location")
    String repoLocation,

    @JsonProperty("repo_subfolder")
    String repoSubfolder,

    @JsonProperty("core_tech")
    String coreTech,

    /**
     * Full resolver response JSON (mirrors ServiceDto.coreTechResolved).
     */
    @JsonProperty("core_tech_resolved")
    Map<String, Object> coreTechResolved,

    @JsonProperty("core_tech_language_pack")
    String coreTechLanguagePack,

    @JsonProperty("core_tech_framework_packs")
    List<String> coreTechFrameworkPacks,

    @JsonProperty("core_tech_resolution_confidence")
    String coreTechResolutionConfidence,

    @JsonProperty("core_tech_resolved_at")
    Instant coreTechResolvedAt,

    // ------------------------------------------------------------------
    // Provenance fields (mirror Infrastructure spec-7 verbatim)
    // ------------------------------------------------------------------

    @JsonProperty("source_origin")
    String sourceOrigin,

    @JsonProperty("source_system")
    String sourceSystem,

    @JsonProperty("source_reference")
    String sourceReference,

    @JsonProperty("generation_status")
    String generationStatus,

    @JsonProperty("generation_notes")
    String generationNotes,

    @JsonProperty("last_verified_at")
    String lastVerifiedAt,

    @JsonProperty("package_set_id")
    String packageSetId
) {}
