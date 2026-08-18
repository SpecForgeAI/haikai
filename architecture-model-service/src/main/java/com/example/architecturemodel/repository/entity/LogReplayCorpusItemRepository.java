package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.LogReplayCorpusItemEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/**
 * Repository for {@link LogReplayCorpusItemEntity} (Spec 5, 2026-08-18).
 */
@Repository
public interface LogReplayCorpusItemRepository
    extends JpaRepository<LogReplayCorpusItemEntity, UUID> {

    List<LogReplayCorpusItemEntity> findByCorpusIdOrderByMethodAscPathTemplateAscConcretePathAsc(
        UUID corpusId);

    long countByCorpusId(UUID corpusId);

    void deleteByCorpusId(UUID corpusId);
}
