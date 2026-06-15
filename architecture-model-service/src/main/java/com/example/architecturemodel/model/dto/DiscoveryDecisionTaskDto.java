package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;
import java.util.UUID;

/**
 * DTO for discovery decision tasks.
 *
 * Represents an ambiguous or competing candidate relationship that requires
 * LLM resolution during Phase 1b relationship inference triage. Used for
 * both request (bulk insert, update) and response (query) payloads on the
 * REST API.
 *
 * Spec: Phase 1b Linker and DecisionTask Engine (Increment 8)
 * Task Group 5: Liquibase Migration and JPA Entity Stack
 *
 * @param id Decision task UUID
 * @param runId Discovery run UUID this task belongs to
 * @param taskType Task type (confirm_relationship, resolve_competing_relationships)
 * @param status Lifecycle status (pending, resolved, failed)
 * @param inputData JSONB payload with source/target atom data and candidate context
 * @param outputData JSONB payload with LLM decision and reasoning (nullable)
 * @param createdAt ISO-8601 timestamp of task creation
 * @param resolvedAt ISO-8601 timestamp of resolution (nullable)
 */
public record DiscoveryDecisionTaskDto(
    @JsonProperty("id")
    UUID id,

    @JsonProperty("run_id")
    UUID runId,

    @JsonProperty("task_type")
    String taskType,

    @JsonProperty("status")
    String status,

    @JsonProperty("input_data")
    Map<String, Object> inputData,

    @JsonProperty("output_data")
    Map<String, Object> outputData,

    @JsonProperty("created_at")
    String createdAt,

    @JsonProperty("resolved_at")
    String resolvedAt
) {}
