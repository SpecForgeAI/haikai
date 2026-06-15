package com.example.architecturemodel.model.dto.discovery;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * Bulk-create request: a batch of {@link CreateDiscoveryCapabilityRequest}
 * capabilities (each with its own members) persisted in one transaction
 * (Liquibase changeset 184).
 *
 * <p>The discovery-service synthesis step posts the whole run's synthesised
 * capabilities at once. Mirrors the {@code BulkCreateDiscoveryFindingsRequest}
 * wrapper shape. snake_case wire (the global AMS default); NO
 * {@code @CamelCaseWire}.</p>
 *
 * <p>Spec: D2 -- Capability Synthesis + Batch Spines (2026-06-14, Spec 2 of 6)
 * -- Task Group 1.</p>
 *
 * @param capabilities The capabilities to create (each with its members); nullable / empty allowed (a no-op).
 */
public record BulkCreateDiscoveryCapabilitiesRequest(
    @JsonProperty("capabilities")
    List<CreateDiscoveryCapabilityRequest> capabilities
) {}
