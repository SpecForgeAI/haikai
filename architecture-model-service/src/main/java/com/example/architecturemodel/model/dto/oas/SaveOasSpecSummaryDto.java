package com.example.architecturemodel.model.dto.oas;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.time.Instant;

/**
 * Response DTO for a successful OAS spec save operation.
 * Contains information about the saved file and the updated interface.
 */
public record SaveOasSpecSummaryDto(
    @JsonProperty("interfaceId")
    String interfaceId,

    @JsonProperty("interfaceName")
    String interfaceName,

    @JsonProperty("architectureFilename")
    String architectureFilename,

    @JsonProperty("format")
    String format,

    @JsonProperty("savedPath")
    String savedPath,

    @JsonProperty("specLink")
    String specLink,

    @JsonProperty("updatedAt")
    Instant updatedAt,

    @JsonProperty("created")
    boolean created
) {}
