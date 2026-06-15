package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.DbMigrationPackEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data JPA Repository for {@link DbMigrationPackEntity}.
 *
 * <p>Mirrors {@link GeneratedMigrationBookOfWorkRepository}: standard CRUD via
 * {@link JpaRepository} plus the focused finders the service needs. The
 * one-active-pack-per-(project, architecture) invariant is backed by the DB
 * unique index {@code uq_dmp_project_architecture} (changeset 172), so
 * {@link #findByProjectIdAndArchitectureId(UUID, UUID)} returns at most one
 * row by construction.</p>
 *
 * <p>Spec: Source-Grade DB Schema + Data Migration Pack (2026-06-11) --
 * Task Group 1.</p>
 */
@Repository
public interface DbMigrationPackRepository extends JpaRepository<DbMigrationPackEntity, UUID> {

    /**
     * The upsert lookup: the single active pack for a
     * {@code (projectId, architectureId)} pair, if one exists.
     */
    Optional<DbMigrationPackEntity> findByProjectIdAndArchitectureId(
        UUID projectId, UUID architectureId);

    /** All packs for a project (one per architecture), newest first. */
    List<DbMigrationPackEntity> findByProjectIdOrderByCreatedAtDesc(UUID projectId);
}
