package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * Request body for the SCL reachability replace endpoint
 * ({@code PUT .../scl/scans/{scanId}/reachability}).
 *
 * Replace-on-write: the scan's existing worklist is deleted and this batch is
 * inserted fresh inside one transaction.
 *
 * Spec: SCL corpus persistence (Structural Contract Language) (2026-08-18).
 *
 * @param items the fresh reachability worklist for the scan
 */
public record SclReachabilityBulkRequest(
    @JsonProperty("items")
    List<SclReachabilityItemDto> items
) {}
