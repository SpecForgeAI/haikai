package com.example.architecturemodel.repository;

import com.example.architecturemodel.model.entity.OrganisationEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

/**
 * Spring Data JPA Repository for OrganisationEntity.
 *
 * Provides CRUD operations and custom query methods for managing organisations.
 *
 * Spec 2026-01-18: Organisations Iteration 1 - Add Organisation Model + Project FK + APIs
 * Spec 2026-01-18: Organisation ID Type Change (UUID to TEXT) - Changed ID type from UUID to String
 * Spec 2026-01-31: Organisation Model + DB + API DTOs - Added case-insensitive lookup methods
 */
@Repository
public interface OrganisationRepository extends JpaRepository<OrganisationEntity, String> {

    /**
     * Find an organisation by its exact name.
     *
     * @param name the organisation name
     * @return Optional containing the organisation if found, or empty if not found
     */
    Optional<OrganisationEntity> findByName(String name);

    /**
     * Check if an organisation with the given name exists.
     *
     * @param name the organisation name
     * @return true if an organisation with the name exists, false otherwise
     */
    boolean existsByName(String name);

    /**
     * Find all organisations ordered by name ascending.
     * Used for autocomplete lists.
     *
     * @return List of organisations ordered by name ascending
     */
    List<OrganisationEntity> findAllByOrderByNameAsc();

    /**
     * Check if an organisation with the given name exists (case-insensitive).
     * Used for duplicate checking during creation.
     *
     * @param name the organisation name to check
     * @return true if an organisation with a case-insensitive matching name exists
     */
    boolean existsByNameIgnoreCase(String name);

    /**
     * Find an organisation by its name (case-insensitive).
     *
     * @param name the organisation name
     * @return Optional containing the organisation if found, or empty if not found
     */
    Optional<OrganisationEntity> findByNameIgnoreCase(String name);
}
