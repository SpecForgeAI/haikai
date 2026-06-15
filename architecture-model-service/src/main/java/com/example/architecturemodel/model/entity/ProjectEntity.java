package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;
import java.util.UUID;

/**
 * JPA Entity for Project.
 *
 * Maps to the project table. Represents a first-class Project concept
 * enabling the tool to manage multiple projects while operating on
 * exactly one "active" project at a time.
 *
 * Spec 2026-01-05: Project Model with Active Project
 * Spec 2026-01-10: Project Hierarchy Grouping - Added projectHierarchy field
 * Spec 2026-01-18: Organisations Iteration 1 - Added organisationId field
 * Spec 2026-01-18: Organisation ID Type Change (UUID to TEXT) - Changed organisationId from UUID to String
 * Spec 2026-03-21: Project Repo URL - Added repoUrl field
 * Spec 2026-05-20: Cross-Story Context Injection (Task Group 9) - Added
 *   {@code perStoryContextTokenCap}, {@code crossStoryContextTokenCap}, and
 *   {@code autoRunPass2} fields. All three are BOXED reference types so PATCH
 *   semantics preserve null per project_primitive_double_dto_overwrite.md.
 * Spec 2026-05-20: Bulk-Resolve OAS/WSDL Parser (Task Group 1) - Added
 *   {@code maxContractUploadFileSizeMb} field. BOXED Integer so PATCH
 *   semantics preserve null per project_primitive_double_dto_overwrite.md.
 */
