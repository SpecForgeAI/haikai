package com.example.architecturemodel.repository;

import com.example.architecturemodel.model.entity.ProjectEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data JPA Repository for ProjectEntity.
 *
 * Provides CRUD operations and custom query methods for managing projects
 * with active project semantics.
 *
 * Spec 2026-01-05: Project Model with Active Project
 * Spec 2026-01-06: Project Snapshot JSON Import
 */
@Repository
public interface ProjectRepository extends JpaRepository<ProjectEntity, UUID> {

    /**
     * Find the currently active project.
     * Returns empty Optional if no project is active.
     *
     * @return Optional containing the active project, or empty if none active
     */
    Optional<ProjectEntity> findByIsActiveTrue();

    /**
     * Find a project by its name.
     *
     * @param name the project name
     * @return Optional containing the project if found, or empty if not found
     */
    Optional<ProjectEntity> findByName(String name);

    /**
     * Check if a project with the given name exists.
     *
     * @param name the project name
     * @return true if a project with the name exists, false otherwise
     */
    boolean existsByName(String name);

    /**
     * Deactivate all projects by setting is_active = false.
     * Used before activating a new project to ensure only one is active.
     *
     * Must be called within a transaction.
     */
    @Modifying
    @Query("UPDATE ProjectEntity p SET p.isActive = false")
    void deactivateAll();
}
