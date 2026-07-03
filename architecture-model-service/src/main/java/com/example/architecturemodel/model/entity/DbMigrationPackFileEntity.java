package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;
import java.util.Set;
import java.util.UUID;

/**
 * JPA Entity for one generated DB migration pack file (Liquibase changeset
 * 173). All generated content persists as TEXT rows -- no filesystem, no
 * binary store; the download zip is assembled on demand with
 * {@link #filePath} as the zip entry path.
 *
 * <p>Regeneration REPLACES the file set wholesale (delete by pack + insert)
 * while the owning {@link DbMigrationPackEntity} row is updated in place.
 * {@code pack_id} carries an {@code ON DELETE CASCADE} FK in the DDL.</p>
 *
 * <p>{@link #sortOrder} is a boxed {@link Integer} per
 * {@code project_primitive_double_dto_overwrite.md}.</p>
 *
 * <p>Spec: Source-Grade DB Schema + Data Migration Pack (2026-06-11) --
 * Task Group 1.</p>
 */
@Entity
@Table(
    name = "db_migration_pack_files",
    indexes = {
        @Index(name = "idx_dmpf_pack_sort", columnList = "pack_id, sort_order", unique = false)
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DbMigrationPackFileEntity {

    public static final String KIND_LIQUIBASE_MASTER = "liquibase_master";
    public static final String KIND_LIQUIBASE_CHANGESET = "liquibase_changeset";
    public static final String KIND_BULK_LOAD_SCRIPT = "bulk_load_script";
    public static final String KIND_INCREMENTAL_SCRIPT = "incremental_script";
    public static final String KIND_MANIFEST = "manifest";
    public static final String KIND_README = "readme";

    /**
     * Emitted APPROVED-translation file rows ONLY (Spec 2026-06-11 DB Object
     * Translation Drafts, TG2; chk_dmpf_file_kind extended by changeset 177).
     * Drafts NEVER become file rows -- they live in
     * {@code db_migration_pack_translations} until explicitly approved.
     */
    public static final String KIND_TRANSLATION = "translation";

    /**
     * Side-by-side operation kinds (Spec 2026-07-02-d, Persistence-Tier
     * Oracle Program; chk_dmpf_file_kind extended by changeset 204): the
     * rerunnable daily incremental sync runner + high-water state DDL, the
     * per-run source/target reconciliation queries + report builder, and the
     * swap-over runbook.
     */
    public static final String KIND_SYNC_RUNNER = "sync_runner";
    public static final String KIND_RECONCILIATION_SCRIPT = "reconciliation_script";
    public static final String KIND_CUTOVER_RUNBOOK = "cutover_runbook";

    /** All allowed file kinds, mirroring chk_dmpf_file_kind (changesets 173 + 177 + 204). */
    public static final Set<String> ALL_KINDS = Set.of(
        KIND_LIQUIBASE_MASTER,
        KIND_LIQUIBASE_CHANGESET,
        KIND_BULK_LOAD_SCRIPT,
        KIND_INCREMENTAL_SCRIPT,
        KIND_MANIFEST,
        KIND_README,
        KIND_TRANSLATION,
        KIND_SYNC_RUNNER,
        KIND_RECONCILIATION_SCRIPT,
        KIND_CUTOVER_RUNBOOK
    );

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "pack_id", nullable = false)
    private UUID packId;

    /**
     * Relative path inside the download zip, e.g.
     * {@code liquibase/changesets/010-tables/dbo.orders.sql}.
     */
    @Column(name = "file_path", nullable = false, columnDefinition = "TEXT")
    private String filePath;

    /** One of {@link #ALL_KINDS}; chk_dmpf_file_kind is the source of truth. */
    @Column(name = "file_kind", nullable = false, length = 32)
    private String fileKind;

    /**
     * The full file text. Checksum-stable: regeneration over identical inputs
     * is byte-identical for unchanged objects.
     */
    @Column(name = "content", columnDefinition = "TEXT")
    private String content;

    /** Deterministic ordering inside the pack. Boxed Integer -- PATCH-safe. */
    @Column(name = "sort_order")
    private Integer sortOrder;

    @Column(name = "created_at", nullable = false, updatable = false)
    @Builder.Default
    private Instant createdAt = Instant.now();

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }
}
