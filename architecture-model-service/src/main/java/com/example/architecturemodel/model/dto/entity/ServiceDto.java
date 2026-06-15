package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * Service DTO.
 *
 * Tech Hints LLM Resolution (spec 2026-04-20) added five resolved-state
 * fields at the end of the record. All nullable; new fields are appended so
 * existing positional constructor callers just add five nulls.
 */
public record ServiceDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("name")
    String name,

    @JsonProperty("description")
    String description,

    @JsonProperty("application_id")
    String applicationId,

    @JsonProperty("app_component_id")
    String appComponentId,

    @JsonProperty("service_type")
    String serviceType,

    @JsonProperty("core_tech")
    String coreTech,

    @JsonProperty("repo_location")
    String repoLocation,

    @JsonProperty("repo_subfolder")
    String repoSubfolder,

    @JsonProperty("tags")
    String tags,

    @JsonProperty("valid_from")
    String validFrom,

    @JsonProperty("valid_to")
    String validTo,

    @JsonProperty("package_set_id")
    String packageSetId,

    @JsonProperty("is_internal")
    Boolean isInternal,

    /**
     * Full resolver response JSON (language, frameworks, confirmationSentence,
     * repoCrossCheck). NULL when the row has never been resolved. Serialised
     * as a nested JSON object via Jackson's default Map handling.
     */
    @JsonProperty("core_tech_resolved")
    Map<String, Object> coreTechResolved,

    @JsonProperty("core_tech_language_pack")
    String coreTechLanguagePack,

    /**
     * Denormalised framework pack IDs. Serialised as a JSON array of strings.
     */
    @JsonProperty("core_tech_framework_packs")
    List<String> coreTechFrameworkPacks,

    @JsonProperty("core_tech_resolution_confidence")
    String coreTechResolutionConfidence,

    @JsonProperty("core_tech_resolved_at")
    Instant coreTechResolvedAt
) {}
