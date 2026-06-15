package com.example.architecturemodel.mapper;

import com.example.architecturemodel.model.dto.OrganisationDto;
import com.example.architecturemodel.model.dto.OrganisationListItemDto;
import com.example.architecturemodel.model.entity.OrganisationEntity;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * Mapper for converting between OrganisationEntity and Organisation DTOs.
 *
 * Spec 2026-01-18: Organisations Iteration 1 - Add Organisation Model + Project FK + APIs
 * Spec 2026-01-31: Organisation Model + DB + API DTOs - Added mapping for standards fields
 */
@Component
public class OrganisationMapper {

    /**
     * Converts an OrganisationEntity to OrganisationDto (full details).
     * Null lists in entity are converted to empty lists in DTO.
     *
     * @param entity The organisation entity
     * @return OrganisationDto with all fields
     */
    public OrganisationDto toDto(OrganisationEntity entity) {
        if (entity == null) {
            return null;
        }
        return new OrganisationDto(
            entity.getId(),
            entity.getName(),
            entity.getDescription(),
            nullSafeList(entity.getDocsAppliedToAllSources()),
            nullSafeList(entity.getDocsAppliedToTechStack()),
            nullSafeList(entity.getDocsAppliedToCodingStyles()),
            nullSafeList(entity.getDocsAppliedToConventions()),
            nullSafeList(entity.getDocsAppliedToErrorHandling()),
            nullSafeList(entity.getDocsAppliedToValidation()),
            entity.getTechStandardsGenerated() != null ? entity.getTechStandardsGenerated() : false
        );
    }

    /**
     * Converts an OrganisationEntity to OrganisationListItemDto (id and name only).
     * No changes needed for new fields as list item only includes id and name.
     *
     * @param entity The organisation entity
     * @return OrganisationListItemDto with id and name
     */
    public OrganisationListItemDto toListItemDto(OrganisationEntity entity) {
        if (entity == null) {
            return null;
        }
        return new OrganisationListItemDto(
            entity.getId(),
            entity.getName()
        );
    }

    /**
     * Converts an OrganisationDto to OrganisationEntity.
     * Maps all seven new fields from DTO to entity.
     *
     * @param dto The organisation DTO
     * @return OrganisationEntity with all fields
     */
    public OrganisationEntity toEntity(OrganisationDto dto) {
        if (dto == null) {
            return null;
        }
        return OrganisationEntity.builder()
            .id(dto.id())
            .name(dto.name())
            .description(dto.description())
            .docsAppliedToAllSources(nullSafeList(dto.docsAppliedToAllSources()))
            .docsAppliedToTechStack(nullSafeList(dto.docsAppliedToTechStack()))
            .docsAppliedToCodingStyles(nullSafeList(dto.docsAppliedToCodingStyles()))
            .docsAppliedToConventions(nullSafeList(dto.docsAppliedToConventions()))
            .docsAppliedToErrorHandling(nullSafeList(dto.docsAppliedToErrorHandling()))
            .docsAppliedToValidation(nullSafeList(dto.docsAppliedToValidation()))
            .techStandardsGenerated(dto.techStandardsGenerated() != null ? dto.techStandardsGenerated() : false)
            .build();
    }

    /**
     * Returns empty ArrayList if list is null, otherwise returns the list.
     * Ensures DTO never contains null list values.
     */
    private List<String> nullSafeList(List<String> list) {
        return list != null ? list : new ArrayList<>();
    }
}
