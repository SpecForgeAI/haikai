package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.LogReplayCorpusEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Repository for {@link LogReplayCorpusEntity} (Spec 5, 2026-08-18).
 */
@Repository
public interface LogReplayCorpusRepository extends JpaRepository<LogReplayCorpusEntity, UUID> {

    List<LogReplayCorpusEntity> findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(
        UUID projectId, UUID architectureId);

    Optional<LogReplayCorpusEntity> findFirstByProjectIdAndArchitectureIdOrderByCreatedAtDesc(
        UUID projectId, UUID architectureId);
}
