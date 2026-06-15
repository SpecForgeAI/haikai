package com.example.architecturemodel.service;

import com.example.architecturemodel.mapper.ProductDefinitionMapper;
import com.example.architecturemodel.model.dto.ProductDefinitionDto;
import com.example.architecturemodel.model.entity.ProductDefinitionEntity;
import com.example.architecturemodel.repository.ProductDefinitionRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/**
 * Service for managing ProductDefinitions.
 *
 * Provides operations for retrieving and upserting product definitions.
 * Each project has at most one product definition (1:1 relationship).
 *
 * Spec: Increment 1 -- Add Product Tab + Minimal ProductDefinition (UI + DB only)
 */
@Service
@Slf4j
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
public class ProductDefinitionService {

    private final ProductDefinitionRepository productDefinitionRepository;
    private final ProductDefinitionMapper productDefinitionMapper;

    public ProductDefinitionService(ProductDefinitionRepository productDefinitionRepository,
                                     ProductDefinitionMapper productDefinitionMapper) {
        this.productDefinitionRepository = productDefinitionRepository;
        this.productDefinitionMapper = productDefinitionMapper;
    }

    /**
     * Gets the product definition for a project.
     *
     * @param projectId The project UUID
     * @return Optional containing ProductDefinitionDto if found, or empty if not found
     */
    @Transactional(readOnly = true)
    public Optional<ProductDefinitionDto> getByProjectId(UUID projectId) {
        log.debug("Getting product definition for project: {}", projectId);
        return productDefinitionRepository.findByProjectId(projectId)
            .map(productDefinitionMapper::toDto);
    }

    /**
     * Creates or updates a product definition for a project.
     *
     * If a product definition already exists for the project, updates the productName
     * and updatedAt fields. If none exists, creates a new entity.
     *
     * @param projectId The project UUID
     * @param productName The product name (must be non-blank)
     * @return The saved ProductDefinitionDto
     * @throws IllegalArgumentException if productName is blank or null
     */
    @Transactional
    public ProductDefinitionDto upsert(UUID projectId, String productName) {
        log.info("Upserting product definition for project: {}, productName: '{}'", projectId, productName);

        // Validate productName is non-blank
        if (productName == null || productName.isBlank()) {
            throw new IllegalArgumentException("Product name is required");
        }

        String trimmedName = productName.trim();
        Instant now = Instant.now();

        Optional<ProductDefinitionEntity> existing = productDefinitionRepository.findByProjectId(projectId);

        ProductDefinitionEntity entity;
        if (existing.isPresent()) {
            // Update existing
            entity = existing.get();
            entity.setProductName(trimmedName);
            entity.setUpdatedAt(now);
            log.debug("Updating existing product definition: {}", entity.getId());
        } else {
            // Create new
            entity = ProductDefinitionEntity.builder()
                .id(UUID.randomUUID())
                .projectId(projectId)
                .productName(trimmedName)
                .createdAt(now)
                .updatedAt(now)
                .build();
            log.debug("Creating new product definition for project: {}", projectId);
        }

        ProductDefinitionEntity saved = productDefinitionRepository.save(entity);
        log.info("Saved product definition with id: {}", saved.getId());

        return productDefinitionMapper.toDto(saved);
    }
}
