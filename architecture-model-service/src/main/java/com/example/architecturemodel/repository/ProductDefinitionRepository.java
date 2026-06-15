package com.example.architecturemodel.repository;

import com.example.architecturemodel.model.entity.ProductDefinitionEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data JPA Repository for ProductDefinitionEntity.
 *
 * Provides CRUD operations and custom query methods for managing
 * product definitions. Each project has at most one product definition
 * (1:1 relationship enforced by UNIQUE constraint on project_id).
 *
 * Spec: Increment 1 -- Add Product Tab + Minimal ProductDefinition (UI + DB only)
 */
@Repository
public interface ProductDefinitionRepository extends JpaRepository<ProductDefinitionEntity, UUID> {

    /**
     * Find a product definition by its project ID.
     *
     * @param projectId the project UUID
     * @return Optional containing the product definition if found, or empty if not found
     */
    Optional<ProductDefinitionEntity> findByProjectId(UUID projectId);
}
