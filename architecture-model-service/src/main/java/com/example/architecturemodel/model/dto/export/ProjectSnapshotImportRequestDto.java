package com.example.architecturemodel.model.dto.export;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Data Transfer Object for importing a project snapshot.
 *
 * Contains the snapshot data and import options for creating a new project
 * from a previously exported Project Snapshot JSON.
 *
 * Spec 2026-01-06: Project Snapshot JSON Import
 * Spec 2026-01-07: Overwrite Existing Project Option for Snapshot Import
 *
 * @param snapshot The exported snapshot data to import (required)
 * @param importAsName Optional override for the project name; if omitted, uses snapshot.project.name
 * @param projectParentFolder Local path for the new project environment (optional, falls back to snapshot.project.projectParentFolder)
 * @param setActive Whether to activate the imported project (default true)
 * @param overwriteExistingProject Whether to overwrite an existing project with the same name (default false)
 */
public record ProjectSnapshotImportRequestDto(
    @JsonProperty("snapshot")
    ProjectSnapshotDto snapshot,

    @JsonProperty("import_as_name")
    @JsonAlias({"importAsName", "import_as_name"})
    String importAsName,

    @JsonProperty("project_parent_folder")
    @JsonAlias({"projectParentFolder", "project_parent_folder"})
    String projectParentFolder,

    @JsonProperty("set_active")
    @JsonAlias({"setActive", "set_active"})
    Boolean setActive,

    @JsonProperty("overwrite_existing_project")
    @JsonAlias({"overwriteExistingProject", "overwrite_existing_project"})
    Boolean overwriteExistingProject
) {
    /**
     * Returns setActive with default value of true if not specified.
     *
     * @return true if setActive is null or true, false otherwise
     */
    public boolean effectiveSetActive() {
        return setActive == null || setActive;
    }

    /**
     * Returns overwriteExistingProject with default value of false if not specified.
     *
     * Spec 2026-01-07: Overwrite Existing Project Option for Snapshot Import
     * Safe-by-default: overwrite is disabled when not explicitly enabled.
     *
     * @return true if overwriteExistingProject is explicitly true, false otherwise
     */
    public boolean effectiveOverwriteExistingProject() {
        return overwriteExistingProject != null && overwriteExistingProject;
    }

    /**
     * Returns the effective project name to use for import.
     *
     * If importAsName is provided and not blank, uses that.
     * Otherwise, uses the project name from the snapshot.
     *
     * @return the effective project name
     */
    public String effectiveProjectName() {
        if (importAsName != null && !importAsName.isBlank()) {
            return importAsName;
        }
        if (snapshot != null && snapshot.project() != null) {
            return snapshot.project().name();
        }
        return null;
    }

    /**
     * Returns the effective project parent folder to use for import.
     *
     * If projectParentFolder is provided and not blank, uses that.
     * Otherwise, falls back to the project parent folder from the snapshot.
     *
     * @return the effective project parent folder, or null if neither is available
     */
    public String effectiveProjectParentFolder() {
        if (projectParentFolder != null && !projectParentFolder.isBlank()) {
            return projectParentFolder;
        }
        if (snapshot != null && snapshot.project() != null &&
            snapshot.project().projectParentFolder() != null &&
            !snapshot.project().projectParentFolder().isBlank()) {
            return snapshot.project().projectParentFolder();
        }
        return null;
    }
}
