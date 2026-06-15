package com.example.architecturemodel.model.dto.discovery;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Wire shape for a {@code discovery_capability} row (Liquibase changeset 184),
 * with its members embedded.
 *
 * <p>The synthesised CAPABILITY: a cross-cutting current-state aggregation of
 * related discovery findings / candidates / architecture elements (e.g. "Daily
 * Risk Hierarchy Load Pipeline") that becomes ONE migration story. Used by the
 * list / get / create / bulk-create / patch-review endpoints. Modeled
 * structurally on {@code DiscoveryFindingDto} + {@code MigrationReconciliationBreakDto}
 * (record type; snake_case {@code @JsonProperty} naming -- the global AMS wire
 * default).</p>
 *
 * <p>NEW capability consumer -- snake_case wire (NO {@code @CamelCaseWire}): the
 * discovery-service synthesis client + the frontend read client both read
 * snake_case, matching every other AMS consumer.</p>
 *
 * <p>All fields are boxed reference types ({@link UUID}, {@link String},
 * {@link Double}, {@link Map}, {@link List}). No Java primitives -- per
 * {@code project_primitive_double_dto_overwrite.md}, a primitive
 * {@code confidence} would silently default to {@code 0.0} on a PATCH that omits
 * the field and could wipe the synthesis confidence. The PATCH null-guard
 * contract lives in {@code DiscoveryCapabilityMapper#updateEntityFromDto}: an
 * omitted JSON field arrives as {@code null} here and the existing column
 * survives the update untouched.</p>
 *
 * <p>{@link #members} is read-only on this DTO: it is populated on GET-by-id (the
 * get-with-members read) and ignored on PATCH. Members are supplied on
 * bulk-create via {@code CreateDiscoveryCapabilityRequest}.</p>
 *
 * <p>Spec: D2 -- Capability Synthesis + Batch Spines (2026-06-14, Spec 2 of 6)
 * -- Task Group 1.</p>
 *
 * @param id                   Internal database UUID.
 * @param runId                The discovery_run that synthesised this capability (read key); nullable.
 * @param projectId            The owning project (read scope).
 * @param architectureId       The owning architecture (read scope).
 * @param name                 The LLM-named capability label.
 * @param kind                 The LLM-classified kind (free-text, NO enum); nullable.
 * @param summary              The LLM one-line summary; nullable.
 * @param reviewStatus         The reviewer disposition (pending_review | approved | rejected | deferred).
 * @param previousReviewStatus The review_status before the most recent transition (audit trail); nullable.
 * @param confidence           The synthesis confidence; boxed Double; nullable.
 * @param detailJson           The structured capability payload (JIL-DAG topology, invocations[] edges, schedule, external systems, behaviourBearing hint); nullable.
 * @param source               The synthesis provenance; nullable.
 * @param createdByStage        The emitting pipeline stage; nullable.
 * @param createdAt            ISO-8601 timestamp of creation.
 * @param updatedAt            ISO-8601 timestamp of last update.
 * @param members              The embedded members (read-only; populated on GET-by-id, ignored on PATCH); nullable.
 */
public record DiscoveryCapabilityDto(
    @JsonProperty("id")
    UUID id,

    @JsonProperty("run_id")
    UUID runId,

    @JsonProperty("project_id")
    UUID projectId,

    @JsonProperty("architecture_id")
    UUID architectureId,

    @JsonProperty("name")
    String name,

    @JsonProperty("kind")
    String kind,

    @JsonProperty("summary")
    String summary,

    @JsonProperty("review_status")
    String reviewStatus,

    @JsonProperty("previous_review_status")
    String previousReviewStatus,

    @JsonProperty("confidence")
    Double confidence,

    @JsonProperty("detail_json")
    Map<String, Object> detailJson,

    @JsonProperty("source")
    String source,

    @JsonProperty("created_by_stage")
    String createdByStage,

    @JsonProperty("created_at")
    String createdAt,

    @JsonProperty("updated_at")
    String updatedAt,

    @JsonProperty("members")
    List<DiscoveryCapabilityMemberDto> members
) {}
