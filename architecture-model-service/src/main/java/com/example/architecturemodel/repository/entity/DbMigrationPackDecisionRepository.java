package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.DbMigrationPackDecisionEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data JPA Repository for {@link DbMigrationPackDecisionEntity}.
 *
 * <p>{@link #findByPackIdAndDecisionKey(UUID, String)} backs the
 * upsert-by-decision_key re-link semantics (unique index
 * {@code uq_dmpd_pack_decision_key}, changeset 174): regeneration updates the
 * existing row for a re-flagged object instead of duplicating it, preserving
 * its resolution.</p>
 *
 * <p>Spec: Source-Grade DB Schema + Data Migration Pack (2026-06-11) --
 * Task Group 1.</p>
 */
@Repository
public interface DbMigrationPackDecisionRepository
    extends JpaRepository<DbMigrationPackDecisionEntity, UUID> {

    /** All decisions for a pack, oldest first (stable queue order). */
    List<DbMigrationPackDecisionEntity> findByPackIdOrderByCreatedAtAsc(UUID packId);

    /** The upsert/re-link lookup by stable decision key. */
    Optional<DbMigrationPackDecisionEntity> findByPackIdAndDecisionKey(
        UUID packId, String decisionKey);

    /**
     * Count decisions in a given status ({@code open} / {@code resolved}) --
     * backs the migration-discovery-context pack readiness roll-up
     * (Spec 2026-07-02-a, Persistence-Tier Oracle Program).
     */
    long countByPackIdAndStatus(UUID packId, String status);
}
