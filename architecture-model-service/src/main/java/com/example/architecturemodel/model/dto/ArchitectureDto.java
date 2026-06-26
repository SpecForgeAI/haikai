package com.example.architecturemodel.model.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * DTO for Architecture entity.
 *
 * Returned by the new GET /api/projects/{projectId}/architectures endpoint.
 * Used by the frontend to resolve the project's Default architecture (oldest
 * non-archived) and by discovery-service for the same purpose.
 *
 * Tags are surfaced as a flat string list mapped from the ArchitectureTagEntity
 * join table.
 *
 * <p><b>Target Architecture Authoring Flow extension (2026-05-20):</b>
 * The {@code kind} (one of {@code current} / {@code target}) and
 * {@code draftState} (one of {@code active} / {@code draft}) discriminators
 * from {@link com.example.architecturemodel.model.entity.ArchitectureEntity}
 * are surfaced here so the frontend can drive the drafts panel + target-
 * authoring workspace directly from the standard architecture DTO. Both are
 * boxed reference types so PATCH semantics preserve null per
 * {@code project_primitive_double_dto_overwrite.md}.</p>
 *
 * <p>A backward-compatible 8-arg constructor delegates to the canonical 10-arg
 * constructor with {@code kind} and {@code draftState} defaulted to null, so
 * existing callers and test fixtures continue to compile without modification
 * (same pattern as {@code ProjectDto}'s 9-arg compatibility constructor).</p>
 *
 * <p><b>Four-Spec Hardening Pass (2026-05-25), Item 3:</b>
 * The {@code elementCount} field surfaces the per-draft count of in-scope
 * elements across the four user-visible supertype tables
 * ({@code application_components}, {@code interfaces},
 * {@code data_entity_points}, {@code infrastructure_points}). Aggregated
 * server-side by the target-architecture list service via 4 grouped queries
 * (one per supertype table). Boxed {@code Long} (never primitive
 * {@code long}) so PATCH semantics preserve null per
 * {@code project_primitive_double_dto_overwrite.md} and so older callers that
 * cannot compute the count can omit the field. A backward-compatible
 * 10-arg constructor delegates to the canonical 11-arg constructor with
 * {@code elementCount = null}, same pattern as the 8-arg compatibility
 * constructor introduced for {@code kind} + {@code draftState}.</p>
 *
 * Spec: Multi-Architecture Plumbing (Spec #1)
 * Extended: Target Architecture Authoring Flow (2026-05-20)
 * Extended: Four-Spec Hardening Pass (2026-05-25) -- {@code elementCount}.
 */
public record ArchitectureDto(
    UUID id,
    UUID projectId,
    String name,
    String description,
    List<String> tags,
    Boolean archived,
    String kind,
    String draftState,
    Instant createdAt,
    Instant updatedAt,
    Long elementCount,
    Instant conversationSavedAt
) {

    /**
     * Backward-compatible 8-arg constructor preserving the pre-Target-
     * Architecture-Authoring-Flow signature. Delegates to the canonical 11-arg
     * constructor with {@code kind}, {@code draftState}, and
     * {@code elementCount} defaulted to {@code null}. Callers that need to set
     * the newer fields use the canonical constructor directly.
     */
    public ArchitectureDto(
            UUID id,
            UUID projectId,
            String name,
            String description,
            List<String> tags,
            Boolean archived,
            Instant createdAt,
            Instant updatedAt) {
        this(id, projectId, name, description, tags, archived, null, null,
            createdAt, updatedAt, null);
    }

    /**
     * Backward-compatible 10-arg constructor preserving the post-Target-
     * Architecture-Authoring-Flow signature (the 8-arg variant + {@code kind}
     * + {@code draftState}). Delegates to the canonical 11-arg constructor
     * with {@code elementCount} defaulted to {@code null}.
     *
     * <p>Added by the Four-Spec Hardening Pass (2026-05-25, Item 3) so
     * existing callers that build the DTO via the 10-arg signature (e.g.
     * {@code ArchitectureMapper#toDto} prior to this change, or any test
     * fixture) continue to compile and run without modification.</p>
     */
    public ArchitectureDto(
            UUID id,
            UUID projectId,
            String name,
            String description,
            List<String> tags,
            Boolean archived,
            String kind,
            String draftState,
            Instant createdAt,
            Instant updatedAt) {
        this(id, projectId, name, description, tags, archived, kind, draftState,
            createdAt, updatedAt, null);
    }

    /**
     * Backward-compatible 11-arg constructor preserving the pre-conversation-
     * save-marker signature (the canonical form prior to the Target-State
     * Conversation Save/Resume/Plan-Sourcing spec, 2026-06-26). Delegates to
     * the canonical 12-arg constructor with {@code conversationSavedAt}
     * defaulted to {@code null}.
     *
     * <p>Added so existing callers that build the DTO via the 11-arg signature
     * (e.g. {@code TargetArchitecturePromoteService#listTargets} prior to this
     * change, the Terraform export fixtures, and clone/seed test fixtures)
     * continue to compile and run without modification -- same compatibility
     * pattern as the 8-arg + 10-arg overloads above.</p>
     */
    public ArchitectureDto(
            UUID id,
            UUID projectId,
            String name,
            String description,
            List<String> tags,
            Boolean archived,
            String kind,
            String draftState,
            Instant createdAt,
            Instant updatedAt,
            Long elementCount) {
        this(id, projectId, name, description, tags, archived, kind, draftState,
            createdAt, updatedAt, elementCount, null);
    }
}
