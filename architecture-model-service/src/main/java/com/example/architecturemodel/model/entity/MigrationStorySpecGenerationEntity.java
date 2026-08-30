package com.example.architecturemodel.model.entity;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Type;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * JPA Entity for a single shape-spec-generation attempt against a saved-story
 * WorkItem.
 *
 * <p>Persistence target for the new
 * {@code product-manager--migration-shape-spec-generation} task (Spec 2 of the
 * PM Migration Delivery flow). Each row is one generation attempt; the
 * gateway is the sole orchestrator of LLM generation (R-2) and POSTs results
 * here for persistence -- AMS never calls the LLM for this flow.</p>
 *
 * <p>Path B chosen per R-1 (Group 1, Spec 2): structurally a peer of
 * {@link GeneratedMigrationBookOfWorkEntity} (Spec 1, Liquibase changeset 139)
 * rather than an extension of the opaque {@code WorkItemImplementWorkspace}
 * JSONB workspace-state snapshot, which serves a different concern
 * (Implement-tab UI rehydration). See
 * {@code agent-os/specs/2026-05-19-pm-migration-shape-spec-batch-generation/planning/group-1-persistence-decision.txt}.</p>
 *
 * <p>WorkItem FK ({@link #workItemId}) is the source of truth (R-9); NO new
 * field is added on the {@code WorkItem} entity itself. The chip rendered on
 * the WorkItem Implement tab queries this table via
 * {@code findByWorkItemId}.</p>
 *
 * <p>Four sibling JSONB columns (all nullable so partial / failed-only rows
 * are representable per R-12):</p>
 * <ul>
 *   <li>{@code warnings_json}              -- structured warnings array (incl. CONFIDENCE_DOWNGRADED entry from R-7)</li>
 *   <li>{@code missing_inputs_json}        -- non-empty when {@code status='insufficient_context'}</li>
 *   <li>{@code focused_context_refs_json}  -- refs used to assemble the LLM payload (bounded by A-5/R-5)</li>
 *   <li>{@code evidence_refs_json}         -- evidence references cited by the generated spec (acceptance signal 11)</li>
 * </ul>
 *
 * <p><b>Cross-Story Context Injection extension (2026-05-20, Task Group 1):</b>
 * the table is extended with two-pass / cross-story columns via Liquibase
 * changeset 141: {@code generation_pass} (SMALLINT, 1 or 2, CHECK), three
 * additional JSONB columns {@code decisions_json} / {@code interfaces_json} /
 * {@code assumptions_json} (parser output), {@code pass1_spec_text} +
 * {@code pass2_changes_summary} (TEXT), {@code budget_meta_json} (JSONB), and
 * {@code no_meaningful_change} (BOOLEAN). All boxed reference types so PATCH
 * preserves null per the standing project rule.</p>
 *
 * <p><b>Target Architecture Authoring Flow extension (2026-05-20, Task Group 1):</b>
 * Liquibase changeset 146 adds two more nullable columns -- {@link #stale}
 * (boxed {@link Boolean}) and {@link #staleMarkedAt} (boxed {@link Instant}) --
 * driving the spec-staleness pipeline that fires on every promote and every
 * (debounced) save to the active target architecture. Both are NULLABLE so a
 * PATCH that omits the field never silently flips the column (the canonical
 * primitive-overwrite pitfall). A new composite index
 * {@code idx_msg_project_stale} on {@code (project_id, stale)} keeps the
 * migration delivery dashboard's stale-count query fast.</p>
 *
 * <p>All fields are boxed reference types (never Java primitives) so PATCH
 * semantics preserve null per {@code project_primitive_double_dto_overwrite.md}:
 * callers null-guard each field before assigning during update flows so an
 * omitted DTO field never silently wipes the column. This is particularly
 * critical for {@link #generationAttemptNumber} (boxed {@link Integer}, NOT
 * {@code int}).</p>
 *
 * <p>Status vocabulary is constrained to the five persisted values declared on
 * {@link MigrationStorySpecGenerationStatus} ({@code not_attempted} is LAZY --
 * A-6 -- never persisted). The DB CHECK constraint {@code chk_msg_status}
 * (Liquibase changeset 140) is the source of truth.</p>
 *
 * <p>Manual-edit protection (acceptance signal 17): if {@link #createdByTask}
 * drifts from the generator's task id, the service layer rejects an overwrite
 * unless the gateway sends {@code confirmOverwrite=true}.</p>
 *
 * <p>Spec: PM Migration Shape-Spec Batch Generation (2026-05-19) -- Task Group 1.</p>
 * <p>Extended: Cross-Story Context Injection (2026-05-20) -- Task Group 1.</p>
 * <p>Extended: Target Architecture Authoring Flow (2026-05-20) -- Task Group 1.</p>
 * <p>Extended: Missing Input Resolver Flow (2026-05-20) -- Task Group 1.</p>
 * <p>Extended: Spec Quality Scoring (2026-05-20) -- Task Group 1.</p>
 * <p>Extended: In-Product Spec Editor + Confirm-Overwrite (2026-05-20) -- Task Group 1.</p>
 */
@Entity
@Table(
    name = "migration_story_spec_generations",
    indexes = {
        @Index(name = "idx_msg_project_id", columnList = "project_id"),
        @Index(name = "idx_msg_work_item_id", columnList = "work_item_id"),
        @Index(name = "idx_msg_book_of_work_id", columnList = "book_of_work_id"),
        @Index(name = "idx_msg_status", columnList = "status"),
        @Index(name = "idx_msg_book_status", columnList = "book_of_work_id, status"),
        @Index(name = "idx_msg_project_stale", columnList = "project_id, stale")
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class MigrationStorySpecGenerationEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    /**
     * The saved-story WorkItem this generation attempt targets. NOT NULL.
     * Source of truth for WorkItem linkage (R-9); no new field is added on
     * the {@code WorkItem} entity itself.
     */
    @Column(name = "work_item_id", nullable = false)
    private UUID workItemId;

    /**
     * The generated migration Book of Work (Spec 1) this generation originated
     * from. Nullable so legacy / ad-hoc single-story regen flows remain
     * representable; the canonical batch flow always sets it.
     */
    @Column(name = "book_of_work_id")
    private UUID bookOfWorkId;

    /**
     * The book-of-work hierarchy item id (from the {@code book_of_work_json}
     * blob in Spec 1's row). Nullable for the same reason as
     * {@link #bookOfWorkId}.
     *
     * <p>Length widened 128 -> 512 on 2026-08-30 (changeset
     * {@code 228-widen-book-item-id}). The id embeds the flattened
     * fully-qualified symbol, so a NESTED class in a deep package produced a
     * 129-char value; at 128 the insert failed with SQLSTATE 22001 and,
     * because the batch is one transaction, the ENTIRE 25-row batch rolled
     * back. Keep this in step with the DB column — {@code ddl-auto: validate}
     * is on.</p>
     */
    @Column(name = "book_item_id", length = 512)
    private String bookItemId;

    /**
     * Lifecycle status. Allowed persisted values are declared on
     * {@link MigrationStorySpecGenerationStatus}; the DB CHECK constraint
     * {@code chk_msg_status} is the source of truth. {@code not_attempted}
     * is LAZY (A-6) and is never persisted.
     */
    @Column(name = "status", nullable = false, length = 32)
    private String status;

    /**
     * LLM self-rated confidence ({@code high|medium|low}), possibly downgraded
     * by the gateway per R-7. Nullable -- not meaningful for
     * {@code status=failed} rows. CHECK constraint
     * {@code chk_msg_confidence}.
     */
    @Column(name = "confidence", length = 16)
    private String confidence;

    /**
     * Snapshot of per-story readiness signal from Spec 1's BoW JSONB blob,
     * copied here at generation time so the predicted-vs-actual side-by-side
     * comparison (R-10) survives BoW edits. Nullable.
     */
    @Column(name = "predicted_readiness", length = 32)
    private String predictedReadiness;

    /**
     * Literal {@code /agent-os:shape-spec [spec details]} body when
     * {@code status} is in {@code generated} / {@code generated_with_warnings};
     * null otherwise. The gateway validator (A-4) enforces the prefix and
     * actionable-detail rules at gateway level.
     */
    @Column(name = "generated_spec_text", columnDefinition = "TEXT")
    private String generatedSpecText;

    /**
     * Structured warnings array. Includes the CONFIDENCE_DOWNGRADED entry
     * appended by the gateway when downgrade rules fire (R-7). Nullable
     * (empty rows leave this null rather than serialising an empty array).
     */
    @Type(JsonType.class)
    @Column(name = "warnings_json", columnDefinition = "jsonb")
    private List<Map<String, Object>> warningsJson;

    /**
     * Non-empty when {@code status='insufficient_context'}. Items shape:
     * {@code { kind, id, reason }}. Nullable for other statuses.
     */
    @Type(JsonType.class)
    @Column(name = "missing_inputs_json", columnDefinition = "jsonb")
    private List<Map<String, Object>> missingInputsJson;

    /**
     * Refs used to assemble the LLM payload (architecture refs, mappings,
     * baselines, contracts, evidence IDs). Bounded by the gateway
     * focused-context client per A-5 / R-5. Nullable.
     */
    @Type(JsonType.class)
    @Column(name = "focused_context_refs_json", columnDefinition = "jsonb")
    private Map<String, Object> focusedContextRefsJson;

    /**
     * Evidence references cited by the generated spec. Acceptance signal 11:
     * generated specs include evidence/traceability refs. Nullable for
     * non-generated rows.
     */
    @Type(JsonType.class)
    @Column(name = "evidence_refs_json", columnDefinition = "jsonb")
    private List<String> evidenceRefsJson;

    // ------------------------------------------------------------------
    // Implementation-Ready Spec columns (Liquibase changeset 181)
    // Spec: Implementation-Ready Migration Spec Generation (2026-06-14) -- TG1
    // ------------------------------------------------------------------

    /**
     * Structured unit/functional test pack produced by the enriched migration
     * shape-spec generator (D6). Each entry is a map with three keys:
     * {@code title}, {@code description} and {@code type} (constrained to
     * {@code unit} or {@code functional} -- integration / E2E are excluded,
     * deferred to Spec 2). Maps 1:1 to a {@code TestDefinition} so it can
     * populate {@code latestTestPlannerResponse.testPlan} on the Implement
     * screen AND render inline into {@link #generatedSpecText} (D3).
     *
     * <p>Stored as JSONB via Hibernate's {@code JsonType}, mirroring the
     * existing {@code warnings_json} / {@code quality_dimensions_json}
     * sibling-JSONB idiom. NULLABLE -- {@code failed} / {@code insufficient_context}
     * rows carry no structured tests; null is the valid empty state (no
     * {@code @PrePersist} defaulting). BOXED {@link java.util.List} of
     * {@link java.util.Map} per {@code project_primitive_double_dto_overwrite.md}
     * so a PATCH that omits the field never wipes the column.</p>
     */
    @Type(JsonType.class)
    @Column(name = "structured_tests_json", columnDefinition = "jsonb")
    private List<Map<String, Object>> structuredTestsJson;

    /**
     * Forward-only groundwork (D9): the model {@code EndpointEntity} UUIDs this
     * story migrates, best-effort grounded in the already-resolved migration
     * context. EMPTY array for non-endpoint stories (DB schema build, DB data
     * migration, other-service code, infra); ids are never fabricated -- this
     * preserves the no-fabrication discipline.
     *
     * <p>NOT consumed by any v1 feature -- it is persisted now so a future
     * break-cause classification feature needs no story-side backfill. Stored
     * as JSONB via {@code JsonType}, mirroring {@code decisions_json} /
     * {@code evidence_refs_json}. NULLABLE; an empty array is a valid populated
     * value (non-endpoint story) and is distinct from null (never populated).
     * BOXED {@link java.util.List} per {@code project_primitive_double_dto_overwrite.md}
     * so a PATCH that omits the field never wipes the column.</p>
     */
    @Type(JsonType.class)
    @Column(name = "covered_endpoint_ids", columnDefinition = "jsonb")
    private List<String> coveredEndpointIds;

    // ------------------------------------------------------------------
    // Cross-Story Context Injection columns (Liquibase changeset 141)
    // Spec: 2026-05-20 -- Task Group 1
    // ------------------------------------------------------------------

    /**
     * Two-pass loop position. Allowed values 1 (pass-1, no sibling context) or
     * 2 (pass-2, sibling-aware). DB CHECK constraint
     * {@code chk_msg_generation_pass} is the source of truth; hard cap at 2 is
     * also enforced at the gateway handler boundary.
     *
     * <p>BOXED {@link Integer} (NOT primitive {@code int}) per
     * {@code project_primitive_double_dto_overwrite.md}. The column is NOT NULL
     * with DEFAULT 1 at the DB level; the entity's {@code @PrePersist}
     * defaulter mirrors this so a builder that omits the field still inserts
     * cleanly.</p>
     */
    @Column(name = "generation_pass", nullable = false, columnDefinition = "int2")
    @Builder.Default
    private Integer generationPass = 1;

    /**
     * Snapshot of the pass-1 {@code generated_spec_text} used to drive the
     * inline diff view in the UI. Pass-1 rows write
     * {@code pass1_spec_text = generated_spec_text}; pass-2 rows carry the
     * prior-row snapshot. Nullable for failed / insufficient_context /
     * skipped_blocked rows where no pass-1 text was produced.
     */
    @Column(name = "pass1_spec_text", columnDefinition = "TEXT")
    private String pass1SpecText;

    /**
     * LLM-generated "what changed and why" blurb rendered above the inline
     * diff for pass-2 outputs. Cites the sibling spec / epic decision that
     * caused each change. Nullable on pass-1 rows.
     */
    @Column(name = "pass2_changes_summary", columnDefinition = "TEXT")
    private String pass2ChangesSummary;

    /**
     * Mirrors the resolver {@code budget_meta} for the actually-executed call:
     * {@code { used_tokens, max_tokens, trimmed: { sibling_specs_dropped,
     * evidence_refs_dropped } }}. Persisted per row so the post-batch summary
     * view can recover per-pass cost actuals. Nullable.
     */
    @Type(JsonType.class)
    @Column(name = "budget_meta_json", columnDefinition = "jsonb")
    private Map<String, Object> budgetMetaJson;

    /**
     * True when pass-2 output is byte-equivalent to pass-1 after normalized
     * whitespace compare. Drives the "Pass 2: no meaningful change" badge in
     * the story drawer (spec acceptance signal 10).
     *
     * <p>BOXED {@link Boolean} (NOT primitive {@code boolean}) per
     * {@code project_primitive_double_dto_overwrite.md}: a primitive would
     * silently default to {@code false} on a PATCH that omits the field, and
     * could wipe a previously-set value.</p>
     */
    @Column(name = "no_meaningful_change")
    private Boolean noMeaningfulChange;

    /**
     * Parser-extracted {@code decisions[]} from {@code generated_spec_text}
     * at write time. Single canonical source for sibling-summary content; the
     * context resolver reads this column directly rather than re-parsing spec
     * text at request time. Nullable when parser yields empty extraction
     * (a warning is appended to {@code warnings_json} with kind
     * {@code parser_missing_heading}).
     */
    @Type(JsonType.class)
    @Column(name = "decisions_json", columnDefinition = "jsonb")
    private List<String> decisionsJson;

    /**
     * Parser-extracted {@code interfaces[]} from {@code generated_spec_text}
     * at write time. Read directly by the resolver's
     * {@code buildSiblingSummaries(...)}. Nullable when parser yields empty.
     */
    @Type(JsonType.class)
    @Column(name = "interfaces_json", columnDefinition = "jsonb")
    private List<String> interfacesJson;

    /**
     * Parser-extracted {@code assumptions[]} from {@code generated_spec_text}
     * at write time. Read directly by the resolver's
     * {@code buildSiblingSummaries(...)}. Nullable when parser yields empty.
     */
    @Type(JsonType.class)
    @Column(name = "assumptions_json", columnDefinition = "jsonb")
    private List<String> assumptionsJson;

    // ------------------------------------------------------------------
    // End cross-story columns
    // ------------------------------------------------------------------

    // ------------------------------------------------------------------
    // Target Architecture Authoring Flow columns (Liquibase changeset 146)
    // Spec: 2026-05-20 -- Task Group 1
    // ------------------------------------------------------------------

    /**
     * TRUE when this spec is stale because the active target architecture
     * changed since the spec was generated. Flipped by
     * {@code POST /api/projects/{projectId}/specs/mark-stale}; cleared on
     * successful regeneration.
     *
     * <p>BOXED {@link Boolean} (NOT primitive {@code boolean}) per
     * {@code project_primitive_double_dto_overwrite.md}: a primitive would
     * silently default to {@code false} on a PATCH that omits the field and
     * could wipe a previously-set stale flag.</p>
     *
     * <p>Semantically, NULL is treated as "not stale" by the dashboard count
     * query; the new composite index {@code idx_msg_project_stale} keeps that
     * filter fast.</p>
     */
    @Column(name = "stale")
    private Boolean stale;

    /**
     * Timestamp at which this row was last marked stale. Nullable; cleared
     * when the spec is successfully regenerated.
     *
     * <p>Idempotency: a second mark-stale call on the same set is a no-op for
     * already-stale rows but DOES bump this column (per AMS handler spec).</p>
     */
    @Column(name = "stale_marked_at")
    private Instant staleMarkedAt;

    // ------------------------------------------------------------------
    // End target-architecture-authoring columns
    // ------------------------------------------------------------------

    // ------------------------------------------------------------------
    // Missing Input Resolver Flow columns (Liquibase changesets 149, 150)
    // Spec: 2026-05-20 -- Task Group 1
    // ------------------------------------------------------------------

    /**
     * List of stable 16-hex-char missing-input keys produced by
     * {@code MissingInputKeyHasher} at spec-emit time when
     * {@code status='insufficient_context'}. The cross-story matcher reads
     * this column to find every spec affected by a resolution (or by its
     * soft-delete cascade) and to compute the per-project ready-to-retry set
     * (every entry here must have an active resolution).
     *
     * <p>NULL when no v1-type missing inputs are present (either the status
     * isn't {@code insufficient_context} or every surfaced missing input is an
     * out-of-v1 type -- decisions, baselines, etc. -- which never produces a
     * key entry).</p>
     *
     * <p>BOXED {@link java.util.List} reference type (never a primitive
     * collection) per {@code project_primitive_double_dto_overwrite.md} so a
     * PATCH that omits the field never silently wipes the column.</p>
     */
    @Type(JsonType.class)
    @Column(name = "missing_input_keys_json", columnDefinition = "jsonb")
    private List<String> missingInputKeysJson;

    /**
     * Discriminator for the existing {@link #stale} flag. Allowed values:
     * {@code target_architecture_changed} (set by the target-arch authoring
     * flow's mark-stale handler) or {@code resolution_reset} (set by THIS
     * spec's soft-delete cascade). DB CHECK constraint
     * {@code chk_msg_stale_reason} (Liquibase changeset 150) is the source
     * of truth.
     *
     * <p>NULL when {@link #stale} is NULL/FALSE. Both fields are cleared
     * together on successful regeneration; both are set together on
     * mark-stale or on soft-delete cascade. When a cascade fires on a row
     * that is already stale for {@code target_architecture_changed}, the
     * reason is overwritten to {@code resolution_reset} (the most recent
     * triggering event).</p>
     *
     * <p>BOXED {@link String} per
     * {@code project_primitive_double_dto_overwrite.md}.</p>
     */
    @Column(name = "stale_reason", length = 32)
    private String staleReason;

    // ------------------------------------------------------------------
    // End missing-input-resolver columns
    // ------------------------------------------------------------------

    // ------------------------------------------------------------------
    // Spec Quality Scoring columns (Liquibase changeset 153)
    // Spec: 2026-05-20-spec-quality-scoring -- Task Group 1
    // ------------------------------------------------------------------

    /**
     * Composite 0-100 quality score (weighted average of the five sub-
     * dimensions: completeness 30, ac_measurability 25,
     * implementation_concreteness 20, evidence_density 15,
     * sibling_parent_alignment 10) computed at persist time by
     * {@code SpecQualityScorer}.
     *
     * <p>NULL when {@link #status} is {@code insufficient_context} or
     * {@code failed} (scoring skipped per spec -- do NOT compute zero, that
     * would falsely lump these rows in with F-graded specs that DO have
     * content) or when the row pre-dates this deploy and has not yet been
     * caught up by the bulk recompute endpoint.</p>
     *
     * <p>BOXED {@link Integer} (NOT primitive {@code int}) per
     * {@code project_primitive_double_dto_overwrite.md}: a primitive would
     * silently default to {@code 0} on a PATCH that omits the field and could
     * wipe a previously-computed score. CHECK constraint
     * {@code chk_msg_quality_score} (0..100) is the source of truth at the
     * database boundary.</p>
     */
    @Column(name = "quality_score", columnDefinition = "int2")
    private Integer qualityScore;

    /**
     * Letter-grade band (A / B / C / D / F) derived from {@link #qualityScore}
     * using the pinned thresholds: A &gt;= 85, B 70-84, C 55-69, D 40-54,
     * F &lt; 40. Drives the hierarchy grade chip and the dashboard grade
     * filter.
     *
     * <p>NULL whenever {@link #qualityScore} is NULL. DB CHECK constraint
     * {@code chk_msg_quality_grade} restricts the vocabulary to the five
     * letter codes.</p>
     *
     * <p>BOXED {@link String} per
     * {@code project_primitive_double_dto_overwrite.md}.</p>
     */
    @Column(name = "quality_grade", length = 1)
    private String qualityGrade;

    /**
     * Per-sub-dimension scoring breakdown produced by
     * {@code SpecQualityScorer}. Each entry is a map with three keys:
     * {@code dimension} (the sub-dimension name), {@code score} (its 0-100
     * sub-score) and {@code reason} (a templated human-readable phrase
     * explaining the score). Rendered as five rows in the drawer
     * "Quality breakdown" section.
     *
     * <p>NULL whenever {@link #qualityScore} is NULL.</p>
     *
     * <p>Stored as JSONB; mapped through Hibernate's {@code JsonType} to mirror
     * the existing {@code decisions_json} / {@code interfaces_json} /
     * {@code assumptions_json} / {@code warnings_json} pattern. BOXED
     * {@link java.util.List} of {@link java.util.Map} per
     * {@code project_primitive_double_dto_overwrite.md}.</p>
     */
    @Type(JsonType.class)
    @Column(name = "quality_dimensions_json", columnDefinition = "jsonb")
    private List<Map<String, Object>> qualityDimensionsJson;

    /**
     * Single immediately-previous {@link #qualityScore} captured at overwrite
     * time. Drives the drawer delta chip ONLY when the letter grade derived
     * from this previous score differs from the current
     * {@link #qualityGrade} (same-letter numeric moves are intentionally
     * suppressed as noise per the v1 spec).
     *
     * <p>NULL on first-time scoring (no prior value to capture). NULL also on
     * rows that were re-scored from a NULL prior (e.g. previously
     * {@code insufficient_context}, now {@code generated}).</p>
     *
     * <p>BOXED {@link Integer} per
     * {@code project_primitive_double_dto_overwrite.md}. CHECK constraint
     * {@code chk_msg_previous_quality_score} (0..100) mirrors the score
     * column's range.</p>
     */
    @Column(name = "previous_quality_score", columnDefinition = "int2")
    private Integer previousQualityScore;

    // ------------------------------------------------------------------
    // End spec-quality-scoring columns
    // ------------------------------------------------------------------

    // ------------------------------------------------------------------
    // Manual-edit + prior-version columns (Liquibase changeset 154)
    // Spec: 2026-05-20-in-product-spec-editor-confirm-overwrite -- Task Group 1
    // ------------------------------------------------------------------

    /**
     * TRUE once a user has saved a manual edit through the drawer
     * {@code applyManualEdit} endpoint; cleared back to {@code false} on a
     * successful LLM regeneration with {@code overwriteManuallyEdited=true}
     * (the row is LLM-generated again, no longer user-edited).
     *
     * <p>BOXED {@link Boolean} (NOT primitive {@code boolean}) per
     * {@code project_primitive_double_dto_overwrite.md}: a primitive would
     * silently default to {@code false} on a PATCH that omits the field and
     * could wipe a previously-set {@code true} flag. The DB column is
     * {@code NOT NULL DEFAULT false} (changeset 154); the entity's
     * {@code @PrePersist} mirrors that default so a builder that omits the
     * field still inserts cleanly.</p>
     *
     * <p>Drives the hierarchy "Edited" chip, the drawer-header indicator,
     * and the single-story + bulk overwrite-confirmation modals.</p>
     */
    @Column(name = "manually_edited", nullable = false)
    @Builder.Default
    private Boolean manuallyEdited = Boolean.FALSE;

    /**
     * Wall-clock timestamp of the most recent manual save. NULL until the
     * first manual edit. Drives the drawer-header "Last edited by {user}
     * on {date}" tooltip and the bulk-overwrite picker row labels.
     */
    @Column(name = "last_manually_edited_at")
    private Instant lastManuallyEditedAt;

    /**
     * Identity of the user who last manually saved this spec. Sourced from
     * the {@code X-User-Id} request header on the {@code applyManualEdit}
     * endpoint, NOT from the request body (the body is restricted to
     * {@code specText} only). NULL until the first manual edit.
     *
     * <p>BOXED {@link String} per
     * {@code project_primitive_double_dto_overwrite.md}.</p>
     */
    @Column(name = "last_manually_edited_by", length = 255)
    private String lastManuallyEditedBy;

    /**
     * Single-slot prior version of {@link #generatedSpecText} captured
     * BEFORE every manual save and BEFORE every
     * {@code overwriteManuallyEdited=true} regenerate. Drives the drawer
     * "View previous version" diff toggle. We keep ONE prior value only;
     * no full edit-history table.
     *
     * <p>NULL until the first save captures a prior version. BOXED
     * {@link String} per {@code project_primitive_double_dto_overwrite.md}.</p>
     */
    @Column(name = "previous_spec_text", columnDefinition = "TEXT")
    private String previousSpecText;

    /**
     * Manual-ready marker (Phase 1a, 2026-07-20; changeset 214). Set — story
     * by story, never in bulk — when the user has supplied/edited the spec for
     * a tool-unresolvable story and explicitly accepted it as ready. The
     * Phase 1b stage gate treats {@code status IN (generated,
     * generated_with_warnings) OR manual_ready} as satisfied. Never set by
     * the tool itself.
     */
    @Column(name = "manual_ready", nullable = false)
    @Builder.Default
    private Boolean manualReady = Boolean.FALSE;

    /** Wall-clock timestamp of the manual-ready mark; NULL when unmarked. */
    @Column(name = "manual_ready_at")
    private Instant manualReadyAt;

    /** X-User-Id of the marker (audit; never from the request body). */
    @Column(name = "manual_ready_by", length = 255)
    private String manualReadyBy;

    // ------------------------------------------------------------------
    // End manual-edit columns
    // ------------------------------------------------------------------


    /**
     * Timestamp at which the LLM call completed successfully. Null on
     * {@code failed} / {@code insufficient_context} / {@code skipped_blocked}
     * rows.
     */
    @Column(name = "generated_at")
    private Instant generatedAt;

    @Column(name = "error_message", columnDefinition = "TEXT")
    private String errorMessage;

    /**
     * Bumped by the gateway on explicit "Regenerate all (including generated)"
     * runs (R-8). Default {@code 0} for first attempt.
     *
     * <p>BOXED {@link Integer} (NOT primitive {@code int}) per
     * {@code project_primitive_double_dto_overwrite.md}: a primitive would
     * silently default to {@code 0} on a PATCH that omits the field, and
     * could wipe a previously-bumped attempt count.</p>
     */
    @Column(name = "generation_attempt_number", nullable = false)
    @Builder.Default
    private Integer generationAttemptNumber = 0;

    /**
     * Producer task id. Defaults to
     * {@code product-manager--migration-shape-spec-generation}. Manual-edit
     * protection (acceptance signal 17): if this drifts from the generator's
     * task id, the service rejects overwrite without
     * {@code confirmOverwrite=true}.
     */
    @Column(name = "created_by_task", length = 128)
    @Builder.Default
    private String createdByTask = "product-manager--migration-shape-spec-generation";

    @Column(name = "created_at", nullable = false, updatable = false)
    @Builder.Default
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    @Builder.Default
    private Instant updatedAt = Instant.now();

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
        if (updatedAt == null) {
            updatedAt = Instant.now();
        }
        if (generationAttemptNumber == null) {
            generationAttemptNumber = 0;
        }
        if (createdByTask == null) {
            createdByTask = "product-manager--migration-shape-spec-generation";
        }
        if (generationPass == null) {
            generationPass = 1;
        }
        if (manuallyEdited == null) {
            manuallyEdited = Boolean.FALSE;
        }
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = Instant.now();
    }
}
