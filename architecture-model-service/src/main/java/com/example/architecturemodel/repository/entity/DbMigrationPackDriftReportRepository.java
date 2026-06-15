package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.DbMigrationPackDriftReportEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/**
 * Spring Data JPA Repository for {@link DbMigrationPackDriftReportEntity}.
 *
 * <p>APPEND-ONLY surface: the service only ever inserts and lists -- drift
 * rows are never updated or deleted (audit trail, settled Q6). Listing is
 * newest-first for the run-history UI, backed by index
 * {@code idx_dmpdr_pack_created} (changeset 175).</p>
 *
 * <p>Spec: Source-Grade DB Schema + Data Migration Pack (2026-06-11) --
 * Task Group 1.</p>
 */
@Repository
public interface DbMigrationPackDriftReportRepository
    extends JpaRepository<DbMigrationPackDriftReportEntity, UUID> {

    /** Run history for a pack, newest first. */
    List<DbMigrationPackDriftReportEntity> findByPackIdOrderByCreatedAtDesc(UUID packId);
}
