package com.example.architecturemodel.repository.security;

import com.example.architecturemodel.model.entity.security.CveEntity;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Repository for {@code cves} world-fact records (Security health dashboard,
 * 2026-07-19, Spec 1 of 3). Globally scoped -- world facts are not
 * project-bound.
 */
public interface CveRepository extends JpaRepository<CveEntity, UUID> {

    Optional<CveEntity> findByCveId(String cveId);

    List<CveEntity> findByCveIdIn(Collection<String> cveIds);

    /** Enrichment work queue: pending stubs, oldest first (gateway OSV bridge). */
    List<CveEntity> findByEnrichmentStatusOrderByCreatedAtAsc(
        String enrichmentStatus, Pageable pageable);
}
