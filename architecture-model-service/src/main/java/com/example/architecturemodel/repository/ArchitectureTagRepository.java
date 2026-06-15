package com.example.architecturemodel.repository;

import com.example.architecturemodel.model.entity.ArchitectureTagEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/**
 * Spring Data JPA Repository for ArchitectureTagEntity.
 *
 * Provides CRUD on the (architecture_id, tag_value) join table. Tag-management
 * UI lands in spec #3 -- this repository exists in spec #1 only to support
 * loading tags alongside an architecture for the list endpoint DTO.
 *
 * Spec: Multi-Architecture Plumbing (Spec #1)
 */
@Repository
public interface ArchitectureTagRepository
    extends JpaRepository<ArchitectureTagEntity, ArchitectureTagEntity.ArchitectureTagId> {

    /**
     * Find all tags for an architecture.
     *
     * @param architectureId the architecture UUID
     * @return list of tags (any order); empty list if none.
     */
    List<ArchitectureTagEntity> findByArchitectureId(UUID architectureId);
}
