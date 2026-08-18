package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;
import java.util.UUID;

/**
 * DTO for one deduplicated useful request in a log-replay corpus (Spec 5,
 * 2026-08-18). Snake_case wire, all fields boxed.
 *
 * @param id Internal database UUID
 * @param corpusId Owning corpus UUID
 * @param projectId Project identifier
 * @param method Uppercase HTTP method
 * @param pathTemplate Normalized path template ({id} placeholders)
 * @param concretePath Concrete path as logged, query string preserved
 * @param requestJson Opaque request payload ({ headers?, query?, body? })
 * @param responseStatus Logged response status (diagnostic only, never oracle)
 * @param occurrenceCount Identical requests collapsed into this item
 * @param richness url_only | with_body
 * @param matchedEndpointId Committed-model endpoint id when resolved
 * @param sourceFileName Source log display filename
 * @param lineNumber First-seen 1-based source line number
 * @param createdAt ISO-8601 timestamp of creation
 */
public record LogReplayCorpusItemDto(
    @JsonProperty("id")
    UUID id,

    @JsonProperty("corpus_id")
    UUID corpusId,

    @JsonProperty("project_id")
    UUID projectId,

    @JsonProperty("method")
    String method,

    @JsonProperty("path_template")
    String pathTemplate,

    @JsonProperty("concrete_path")
    String concretePath,

    @JsonProperty("request_json")
    Map<String, Object> requestJson,

    @JsonProperty("response_status")
    Integer responseStatus,

    @JsonProperty("occurrence_count")
    Integer occurrenceCount,

    @JsonProperty("richness")
    String richness,

    @JsonProperty("matched_endpoint_id")
    UUID matchedEndpointId,

    @JsonProperty("source_file_name")
    String sourceFileName,

    @JsonProperty("line_number")
    Integer lineNumber,

    @JsonProperty("created_at")
    String createdAt
) {}
