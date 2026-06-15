package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.DbMigrationPackFileEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/**
 * Spring Data JPA Repository for {@link DbMigrationPackFileEntity}.
 *
 * <p>Files are replaced WHOLESALE on regeneration:
 * {@link #deleteByPackId(UUID)} followed by fresh inserts inside the same
 * service transaction. Listing is ordered by {@code sort_order} (the
 * deterministic FK-topological pack order), backed by index
 * {@code idx_dmpf_pack_sort} (changeset 173).</p>
 *
 * <p>Spec: Source-Grade DB Schema + Data Migration Pack (2026-06-11) --
 * Task Group 1.</p>
 */
@Repository
public interface DbMigrationPackFileRepository
    extends JpaRepository<DbMigrationPackFileEntity, UUID> {

    /** All files for a pack in deterministic pack order. */
    List<DbMigrationPackFileEntity> findByPackIdOrderBySortOrderAsc(UUID packId);

    /** Wholesale removal of a pack's file set (regeneration replace step). */
    void deleteByPackId(UUID packId);
}
