package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.DbStructuralFindingDispositionEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data JPA Repository for {@link DbStructuralFindingDispositionEntity}.
 *
 * <p>{@link #findByProjectIdAndFindingKey(UUID, String)} backs the
 * upsert-by-finding_key re-link semantics (unique index
 * {@code uq_dsfd_project_finding_key}, changeset 215): a finding re-emitted by
 * a regenerated pack updates the existing project-scoped disposition row
 * instead of duplicating it.</p>
 *
 * <p>Spec: Structural findings dispositions (2026-08-04) -- Spec 2.</p>
 */
@Repository
public interface DbStructuralFindingDispositionRepository
    extends JpaRepository<DbStructuralFindingDispositionEntity, UUID> {

    /** All disposition rows for a project, oldest first (stable list order). */
    List<DbStructuralFindingDispositionEntity> findByProjectIdOrderByCreatedAtAsc(UUID projectId);

    /** The upsert/re-link lookup by stable finding key. */
    Optional<DbStructuralFindingDispositionEntity> findByProjectIdAndFindingKey(
        UUID projectId, String findingKey);
}
