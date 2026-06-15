package com.example.architecturemodel.mapper;

import com.example.architecturemodel.model.dto.DeliveryTeamDto;
import com.example.architecturemodel.model.entity.DeliveryTeamEntity;
import org.springframework.stereotype.Component;

/**
 * Mapper for converting DeliveryTeamEntity to DeliveryTeamDto.
 *
 * Spec: RM Increment 3 -- DeliveryTeam Entity (DB Only, No UI)
 */
@Component
public class DeliveryTeamMapper {

    /**
     * Converts a DeliveryTeamEntity to DeliveryTeamDto.
     *
     * @param entity The delivery team entity
     * @return DeliveryTeamDto with all fields mapped, or null if entity is null
     */
    public DeliveryTeamDto toDto(DeliveryTeamEntity entity) {
        if (entity == null) {
            return null;
        }
        return new DeliveryTeamDto(
            entity.getId(),
            entity.getProjectId(),
            entity.getName(),
            entity.getType(),
            entity.getDescription(),
            entity.getCreatedAt(),
            entity.getUpdatedAt()
        );
    }
}
