package com.example.architecturemodel.mapper;

import com.example.architecturemodel.model.dto.ProductDefinitionDto;
import com.example.architecturemodel.model.entity.ProductDefinitionEntity;
import org.springframework.stereotype.Component;

/**
 * Mapper for converting ProductDefinitionEntity to ProductDefinitionDto.
 *
 * Spec: Increment 1 -- Add Product Tab + Minimal ProductDefinition (UI + DB only)
 */
@Component
public class ProductDefinitionMapper {

    /**
     * Converts a ProductDefinitionEntity to ProductDefinitionDto.
     *
     * @param entity The product definition entity
     * @return ProductDefinitionDto with all fields mapped
     */
    public ProductDefinitionDto toDto(ProductDefinitionEntity entity) {
        if (entity == null) {
            return null;
        }
        return new ProductDefinitionDto(
            entity.getId(),
            entity.getProjectId(),
            entity.getProductName(),
            entity.getCreatedAt(),
            entity.getUpdatedAt()
        );
    }
}
