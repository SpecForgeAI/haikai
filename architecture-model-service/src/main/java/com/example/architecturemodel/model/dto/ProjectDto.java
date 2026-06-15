package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonAlias;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * DTO for Project entity.
 *
 * Uses Java record with camelCase field names for API responses.
 * Maps to/from ProjectEntity via ProjectMapper.
 *
 * Spec 2026-01-05: Project Model with Active Project
 * Spec 2026-01-07: Fix ProjectDto JSON Deserialization - Added @JsonAlias annotations
 *                  to accept camelCase field names during JSON deserialization while
 *                  preserving snake_case output (via global Jackson SNAKE_CASE strategy).
 * Spec 2026-01-10: Project Hierarchy Grouping - Added projectHierarchy field
 * Spec 2026-01-18: Organisations Iteration 1 - Added organisationId field
 * Spec 2026-01-18: Organisation ID Type Change (UUID to TEXT) - Changed organisationId from UUID to String
 * Spec 2026-03-21: Project Repo URL - Added repoUrl field
 * Spec 2026-05-20: Cross-Story Context Injection (Task Group 9) - Added
 *   {@code perStoryContextTokenCap}, {@code crossStoryContextTokenCap}, and
 *   {@code autoRunPass2}. All three are BOXED reference types (Integer /
 *   Boolean) so PATCH semantics preserve null when the caller omits the field.
 *   A 9-arg compatibility constructor delegates to the canonical constructor
 *   with the three new fields defaulted to null, so existing callers and test
 *   fixtures continue to compile without modification.
 * Spec 2026-05-20: Bulk-Resolve OAS/WSDL Parser (Task Group 1) - Added
 *   {@code maxContractUploadFileSizeMb}. BOXED Integer so PATCH semantics
 *   preserve null when the caller omits the field.
 * Spec 2026-06-12: Implementation-Service Init and Integration Repair (Task
 *   Group 1) - Added {@code implementationInitSuccess} (BOXED Boolean --
 *   PATCH-mutable per project_primitive_double_dto_overwrite.md),
 *   {@code implementationMode}, {@code implementationProjectDir}, and
 *   {@code implementationRepos} (the workspace repo map, attached on project
 *   reads by the controller; null when not loaded). The 9/12/13-arg
 *   compatibility constructors delegate to the canonical 17-arg constructor
 *   with the later-added fields defaulted to null.
 */
public record ProjectDto(
    UUID id,
    String name,
    @JsonAlias("projectParentFolder")
    String projectParentFolder,
    @JsonAlias("projectHierarchy")
    String projectHierarchy,
    @JsonAlias("organisationId")
    String organisationId,
    @JsonAlias("repoUrl")
    String repoUrl,
    @JsonAlias("isActive")
    Boolean isActive,
    @JsonAlias("createdAt")
    Instant createdAt,
    @JsonAlias("updatedAt")
    Instant updatedAt,
    @JsonAlias("perStoryContextTokenCap")
    Integer perStoryContextTokenCap,
    @JsonAlias("crossStoryContextTokenCap")
    Integer crossStoryContextTokenCap,
    @JsonAlias("autoRunPass2")
    Boolean autoRunPass2,
    @JsonAlias("maxContractUploadFileSizeMb")
    Integer maxContractUploadFileSizeMb,
    @JsonAlias("implementationInitSuccess")
    Boolean implementationInitSuccess,
    @JsonAlias("implementationMode")
    String implementationMode,
    @JsonAlias("implementationProjectDir")
    String implementationProjectDir,
    @JsonAlias("implementationRepos")
    List<ProjectImplementationRepoDto> implementationRepos
) {

    /**
     * Backward-compatible 9-arg constructor preserving the pre-Task-Group-9
     * signature. Delegates to the canonical 17-arg constructor with the
     * later-added fields defaulted to {@code null}.
     */
    public ProjectDto(
            UUID id,
            String name,
            String projectParentFolder,
            String projectHierarchy,
            String organisationId,
            String repoUrl,
            Boolean isActive,
            Instant createdAt,
            Instant updatedAt) {
        this(id, name, projectParentFolder, projectHierarchy, organisationId,
            repoUrl, isActive, createdAt, updatedAt, null, null, null, null,
            null, null, null, null);
    }

    /**
     * Backward-compatible 12-arg constructor preserving the post-Task-Group-9
     * (pre Bulk-Resolve OAS/WSDL Parser) signature. Delegates to the
     * canonical 17-arg constructor with the later-added fields defaulted to
     * {@code null}.
     *
     * Spec 2026-05-20: Bulk-Resolve OAS/WSDL Parser -- Task Group 1
     */
    public ProjectDto(
            UUID id,
            String name,
            String projectParentFolder,
            String projectHierarchy,
            String organisationId,
            String repoUrl,
            Boolean isActive,
            Instant createdAt,
            Instant updatedAt,
            Integer perStoryContextTokenCap,
            Integer crossStoryContextTokenCap,
            Boolean autoRunPass2) {
        this(id, name, projectParentFolder, projectHierarchy, organisationId,
            repoUrl, isActive, createdAt, updatedAt,
            perStoryContextTokenCap, crossStoryContextTokenCap, autoRunPass2,
            null, null, null, null, null);
    }

    /**
     * Backward-compatible 13-arg constructor preserving the
     * pre-Implementation-Init signature. Delegates to the canonical 17-arg
     * constructor with the implementation-init fields defaulted to
     * {@code null}.
     *
     * Spec 2026-06-12: Implementation-Service Init and Integration Repair -- Task Group 1
     */
    public ProjectDto(
            UUID id,
            String name,
            String projectParentFolder,
            String projectHierarchy,
            String organisationId,
            String repoUrl,
            Boolean isActive,
            Instant createdAt,
            Instant updatedAt,
            Integer perStoryContextTokenCap,
            Integer crossStoryContextTokenCap,
            Boolean autoRunPass2,
            Integer maxContractUploadFileSizeMb) {
        this(id, name, projectParentFolder, projectHierarchy, organisationId,
            repoUrl, isActive, createdAt, updatedAt,
            perStoryContextTokenCap, crossStoryContextTokenCap, autoRunPass2,
            maxContractUploadFileSizeMb, null, null, null, null);
    }

    /**
     * Returns a copy of this DTO with {@code implementationRepos} replaced.
     * Used by the controller layer to attach the stored workspace repo map on
     * project reads without the mapper needing repository access.
     *
     * Spec 2026-06-12: Implementation-Service Init and Integration Repair -- Task Group 1
     */
    public ProjectDto withImplementationRepos(List<ProjectImplementationRepoDto> repos) {
        return new ProjectDto(id, name, projectParentFolder, projectHierarchy,
            organisationId, repoUrl, isActive, createdAt, updatedAt,
            perStoryContextTokenCap, crossStoryContextTokenCap, autoRunPass2,
            maxContractUploadFileSizeMb, implementationInitSuccess,
            implementationMode, implementationProjectDir, repos);
    }
}
