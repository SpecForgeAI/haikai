package com.example.architecturemodel.repository.security;

import com.example.architecturemodel.model.entity.security.SecurityLinkingAliasEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Repository for {@code security_linking_aliases} (Security health dashboard,
 * 2026-07-19, Spec 1 of 3) -- the wizard's project-scoped value-match memory.
 */
public interface SecurityLinkingAliasRepository
        extends JpaRepository<SecurityLinkingAliasEntity, UUID> {

    List<SecurityLinkingAliasEntity> findByProjectIdAndLevel(UUID projectId, String level);

    Optional<SecurityLinkingAliasEntity> findByProjectIdAndLevelAndAliasValue(
        UUID projectId, String level, String aliasValue);

    /** Batch auto-resolution for the wizard's distinct linking values. */
    List<SecurityLinkingAliasEntity> findByProjectIdAndLevelAndAliasValueIn(
        UUID projectId, String level, Collection<String> aliasValues);
}
