package com.example.architecturemodel.mapper;

import com.example.architecturemodel.model.dto.ProjectDto;
import com.example.architecturemodel.model.entity.ProjectEntity;
import org.springframework.stereotype.Component;

/**
 * Mapper for converting between ProjectEntity and ProjectDto.
 *
 * Spec 2026-01-05: Project Model with Active Project
 * Spec 2026-01-10: Project Hierarchy Grouping - Added projectHierarchy mapping
 * Spec 2026-01-18: Organisations Iteration 1 - Added organisationId mapping
 * Spec 2026-03-21: Project Repo URL - Added repoUrl mapping
 * Spec 2026-05-20: Cross-Story Context Injection (Task Group 9) - Added
 *   perStoryContextTokenCap / crossStoryContextTokenCap / autoRunPass2 mappings.
 * Spec 2026-05-20: Bulk-Resolve OAS/WSDL Parser (Task Group 1) - Added
 *   maxContractUploadFileSizeMb mapping.
 * Spec 2026-06-12: Implementation-Service Init and Integration Repair (Task
 *   Group 1) - Added implementationInitSuccess / implementationMode /
 *   implementationProjectDir mappings. The implementationRepos list is NOT
 *   populated here (the mapper has no repository access); the controller
 *   attaches it via ProjectDto.withImplementationRepos on project reads.
 */
@Component
public class ProjectMapper {

    /**
     * Converts a ProjectEntity to ProjectDto.
     *
     * @param entity The project entity
     * @return ProjectDto with all fields
     */
    public ProjectDto toDto(ProjectEntity entity) {
        if (entity == null) {
            return null;
        }
        return new ProjectDto(
            entity.getId(),
            entity.getName(),
            entity.getProjectParentFolder(),
            entity.getProjectHierarchy(),
            entity.getOrganisationId(),
            entity.getRepoUrl(),
            entity.getIsActive(),
            entity.getCreatedAt(),
            entity.getUpdatedAt(),
            entity.getPerStoryContextTokenCap(),
            entity.getCrossStoryContextTokenCap(),
            entity.getAutoRunPass2(),
            entity.getMaxContractUploadFileSizeMb(),
            entity.getImplementationInitSuccess(),
            entity.getImplementationMode(),
            entity.getImplementationProjectDir(),
            null
        );
    }

    /**
     * Converts a ProjectDto to ProjectEntity.
     *
     * @param dto The project DTO
     * @return ProjectEntity with all fields
     */
    public ProjectEntity toEntity(ProjectDto dto) {
        if (dto == null) {
            return null;
        }
        return ProjectEntity.builder()
            .id(dto.id())
            .name(dto.name())
            .projectParentFolder(dto.projectParentFolder())
            .projectHierarchy(dto.projectHierarchy())
            .organisationId(dto.organisationId())
            .repoUrl(dto.repoUrl())
            .isActive(dto.isActive())
            .createdAt(dto.createdAt())
            .updatedAt(dto.updatedAt())
            .perStoryContextTokenCap(dto.perStoryContextTokenCap())
            .crossStoryContextTokenCap(dto.crossStoryContextTokenCap())
            .autoRunPass2(dto.autoRunPass2())
            .maxContractUploadFileSizeMb(dto.maxContractUploadFileSizeMb())
            .implementationInitSuccess(dto.implementationInitSuccess())
            .implementationMode(dto.implementationMode())
            .implementationProjectDir(dto.implementationProjectDir())
            .build();
    }
}
