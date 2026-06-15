package com.example.architecturemodel.mapper;

import com.example.architecturemodel.model.dto.ProductDefinitionDto;
import com.example.architecturemodel.model.entity.ProductDefinitionEntity;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for ProductDefinitionMapper.
 *
 * Tests mapping between ProductDefinitionEntity and ProductDefinitionDto.
 *
 * Spec: Increment 1 -- Add Product Tab + Minimal ProductDefinition (UI + DB only)
 * Task Group 1: Database Migration, Entity, Repository, Service, Controller, DTO, Mapper
 */
class ProductDefinitionMapperTest {

    private ProductDefinitionMapper mapper;

    @BeforeEach
    void setUp() {
        mapper = new ProductDefinitionMapper();
    }

    /**
     * Test 5: toDto() correctly maps all entity fields to DTO record fields.
     */
    @Test
    @DisplayName("toDto() correctly maps all entity fields to DTO record fields")
    void testToDtoMapsAllEntityFieldsToDtoFields() {
        UUID id = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        Instant createdAt = Instant.parse("2026-02-12T10:00:00Z");
        Instant updatedAt = Instant.parse("2026-02-12T12:00:00Z");

        ProductDefinitionEntity entity = ProductDefinitionEntity.builder()
            .id(id)
            .projectId(projectId)
            .productName("Test Product")
            .createdAt(createdAt)
            .updatedAt(updatedAt)
            .build();

        ProductDefinitionDto dto = mapper.toDto(entity);

        assertThat(dto).isNotNull();
        assertThat(dto.id()).isEqualTo(id);
        assertThat(dto.projectId()).isEqualTo(projectId);
        assertThat(dto.productName()).isEqualTo("Test Product");
        assertThat(dto.createdAt()).isEqualTo(createdAt);
        assertThat(dto.updatedAt()).isEqualTo(updatedAt);
    }

    /**
     * Additional: toDto() returns null when entity is null.
     */
    @Test
    @DisplayName("toDto() returns null when entity is null")
    void testToDtoReturnsNullWhenEntityIsNull() {
        ProductDefinitionDto dto = mapper.toDto(null);
        assertThat(dto).isNull();
    }
}
