package com.example.architecturemodel.model.dto.discovery;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.UUID;

/**
 * DTO for a single {@code discovery_capability_member} (Liquibase changeset 184).
 *
 * <p>Represents one polymorphic membership edge from a capability to a referenced
 * member. {@code member_type} discriminates the target table for
 * {@code member_id} ({@code discovery_finding} | {@code discovery_candidate} |
 * {@code architecture_element} | {@code discovery_relationship}). Members are
 * nested within {@link DiscoveryCapabilityDto} on read and supplied alongside the
 * capability on bulk-create.</p>
 *
 * <p>Follows the {@code member_type} / {@code member_id} snake_case shape of the
 * polymorphic-member precedent {@code DiscoveryClusterMemberDto} (WITHOUT reusing
 * the deprecated cluster entity). snake_case wire (the global AMS default); NO
 * {@code @CamelCaseWire} -- new entity, no camelCase consumer.</p>
 *
 * <p>Spec: D2 -- Capability Synthesis + Batch Spines (2026-06-14, Spec 2 of 6)
 * -- Task Group 1.</p>
 *
 * @param id           Member edge UUID.
 * @param capabilityId UUID of the parent capability.
 * @param memberType   Polymorphic discriminator ({@code discovery_finding} |
 *                     {@code discovery_candidate} | {@code architecture_element}
 *                     | {@code discovery_relationship}).
 * @param memberId     UUID of the referenced member.
 * @param createdAt    ISO-8601 timestamp of creation; nullable on create input.
 */
public record DiscoveryCapabilityMemberDto(
    @JsonProperty("id")
    UUID id,

    @JsonProperty("capability_id")
    UUID capabilityId,

    @JsonProperty("member_type")
    String memberType,

    @JsonProperty("member_id")
    UUID memberId,

    @JsonProperty("created_at")
    String createdAt
) {}
