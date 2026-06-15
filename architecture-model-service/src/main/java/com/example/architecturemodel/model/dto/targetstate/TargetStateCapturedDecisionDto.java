package com.example.architecturemodel.model.dto.targetstate;

import com.example.architecturemodel.jackson.CamelCaseWire;

import java.time.Instant;
import java.util.UUID;

/**
 * Response DTO for a {@code target_state_captured_decisions} row.
 *
 * <p>Marked {@code @CamelCaseWire} because the captured-decisions data plane speaks camelCase.</p>
 *
 * <p>Mirrors the entity 1:1 (15 fields), with {@code id} renamed to
 * {@code decisionId} on the wire to disambiguate from sibling DTOs returned
 * inside aggregation responses (the captured-decision id is the row
 * identifier consumers correlate against).</p>
 *
 * <p>All fields are boxed reference types ({@link String}, {@link UUID},
 * {@link Instant}). No primitives appear -- staying consistent with
 * {@code project_primitive_double_dto_overwrite.md} keeps the door open for
 * future evolution without silent zero-overwrites.</p>
 */
@CamelCaseWire
public record TargetStateCapturedDecisionDto(
    UUID decisionId,
    UUID projectId,
    UUID targetArchitectureId,
    String decisionCode,
    String scopeKind,
    String scopeRefType,
    String scopeRefId,
    String answerValue,
    String answerSummary,
    String standardsLookupRef,
    String conversationThreadId,
    String conversationTurnRef,
    Instant createdAt,
    String createdByTask,
    UUID supersededById
) {}
