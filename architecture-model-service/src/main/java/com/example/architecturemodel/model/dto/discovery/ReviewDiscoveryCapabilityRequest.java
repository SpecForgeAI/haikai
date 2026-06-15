package com.example.architecturemodel.model.dto.discovery;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Patch-review request for a {@code discovery_capability} (Liquibase changeset
 * 184).
 *
 * <p>Transitions a capability to a reviewer disposition, recording the prior
 * value into {@code previous_review_status}. D2's UI is read-only, but this
 * endpoint is KEPT (it is trivial and forward-needed by the later D4-gate spec,
 * avoiding a later AMS round-trip). Approving / rejecting a capability does NOT
 * cascade to its members in D2.</p>
 *
 * <p>{@code review_status} must be a reviewer-valid disposition
 * ({@code approved} | {@code rejected} | {@code deferred} | {@code pending_review});
 * the service validates. {@code reviewer_notes} is optional. snake_case wire (the
 * global AMS default); NO {@code @CamelCaseWire}.</p>
 *
 * <p>Spec: D2 -- Capability Synthesis + Batch Spines (2026-06-14, Spec 2 of 6)
 * -- Task Group 1.</p>
 *
 * @param reviewStatus  The target reviewer disposition (required; service-validated).
 * @param reviewerNotes Optional reviewer note; nullable.
 */
public record ReviewDiscoveryCapabilityRequest(
    @JsonProperty("review_status")
    String reviewStatus,

    @JsonProperty("reviewer_notes")
    String reviewerNotes
) {}
