package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.DiscoveryConfigEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data JPA Repository for DiscoveryConfigEntity.
 *
 * Provides CRUD operations and custom finder methods for discovery configuration.
 *
 * Spec: Phase 0 Persistence Contract (Increment 2)
 * - Task Group 2: JPA Entity, DTO, and Repository
 */
@Repository
public interface DiscoveryConfigRepository extends JpaRepository<DiscoveryConfigEntity, UUID> {

    /**
     * Find a discovery config by project ID (one-per-project).
     *
     * @param projectId the project UUID
     * @return the discovery config entity if found, empty Optional otherwise
     */
    Optional<DiscoveryConfigEntity> findByProjectId(UUID projectId);
}
