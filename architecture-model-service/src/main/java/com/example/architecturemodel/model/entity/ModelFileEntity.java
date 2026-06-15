package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(name = "model_files")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ModelFileEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    /**
     * Filename for this model file. Uniqueness is enforced at the schema
     * level by Liquibase changeset 096
     * (`model_files_architecture_id_filename_uidx`) as a composite
     * (architecture_id, filename) UNIQUE INDEX -- NOT a column-level
     * `unique = true` here. The column-level annotation was removed in
     * Spec #6 (Multi-Architecture Full Clone, Task Group 8) so that the
     * full-clone workflow can preserve the source filename verbatim under
     * a brand-new architecture without colliding with the original.
     *
     * <p>See changeset
     * `096-model-files-filename-per-architecture-unique.sql` for the
     * production schema migration that drops the old global UNIQUE
     * constraint and adds the architecture-scoped composite index.</p>
     */
    @Column(name = "filename", nullable = false)
    private String filename;

    @Column(name = "description")
    private String description;

    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    @Column(name = "is_default", nullable = false)
    private Boolean isDefault;

    @Column(name = "tags")
    private String tags;

    @Column(name = "project_id")
    private UUID projectId;

    /**
     * Architecture this model file belongs to. Introduced by spec
     * "Multi-Architecture Plumbing" (Spec #1) -- every model file is now
     * scoped under exactly one architecture (one of which is the auto-created
     * "Default" per project, with id == project.id post-migration).
     */
    @Column(name = "architecture_id")
    private UUID architectureId;

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) {
            createdAt = OffsetDateTime.now();
        }
        if (updatedAt == null) {
            updatedAt = OffsetDateTime.now();
        }
        if (isDefault == null) {
            isDefault = false;
        }
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = OffsetDateTime.now();
    }
}
