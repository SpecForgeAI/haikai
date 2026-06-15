package com.example.architecturemodel.repository;

import com.example.architecturemodel.model.entity.DeliveryTeamEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data JPA Repository for DeliveryTeamEntity.
 *
 * Provides CRUD operations and custom query methods for managing
 * delivery teams scoped to projects.
 *
 * Spec: RM Increment 3 -- DeliveryTeam Entity (DB Only, No UI)
 */
@Repository
public interface DeliveryTeamRepository extends JpaRepository<DeliveryTeamEntity, UUID> {

    /**
     * Find all delivery teams for a project, ordered by name ascending.
     *
     * @param projectId the project UUID
     * @return List of delivery teams ordered alphabetically by name
     */
    List<DeliveryTeamEntity> findByProjectIdOrderByNameAsc(UUID projectId);

    /**
     * Find a delivery team by project ID and name (case-insensitive).
     * Used for duplicate checking during create and update operations.
     *
     * @param projectId the project UUID
     * @param name the team name to search for
     * @return Optional containing the delivery team if found, or empty if not found
     */
    Optional<DeliveryTeamEntity> findByProjectIdAndNameIgnoreCase(UUID projectId, String name);

    /**
     * Check if a delivery team with the given name exists in a project (case-insensitive).
     * Used for duplicate checking during creation.
     *
     * @param projectId the project UUID
     * @param name the team name to check
     * @return true if a delivery team with a case-insensitive matching name exists in the project
     */
    boolean existsByProjectIdAndNameIgnoreCase(UUID projectId, String name);
}
