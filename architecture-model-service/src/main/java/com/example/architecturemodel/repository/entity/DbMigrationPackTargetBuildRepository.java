package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.DbMigrationPackTargetBuildEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data JPA Repository for {@link DbMigrationPackTargetBuildEntity} --
 * the target-database builds a pack's workbench loop applies drafts against
 * (changeset 231, Stored Proc &amp; Function Behaviour Program, Spec 4).
 *
 * <p>Newest-first is the natural order everywhere: the Translations tab header
 * shows the LATEST build's status, and {@code PROC.BUILD.01} asserts its three
 * phases all succeeded.</p>
 */
@Repository
public interface DbMigrationPackTargetBuildRepository
    extends JpaRepository<DbMigrationPackTargetBuildEntity, UUID> {

    /** A pack's builds, newest first. */
    List<DbMigrationPackTargetBuildEntity> findByPackIdOrderByStartedAtDesc(UUID packId);

    /** The latest build for a pack (the header read; empty = never built). */
    Optional<DbMigrationPackTargetBuildEntity> findFirstByPackIdOrderByStartedAtDesc(UUID packId);
}
