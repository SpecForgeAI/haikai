package com.example.architecturemodel.model.dto.export;

import com.example.architecturemodel.model.dto.ProjectDto;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * Data Transfer Object for the result of importing a project snapshot.
 *
 * Contains the newly created project and import statistics.
 *
 * Spec 2026-01-06: Project Snapshot JSON Import
 *
 * @param project The newly created project with id, name, projectParentFolder, isActive
 * @param modelSaved Indicates whether the model was successfully persisted
 * @param workItemsInserted Count of work items imported
 * @param artifactsInserted Count of artifacts imported
 * @param warnings Optional warnings (empty in v1)
 */
public record ProjectSnapshotImportResultDto(
    @JsonProperty("project")
    ProjectDto project,

    @JsonProperty("model_saved")
    boolean modelSaved,

    @JsonProperty("work_items_inserted")
    int workItemsInserted,

    @JsonProperty("artifacts_inserted")
    int artifactsInserted,

    @JsonProperty("warnings")
    List<String> warnings
) {
    /**
     * Creates a result with empty warnings list.
     *
     * @param project The newly created project
     * @param modelSaved Whether the model was saved
     * @param workItemsInserted Count of work items inserted
     * @param artifactsInserted Count of artifacts inserted
     * @return A new ProjectSnapshotImportResultDto with empty warnings
     */
    public static ProjectSnapshotImportResultDto of(
            ProjectDto project,
            boolean modelSaved,
            int workItemsInserted,
            int artifactsInserted) {
        return new ProjectSnapshotImportResultDto(
            project,
            modelSaved,
            workItemsInserted,
            artifactsInserted,
            List.of()
        );
    }
}
