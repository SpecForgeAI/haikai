package com.example.architecturemodel.repository.security;

import com.example.architecturemodel.model.entity.security.SecurityFindingCweEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

/**
 * Repository for the {@code security_finding_cwes} M:N join (Security health
 * dashboard, 2026-07-19, Spec 1 of 3).
 */
public interface SecurityFindingCweRepository
        extends JpaRepository<SecurityFindingCweEntity, UUID> {

    /** Batch-load the CWE links for one register page's findings. */
    List<SecurityFindingCweEntity> findByFindingIdIn(Collection<UUID> findingIds);
}
