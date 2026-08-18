package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;
import java.util.UUID;

/**
 * DTO for a mined SCL contract.
 *
 * The {@code bodyJson} / {@code rootsJson} / {@code glossJson} payloads are
 * OPAQUE JSON passed through verbatim -- architecture-model-service never
 * parses them. On list reads with {@code include_body=false} the service
 * returns this DTO with {@code body_json} AND {@code gloss_json} nulled to
 * keep list payloads light; the detail read carries the full body.
 *
 * Wire shape is explicit snake_case per-field {@code @JsonProperty}; all
 * fields are boxed reference types.
 *
 * Spec: SCL corpus persistence (Structural Contract Language) (2026-08-18).
 *
 * @param id Internal database UUID
 * @param projectId Project identifier (inherited from the owning scan)
 * @param architectureId Architecture identifier (inherited from the owning scan)
 * @param scanId Owning scan UUID
 * @param contractKey The miner's stable per-scan contract key (e.g. T-abc123)
 * @param kind Contract kind discriminator (miner-owned vocabulary)
 * @param sourcePath Source file the contract was mined from (nullable)
 * @param sourceSymbol Source symbol the contract was mined from (nullable)
 * @param contentHash Miner-computed content hash of the body
 * @param fanIn Inbound-reference count (boxed; null on the wire means "unset")
 * @param rootsJson Opaque JSON: entrypoint roots (nullable)
 * @param bodyJson Opaque JSON: the contract body (never parsed by AMS)
 * @param glossJson Opaque JSON: the LLM annotation-pass gloss (nullable)
 * @param createdAt ISO-8601 timestamp of creation
 * @param updatedAt ISO-8601 timestamp of last update (null until first update)
 */
public record SclContractDto(
    @JsonProperty("id")
    UUID id,

    @JsonProperty("project_id")
    UUID projectId,

    @JsonProperty("architecture_id")
    UUID architectureId,

    @JsonProperty("scan_id")
    UUID scanId,

    @JsonProperty("contract_key")
    String contractKey,

    @JsonProperty("kind")
    String kind,

    @JsonProperty("source_path")
    String sourcePath,

    @JsonProperty("source_symbol")
    String sourceSymbol,

    @JsonProperty("content_hash")
    String contentHash,

    @JsonProperty("fan_in")
    Integer fanIn,

    @JsonProperty("roots_json")
    Map<String, Object> rootsJson,

    @JsonProperty("body_json")
    Map<String, Object> bodyJson,

    @JsonProperty("gloss_json")
    Map<String, Object> glossJson,

    @JsonProperty("created_at")
    String createdAt,

    @JsonProperty("updated_at")
    String updatedAt
) {}
