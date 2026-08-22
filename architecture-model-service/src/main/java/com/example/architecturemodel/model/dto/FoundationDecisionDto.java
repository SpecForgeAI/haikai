package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.Map;

/**
 * Wire DTO for one foundation adjudication fact (Foundations &amp; Scope
 * program, Spec 1, 2026-08-22). snake_case wire (AMS global default —
 * consumers are the gateway, the MCP server and the frontend's
 * snake_case-typed API modules).
 */
public record FoundationDecisionDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("project_id")
    String projectId,

    @JsonProperty("architecture_id")
    String architectureId,

    @JsonProperty("decision_key")
    String decisionKey,

    @JsonProperty("rule_key")
    String ruleKey,

    @JsonProperty("question_text")
    String questionText,

    @JsonProperty("answer")
    String answer,

    @JsonProperty("scope")
    String scope,

    @JsonProperty("targets_json")
    List<Map<String, Object>> targetsJson,

    @JsonProperty("payload_json")
    Map<String, Object> payloadJson,

    @JsonProperty("rationale")
    String rationale,

    @JsonProperty("evidence_hash")
    String evidenceHash,

    @JsonProperty("stale")
    Boolean stale,

    @JsonProperty("decided_at")
    String decidedAt,

    @JsonProperty("created_at")
    String createdAt,

    @JsonProperty("updated_at")
    String updatedAt
) {}
