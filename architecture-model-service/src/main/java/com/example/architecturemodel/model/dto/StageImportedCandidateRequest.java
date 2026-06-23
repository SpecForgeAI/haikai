package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Request body for staging ONE imported endpoint as an un-approved discovery
 * candidate (the AMS side of "Add to architecture" for the Postman import flow).
 *
 * Spec: 2026-06-23 Import a Postman Collection into Capture, R5 / A4 -- Task
 * Group 5. "Add to architecture" STAGES A DISCOVERY CANDIDATE (it must NOT write
 * a committed architecture endpoint directly). The candidate is parented by a
 * find-or-create lightweight synthetic "imported" run because
 * {@code discovery_candidate.run_id} is NOT NULL (see
 * {@code PostmanImportCandidateStagingService}).
 *
 * Wire format is snake_case (R8): the discovery candidate data plane is
 * snake_case by the global Jackson naming strategy. The explicit
 * {@code @JsonProperty} declarations are belt-and-braces, matching the
 * surrounding {@link DiscoveryCandidateDto} convention. NO {@code @CamelCaseWire}
 * -- no camelCase consumer requires it.
 *
 * @param method the imported request's HTTP method (e.g. "GET", "POST") -- required
 * @param path the imported request's concrete path (e.g. "/orders/42") -- required
 * @param name optional proposed candidate name; falls back to "{method} {path}"
 *             when null/blank
 * @param sourceItemName optional Postman source item name (carried into the
 *                       candidate {@code data} for traceability)
 * @param summary optional human-readable summary for the candidate {@code data}
 */
public record StageImportedCandidateRequest(
    @JsonProperty("method")
    String method,

    @JsonProperty("path")
    String path,

    @JsonProperty("name")
    String name,

    @JsonProperty("source_item_name")
    String sourceItemName,

    @JsonProperty("summary")
    String summary
) {}
