package com.example.architecturemodel.model.dto.export;

import com.example.architecturemodel.model.dto.ArchitectureModelDto;
import com.example.architecturemodel.model.dto.ProjectArtifactDto;
import com.example.architecturemodel.model.dto.ProjectDto;
import com.example.architecturemodel.model.dto.WorkItemDto;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * Data Transfer Object for a complete project snapshot export.
 *
 * Contains all persisted state for an active project:
 * - Project identity and configuration
 * - Architecture model (metaModel entities/relationships and diagrams)
 * - Work items (initiatives, epics, features, stories)
 * - Project artifacts (mission.md, roadmap.md, backlog.md)
 *
 * Spec 2026-01-06: Project Snapshot JSON Export
 *
 * @param meta Snapshot metadata including version and export timestamp
 * @param project The project identity and configuration
 * @param model The architecture model with metaModel and diagrams
 * @param workItems List of all work items for the project
 * @param artifacts List of all project artifacts (versioned markdown files)
 */
public record ProjectSnapshotDto(
    @JsonProperty("meta")
    SnapshotMeta meta,

    @JsonProperty("project")
    ProjectDto project,

    @JsonProperty("model")
    ArchitectureModelDto model,

    @JsonProperty("work_items")
    List<WorkItemDto> workItems,

    @JsonProperty("artifacts")
    List<ProjectArtifactDto> artifacts
) {}
