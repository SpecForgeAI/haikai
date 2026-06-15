package com.example.architecturemodel.repository;

import com.example.architecturemodel.model.entity.ProjectImplementationRepoEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

/**
 * Repository for the implementation-service workspace repo map
 * ({@code project_implementation_repos}).
 *
 * Spec 2026-06-12: Implementation-Service Init and Integration Repair -- Task Group 1
 */
public interface ProjectImplementationRepoRepository
        extends JpaRepository<ProjectImplementationRepoEntity, UUID> {

    /** All repo rows for a project, deterministically ordered by folder. */
    List<ProjectImplementationRepoEntity> findByProjectIdOrderByFolderAsc(UUID projectId);

    /**
     * Bulk-deletes all repo rows for a project. Declared as a modifying JPQL
     * query (NOT a derived delete) so the DELETE executes immediately at call
     * time -- the full-map replace operation deletes then re-inserts rows that
     * may reuse the same (project_id, folder) unique key within one
     * transaction, and a deferred derived delete could be flushed AFTER the
     * new inserts, tripping the unique constraint.
     */
    @Modifying
    @Query("delete from ProjectImplementationRepoEntity r where r.projectId = :projectId")
    void deleteByProjectId(@Param("projectId") UUID projectId);
}