@Entity
@Table(name = "project")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ProjectEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "project_parent_folder", nullable = false)
    private String projectParentFolder;

    /**
     * Optional logical grouping for organizing projects in menus.
     * Null for projects without a hierarchy assignment.
     * Displayed as "(No hierarchy)" in UI when null.
     *
     * Spec 2026-01-10: Project Hierarchy Grouping
     */
    @Column(name = "project_hierarchy", nullable = true)
    private String projectHierarchy;

    /**
     * Optional reference to the organisation that owns this project.
     * Nullable to support safe migration - existing projects will have NULL
     * until manually backfilled. Future iteration will enforce NOT NULL.
     *
     * Spec 2026-01-18: Organisations Iteration 1 - Add Organisation Model + Project FK + APIs
     * Spec 2026-01-18: Organisation ID Type Change (UUID to TEXT) - Changed from UUID to String
     */
    @Column(name = "organisation_id", nullable = true)
    private String organisationId;

    /**
     * Git repository URL for the project (e.g., "https://github.com/acme/backend.git").
     * Nullable for safe migration - existing projects will have NULL until backfilled.
     *
     * Spec 2026-03-21: Project Repo URL
     */
    @Column(name = "repo_url", nullable = true)
    private String repoUrl;

    @Column(name = "is_active", nullable = false)
    @Builder.Default
    private Boolean isActive = false;

    @Column(name = "created_at", nullable = false, updatable = false)
    @Builder.Default
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    @Builder.Default
    private Instant updatedAt = Instant.now();

    // -------------------------------------------------------------------------
    // Cross-Story Context Injection per-project configuration
    // Spec: 2026-05-20 -- Task Group 9
    //
    // The three fields below configure the bounded two-pass shape-spec
    // generator. All three are BOXED reference types (Integer / Boolean) so
    // PATCH semantics preserve null per project_primitive_double_dto_overwrite.md
    // -- Jackson would map a missing JSON field on a PATCH to the primitive
    // default (0 / false) and silently wipe an explicit user setting. The DB
    // DEFAULT clauses (24000 / 12000 / TRUE) supply the documented fallback
    // values for existing rows.
    //
    // The AMS resolver (MigrationSpecContextResolver) reads these columns
    // before constructing BudgetMetaTracker; if a value is null (which should
    // not happen given the DB DEFAULTs but is defensively handled) the tracker
    // falls back to its compile-time DEFAULT_*_TOKEN_CAP constants.
    // -------------------------------------------------------------------------

    /**
     * Per-project cap on tokens spent on per-story content (focused context,
     * evidence refs, findings) when assembling each shape-spec generation
     * payload. DB default 24000 (mirrors
     * {@code BudgetMetaTracker.DEFAULT_PER_STORY_TOKEN_CAP}). Nullable so PATCH
     * preserves null per the standing project rule.
     *
     * Spec 2026-05-20: Cross-Story Context Injection -- Task Group 9
     */
    @Column(name = "per_story_context_token_cap", nullable = true)
    private Integer perStoryContextTokenCap;

    /**
     * Per-project cap on tokens spent on cross-story content (sibling
     * summaries, workstream context) when assembling each pass-2 shape-spec
     * generation payload. DB default 12000 (mirrors
     * {@code BudgetMetaTracker.DEFAULT_CROSS_STORY_TOKEN_CAP}). Nullable.
     *
     * Spec 2026-05-20: Cross-Story Context Injection -- Task Group 9
     */
    @Column(name = "cross_story_context_token_cap", nullable = true)
    private Integer crossStoryContextTokenCap;

    /**
     * Per-project default for whether the gateway should automatically run
     * pass 2 after pass 1 completes during a batch Generate-all. DB default
     * TRUE. The per-batch toggle in the Generate-all dialog defaults to this
     * value; setting it to false leaves a manual "Regenerate with sibling
     * context" action. Nullable.
     *
     * Spec 2026-05-20: Cross-Story Context Injection -- Task Group 9
     */
    @Column(name = "auto_run_pass_2", nullable = true)
    private Boolean autoRunPass2;

    // -------------------------------------------------------------------------
    // Bulk-Resolve OAS/WSDL Parser per-project configuration
    // Spec: 2026-05-20 -- Task Group 1 (changeset 152)
    //
    // The field below configures the file-size cap (in MB) for OAS/WSDL
    // contract uploads on the new parse-files endpoint. BOXED Integer per
    // project_primitive_double_dto_overwrite.md -- a primitive int default of
    // 0 would silently wipe an explicit user setting on a PATCH that omits
    // the field. The DB DEFAULT 10 supplies the documented fallback for both
    // newly-created and pre-existing rows.
    //
    // Two-layer defaulting posture: AMS reads this column via ProjectRepository
    // in the parse-files endpoint; if the value is null (which should not
    // happen given the DB DEFAULT but is defensively handled per the spec's
    // "defence in depth" note) the endpoint falls back to a 10MB constant in
    // code. The gateway proxy mirrors the same fallback for its multer cap.
    // -------------------------------------------------------------------------

    /**
     * Per-project cap (in megabytes) on the size of each individual OAS/WSDL
     * contract file uploaded to the parse-files endpoint
     * ({@code POST /api/projects/{projectId}/missing-input-resolutions/parse-files}).
     * DB default 10. Boxed {@link Integer} so PATCH preserves null per
     * {@code project_primitive_double_dto_overwrite.md}.
     *
     * <p>The endpoint enforces the cap BEFORE reading bytes into memory;
     * over-cap files are marked failed with reason {@code file_size_exceeded}
     * and never consume parser memory. The frontend project-settings screen
     * exposes this as a single integer input under the new "Uploads" section
     * (client-side validation: min 1, max 200).</p>
     *
     * <p>Defence-in-depth fallback: if the column is null (should not happen
     * given the DB DEFAULT but is defensively handled), the endpoint and the
     * gateway proxy both fall back to a 10MB constant in code.</p>
     *
     * Spec 2026-05-20: Bulk-Resolve OAS/WSDL Parser -- Task Group 1
     */
    @Column(name = "max_contract_upload_file_size_mb", nullable = true)
    private Integer maxContractUploadFileSizeMb;

    // -------------------------------------------------------------------------
    // Implementation-service workspace init status
    // Spec: 2026-06-12 Implementation-Service Init and Integration Repair -- Task Group 1
    // (Liquibase changeset 180)
    //
    // Outcome of the external implementation service's POST /projects/init for
    // this project. implementationInitSuccess is a BOXED Boolean per
    // project_primitive_double_dto_overwrite.md -- it is PATCH-mutable and a
    // primitive boolean would silently wipe TRUE to false whenever a PATCH
    // omitted the field. All three columns are nullable, no backfill: NULL =
    // init never attempted (pre-feature projects); the Implementation-gate
    // modal is the conversion path.
    // -------------------------------------------------------------------------

    /**
     * Whether the external POST /projects/init workspace registration
     * succeeded. NULL = never attempted, FALSE = attempted and failed (the
     * project is still created -- init never blocks creation), TRUE =
     * workspace registered. Boxed {@link Boolean} so PATCH preserves the
     * stored value when the caller omits the field.
     *
     * Spec 2026-06-12: Implementation-Service Init and Integration Repair -- Task Group 1
     */
    @Column(name = "implementation_init_success", nullable = true)
    private Boolean implementationInitSuccess;

    /**
     * Overall workspace mode from ProjectInitResponse:
     * 'brownfield' | 'greenfield' | 'polyrepo'. Null until init succeeds.
     *
     * Spec 2026-06-12: Implementation-Service Init and Integration Repair -- Task Group 1
     */
    @Column(name = "implementation_mode", nullable = true)
    private String implementationMode;

    /**
     * Product workspace root directory (parent of all repo sub-dirs) from
     * ProjectInitResponse.project_dir. Null until init succeeds.
     *
     * Spec 2026-06-12: Implementation-Service Init and Integration Repair -- Task Group 1
     */
    @Column(name = "implementation_project_dir", nullable = true)
    private String implementationProjectDir;

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
        if (updatedAt == null) {
            updatedAt = Instant.now();
        }
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = Instant.now();
    }
}
