package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * Request body for the SCL contract bulk-upsert endpoint
 * ({@code POST .../scl/scans/{scanId}/contracts/bulk}).
 *
 * Each entry is upserted on the (scan_id, contract_key) pair; project /
 * architecture ids are inherited from the scan row, never from the body.
 *
 * Spec: SCL corpus persistence (Structural Contract Language) (2026-08-18).
 *
 * @param contracts the contract batch to upsert
 */
public record SclContractBulkUpsertRequest(
    @JsonProperty("contracts")
    List<SclContractDto> contracts
) {}
