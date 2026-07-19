package com.example.architecturemodel.repository.security;

import com.example.architecturemodel.model.entity.security.CweEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Repository for {@code cwes} world-fact records (Security health dashboard,
 * 2026-07-19, Spec 1 of 3). Seeded from the MITRE view-1000 catalog
 * (changeset 212); globally scoped.
 */
public interface CweRepository extends JpaRepository<CweEntity, UUID> {

    Optional<CweEntity> findByCweId(String cweId);

    List<CweEntity> findByCweIdIn(Collection<String> cweIds);
}
