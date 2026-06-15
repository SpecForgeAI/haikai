package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;
import java.util.UUID;

/**
 * DTO for discovery evidence atoms.
 *
 * Represents a single piece of extracted evidence from a source code repository
 * during Phase 1a universal extraction. Used for both request (bulk insert) and
 * response (query) payloads on the REST API.
 *
 * Spec: Phase 1a Universal Evidence Extraction (Increment 6)
 * Task Group 2: Evidence Entity, DTO, Repository, Service, and Controller
 *
 * Extended: Log-based Discovery Enrichment (Increment 14)
 * Task Group 1: source and logOrigin fields for log-derived evidence atoms
 *
 * @param id Deterministic evidence atom UUID (hash-based for idempotency)
 * @param runId Discovery run UUID this atom belongs to
 * @param repoUrl Source repository URL
 * @param filePath Relative file path within the repository
 * @param type Evidence atom type (file_structure, symbol, string_pattern)
 * @param data Type-specific JSONB payload
 * @param extractedAt ISO-8601 timestamp of extraction
 * @param source Origin of the evidence atom: "code" (or null, treated as code) or "log" (nullable)
 * @param logOrigin JSONB metadata about the log file origin for log-sourced atoms (nullable)
 */
public record DiscoveryEvidenceDto(
    @JsonProperty("id")
    UUID id,

    @JsonProperty("run_id")
    UUID runId,

    @JsonProperty("repo_url")
    String repoUrl,

    @JsonProperty("file_path")
    String filePath,

    @JsonProperty("type")
    String type,

    @JsonProperty("data")
    Map<String, Object> data,

    @JsonProperty("extracted_at")
    String extractedAt,

    @JsonProperty("source")
    String source,

    @JsonProperty("log_origin")
    Map<String, Object> logOrigin
) {}
