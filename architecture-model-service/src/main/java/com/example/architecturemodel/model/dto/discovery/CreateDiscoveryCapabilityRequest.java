package com.example.architecturemodel.model.dto.discovery;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Create request for a single {@code discovery_capability} plus its members,
 * persisted atomically (Liquibase changeset 184).
 *
 * <p>The discovery-service synthesis step (D2 Task Group 4) posts one of these
 * per synthesised capability. {@code projectId} / {@code architectureId} /
 * {@code runId} come from the URL path and bind the capability (the body values,
 * if any, are overridden). The {@link #members} are the deterministically-seeded
 * membership edges, created in the same transaction as the capability so a
 * capability never persists without its members (or vice versa).</p>
 *
 * <p>snake_case wire (the global AMS default); NO {@code @CamelCaseWire}. All
 * fields are boxed reference types.</p>
 *
 * <p>Spec: D2 -- Capability Synthesis + Batch Spines (2026-06-14, Spec 2 of 6)
 * -- Task Group 1.</p>
 *
 * @param name        The LLM-named capability label (required).
 * @param kind        The LLM-classified kind (free-text, NO enum); nullable.
 * @param summary     The LLM one-line summary; nullable.
 * @param confidence  The synthesis confidence; boxed Double; nullable.
 * @param detailJson  The structured capability payload; nullable.
 * @param source      The synthesis provenance; nullable.
 * @param createdByStage The emitting pipeline stage; nullable.
 * @param members     The membership edges to create atomically with the capability; nullable / empty allowed.
 */
public record CreateDiscoveryCapabilityRequest(
    @JsonProperty("name")
    String name,

    @JsonProperty("kind")
    String kind,

    @JsonProperty("summary")
    String summary,

    @JsonProperty("confidence")
    Double confidence,

    @JsonProperty("detail_json")
    Map<String, Object> detailJson,

    @JsonProperty("source")
    String source,

    @JsonProperty("created_by_stage")
    String createdByStage,

    @JsonProperty("members")
    List<DiscoveryCapabilityMemberDto> members
) {}
