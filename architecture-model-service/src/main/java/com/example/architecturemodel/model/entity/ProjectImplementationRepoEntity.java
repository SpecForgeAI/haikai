package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;
import java.util.UUID;

/**
 * JPA Entity for the implementation-service workspace repo map.
 *
 * <p>Maps to the {@code project_implementation_repos} table (Liquibase
 * changeset 180). One row per repo in the workspace map: a folder alias
 * paired with its git remote URL, plus the per-repo init outcome
 * ({@code workspace_dir} = cloned sub-directory, {@code mode} =
 * brownfield/greenfield) once {@code POST /projects/init} has succeeded.</p>
 *
 * <p>The map is replaced wholesale by the gateway's full-map sync -- the
 * external implementation service is the source of truth for what is
 * actually cloned (drift auto-sync, external-wins; no per-row CRUD in AMS).</p>
 *
 * <p>Bare UUID FK only (no {@code @ManyToOne} relationship), consistent with
 * the {@code projectId} pattern used by {@link WorkItemEntity}. The DB-level
 * FK has {@code ON DELETE CASCADE} so project deletion removes the map.</p>
 *
 * Spec 2026-06-12: Implementation-Service Init and Integration Repair -- Task Group 1
 */
@Entity
@Table(
    name = "project_implementation_repos",
    uniqueConstraints = @UniqueConstraint(
        name = "uq_project_implementation_repos_project_folder",
        columnNames = {"project_id", "folder"}
    )
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ProjectImplementationRepoEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    /** Folder alias (sub-directory under the product workspace root). */
    @Column(name = "folder", nullable = false)
    private String folder;

    /** Git remote URL for this folder. */
    @Column(name = "git_url", nullable = false)
    private String gitUrl;

    /** Absolute path of the cloned sub-directory (RepoInitResult.dir); null until known. */
    @Column(name = "workspace_dir", nullable = true)
    private String workspaceDir;

    /** Per-repo detected mode from init: brownfield | greenfield; null until known. */
    @Column(name = "mode", nullable = true)
    private String mode;

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
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = Instant.now();
    }
}
