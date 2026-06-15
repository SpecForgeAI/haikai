package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;
import java.util.UUID;

/**
 * DTO for temporary architecture diagrams.
 *
 * Represents a temporary diagram persisted via the MCP endpoint, including
 * the full diagram payload (JSONB) and metadata timestamps.
 *
 * Spec 2026-03-26: MCP Endpoint for Saving Temporary Architecture Diagrams (Increment 3)
 * Task Group 2: Java Service, DTO, and Controller
 *
 * @param id Internal database UUID
 * @param projectId Project identifier
 * @param temporaryDiagramId Client/LLM-provided diagram identifier
 * @param diagramPayload Full TemporaryArchitectureDiagram JSON payload
 * @param createdAt ISO-8601 timestamp of creation
 * @param updatedAt ISO-8601 timestamp of last update
 */
public record TemporaryDiagramDto(
    @JsonProperty("id")
    UUID id,

    @JsonProperty("project_id")
    UUID projectId,

    @JsonProperty("temporary_diagram_id")
    String temporaryDiagramId,

    @JsonProperty("diagram_payload")
    Map<String, Object> diagramPayload,

    @JsonProperty("created_at")
    String createdAt,

    @JsonProperty("updated_at")
    String updatedAt
) {}
