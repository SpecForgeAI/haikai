package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;
import java.util.UUID;

/**
 * DTO for an SCL corpus mining scan.
 *
 * Wire shape is explicit snake_case per-field {@code @JsonProperty} (the AMS
 * belt-and-braces convention; no {@code @CamelCaseWire}). All fields are boxed
 * reference types so PATCH-style omissions never clobber stored values (see
 * project memory {@code primitive_double_dto_overwrite}).
 *
 * Spec: SCL corpus persistence (Structural Contract Language) (2026-08-18).
 *
 * @param id Internal database UUID
 * @param projectId Project identifier
 * @param architectureId Architecture identifier
 * @param status Scan lifecycle status (in_progress | completed | failed)
 * @param statsJson Opaque miner-written scan statistics (never parsed by AMS)
 * @param createdAt ISO-8601 timestamp of creation
 * @param updatedAt ISO-8601 timestamp of last update (null until first update)
 */
public record SclScanDto(
    @JsonProperty("id")
    UUID id,

    @JsonProperty("project_id")
    UUID projectId,

    @JsonProperty("architecture_id")
    UUID architectureId,

    @JsonProperty("status")
    String status,

    @JsonProperty("stats_json")
    Map<String, Object> statsJson,

    @JsonProperty("created_at")
    String createdAt,

    @JsonProperty("updated_at")
    String updatedAt
) {}
