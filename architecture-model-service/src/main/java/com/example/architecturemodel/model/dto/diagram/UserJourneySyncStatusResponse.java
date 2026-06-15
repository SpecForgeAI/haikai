package com.example.architecturemodel.model.dto.diagram;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Response DTO for the user journey sync status endpoint.
 *
 * Spec: User Journey One-Way Sync from Meta-Model
 * Task Group 1: Hash Utility and Sync Service
 *
 * Represents the current sync status of a saved USER_JOURNEY diagram
 * relative to the authoritative meta-model data.
 */
public record UserJourneySyncStatusResponse(
    @JsonProperty("sync_status")
    String syncStatus,

    @JsonProperty("stale_reason")
    String staleReason,

    @JsonProperty("last_synced_at")
    String lastSyncedAt,

    @JsonProperty("last_synced_hash")
    String lastSyncedHash
) {}
