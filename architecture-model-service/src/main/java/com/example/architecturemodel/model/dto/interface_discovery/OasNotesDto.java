package com.example.architecturemodel.model.dto.interface_discovery;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * DTO for OAS generation hints/notes.
 * Contains candidate values for OAS server configuration.
 */
public record OasNotesDto(
    @JsonProperty("basePathCandidates")
    List<String> basePathCandidates,

    @JsonProperty("serverUrlCandidates")
    List<String> serverUrlCandidates
) {}
