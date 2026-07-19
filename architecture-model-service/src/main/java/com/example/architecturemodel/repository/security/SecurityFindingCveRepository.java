package com.example.architecturemodel.repository.security;

import com.example.architecturemodel.model.entity.security.SecurityFindingCveEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

/**
 * Repository for the {@code security_finding_cves} M:N join (Security health
 * dashboard, 2026-07-19, Spec 1 of 3).
 */
public interface SecurityFindingCveRepository
        extends JpaRepository<SecurityFindingCveEntity, UUID> {

    /** Batch-load the CVE links for one register page's findings. */
    List<SecurityFindingCveEntity> findByFindingIdIn(Collection<UUID> findingIds);
}
