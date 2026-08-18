package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Create request for a log-replay corpus WITH its items in one call (Spec 5,
 * 2026-08-18). The discovery-service extractor posts the whole staged corpus
 * atomically — a corpus either exists completely or not at all.
 *
 * Snake_case wire; item ids are service-assigned.
 *
 * @param fileName Source log display filename (null for inline content)
 * @param funnelJson Opaque extraction funnel accounting
 * @param items The deduplicated useful requests
 */
public record LogReplayCorpusCreateRequest(
    @JsonProperty("file_name")
    String fileName,

    @JsonProperty("funnel_json")
    Map<String, Object> funnelJson,

    @JsonProperty("items")
    List<Item> items
) {
    /**
     * One staged corpus item on the create wire.
     */
    public record Item(
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
        Integer lineNumber
    ) {}
}
