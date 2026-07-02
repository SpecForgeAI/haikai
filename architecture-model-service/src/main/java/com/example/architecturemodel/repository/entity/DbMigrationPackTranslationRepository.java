package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.DbMigrationPackTranslationEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data JPA Repository for {@link DbMigrationPackTranslationEntity}.
 *
 * <p>{@link #findByPackIdAndTranslationKey(UUID, String)} backs the
 * upsert-by-translation_key re-link semantics (unique index
 * {@code uq_dmpt_pack_translation_key}, changeset 176): regeneration updates
 * the existing row for a re-manifested object instead of duplicating it,
 * preserving its draft / verdict / review lifecycle per the caller-supplied
 * sparse payload.</p>
 *
 * <p>{@link #deleteByPackIdAndTranslationKeyNotIn(UUID, Collection)} backs
 * the deterministic removal of rows whose object is no longer in the
 * manifest.</p>
 *
 * <p>Spec: LLM-Assisted DB Object Translation Drafts (2026-06-11) --
 * Task Group 2.</p>
 */
@Repository
public interface DbMigrationPackTranslationRepository
    extends JpaRepository<DbMigrationPackTranslationEntity, UUID> {

    /** All translation rows for a pack, oldest first (stable list order). */
    List<DbMigrationPackTranslationEntity> findByPackIdOrderByCreatedAtAsc(UUID packId);

    /** The upsert/re-link lookup by stable translation key. */
    Optional<DbMigrationPackTranslationEntity> findByPackIdAndTranslationKey(
        UUID packId, String translationKey);

    /** Deterministic removal of rows absent from the (regenerated) manifest. */
    void deleteByPackIdAndTranslationKeyNotIn(UUID packId, Collection<String> translationKeys);

    /** Removal of ALL rows for a pack (empty-manifest regeneration). */
    void deleteByPackId(UUID packId);

    /**
     * Count translation rows whose review status is in the given set (e.g.
     * {@code unreviewed} / {@code needs_rework} = not yet approved) -- backs
     * the migration-discovery-context pack readiness roll-up
     * (Spec 2026-07-02-a, Persistence-Tier Oracle Program).
     */
    long countByPackIdAndReviewStatusIn(UUID packId, Collection<String> reviewStatuses);
}
