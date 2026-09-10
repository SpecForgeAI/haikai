package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.DbMigrationPackTranslationAttemptEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data JPA Repository for
 * {@link DbMigrationPackTranslationAttemptEntity} -- the append-only workbench
 * attempt history (changeset 231, Stored Proc &amp; Function Behaviour Program,
 * Spec 4).
 *
 * <p>{@link #findByTranslationIdOrderByAttemptNoAsc(UUID)} is the reviewer's
 * read (attempt 1 first, so the diff-vs-previous rendering is a straight
 * walk); {@link #findByPackId(UUID)} backs the whole-pack history the
 * Translations tab loads in one request.</p>
 */
@Repository
public interface DbMigrationPackTranslationAttemptRepository
    extends JpaRepository<DbMigrationPackTranslationAttemptEntity, UUID> {

    /** One translation's attempts, oldest attempt first. */
    List<DbMigrationPackTranslationAttemptEntity> findByTranslationIdOrderByAttemptNoAsc(
        UUID translationId);

    /** Every attempt for a pack (the tab's one-shot history load). */
    List<DbMigrationPackTranslationAttemptEntity> findByPackId(UUID packId);

    /**
     * The duplicate guard behind {@code uq_dmpta_translation_attempt}: a
     * re-post of an existing attempt number is a 409, never a silent
     * overwrite of the evidence.
     */
    Optional<DbMigrationPackTranslationAttemptEntity> findByTranslationIdAndAttemptNo(
        UUID translationId, Integer attemptNo);
}
