package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.ArchitectureElementMappingEntity;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.context.ActiveProfiles;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Repository slice tests for {@link ArchitectureElementMappingRepository}.
 *
 * Covers the persistence-layer guarantees from Task Group 1.1:
 * <ol>
 *   <li>Round-trip save / find / delete.</li>
 *   <li>Unique constraint on the (project, arch pair, both element identities,
 *       mapping_type) tuple rejects a duplicate insert.</li>
 *   <li>{@code @PrePersist} sets {@code createdAt}, {@code @PreUpdate} bumps
 *       {@code updatedAt}.</li>
 *   <li>{@code confidence = null} round-trips correctly (boxed {@link Double}
 *       semantics — primitive {@code double} would silently default to 0).</li>
 * </ol>
 *
 * <p>Spec: Create Target Baseline from Current State (2026-05-15) -- Task Group 1</p>
 */
@DataJpaTest
@ActiveProfiles("test")
class ArchitectureElementMappingRepositoryTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private ArchitectureElementMappingRepository repository;

    private ArchitectureElementMappingEntity buildMapping(
            UUID projectId,
            UUID sourceArchitectureId,
            UUID targetArchitectureId,
            String sourceElementId,
            String targetElementId,
            String mappingType,
            Double confidence) {
        return ArchitectureElementMappingEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .sourceArchitectureId(sourceArchitectureId)
            .targetArchitectureId(targetArchitectureId)
            .sourceElementType("applications")
            .sourceElementId(sourceElementId)
            .targetElementType("applications")
            .targetElementId(targetElementId)
            .mappingType(mappingType)
            .status("confirmed")
            .createdByTask("selective-copy-with-auto-map")
            .confidence(confidence)
            .build();
    }

    @Test
    @DisplayName("save / findById / delete round-trip works")
    void roundTripSaveFindDelete() {
        UUID projectId = UUID.randomUUID();
        UUID sourceArch = UUID.randomUUID();
        UUID targetArch = UUID.randomUUID();
        ArchitectureElementMappingEntity mapping = buildMapping(
            projectId, sourceArch, targetArch,
            "src-app-1", "tgt-app-1",
            "equivalent", 1.0);

        ArchitectureElementMappingEntity saved = repository.save(mapping);
        entityManager.flush();
        entityManager.clear();

        Optional<ArchitectureElementMappingEntity> loaded = repository.findById(saved.getId());
        assertThat(loaded).isPresent();
        assertThat(loaded.get().getProjectId()).isEqualTo(projectId);
        assertThat(loaded.get().getSourceArchitectureId()).isEqualTo(sourceArch);
        assertThat(loaded.get().getTargetArchitectureId()).isEqualTo(targetArch);
        assertThat(loaded.get().getSourceElementId()).isEqualTo("src-app-1");
        assertThat(loaded.get().getTargetElementId()).isEqualTo("tgt-app-1");
        assertThat(loaded.get().getMappingType()).isEqualTo("equivalent");
        assertThat(loaded.get().getStatus()).isEqualTo("confirmed");
        assertThat(loaded.get().getCreatedByTask()).isEqualTo("selective-copy-with-auto-map");
        assertThat(loaded.get().getConfidence()).isEqualTo(1.0);

        repository.delete(loaded.get());
        entityManager.flush();
        entityManager.clear();

        assertThat(repository.findById(saved.getId())).isEmpty();
    }

    @Test
    @DisplayName("unique constraint rejects duplicate insert on the same (project, arch pair, elements, mapping_type) tuple")
    void uniqueConstraintRejectsDuplicate() {
        UUID projectId = UUID.randomUUID();
        UUID sourceArch = UUID.randomUUID();
        UUID targetArch = UUID.randomUUID();

        repository.saveAndFlush(buildMapping(
            projectId, sourceArch, targetArch,
            "src-1", "tgt-1",
            "equivalent", 1.0));

        ArchitectureElementMappingEntity duplicate = buildMapping(
            projectId, sourceArch, targetArch,
            "src-1", "tgt-1",
            "equivalent", 1.0);

        assertThatThrownBy(() -> repository.saveAndFlush(duplicate))
            .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("@PrePersist sets createdAt and @PreUpdate bumps updatedAt")
    void prePersistAndPreUpdateBumpTimestamps() throws InterruptedException {
        UUID projectId = UUID.randomUUID();
        UUID sourceArch = UUID.randomUUID();
        UUID targetArch = UUID.randomUUID();

        // Build with both timestamps null so we can prove @PrePersist sets them.
        ArchitectureElementMappingEntity mapping = ArchitectureElementMappingEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .sourceArchitectureId(sourceArch)
            .targetArchitectureId(targetArch)
            .sourceElementType("applications")
            .sourceElementId("src-touched")
            .targetElementType("applications")
            .targetElementId("tgt-touched")
            .mappingType("equivalent")
            .status("confirmed")
            .createdByTask("selective-copy-with-auto-map")
            .build();

        ArchitectureElementMappingEntity saved = repository.save(mapping);
        entityManager.flush();

        Instant createdAt = saved.getCreatedAt();
        Instant initialUpdatedAt = saved.getUpdatedAt();
        assertThat(createdAt).isNotNull();
        assertThat(initialUpdatedAt).isNotNull();

        entityManager.clear();

        // Re-load and update a mutable column to fire @PreUpdate.
        Thread.sleep(10);
        ArchitectureElementMappingEntity loaded = repository.findById(saved.getId()).orElseThrow();
        loaded.setNotes("manually edited");
        repository.saveAndFlush(loaded);
        entityManager.clear();

        ArchitectureElementMappingEntity reloaded = repository.findById(saved.getId()).orElseThrow();
        // H2 TIMESTAMP truncates sub-millisecond precision; Java's Instant
        // keeps nanos. Compare on millisecond precision to stay portable.
        assertThat(reloaded.getCreatedAt().toEpochMilli())
            .as("createdAt must be preserved (sub-ms precision tolerated)")
            .isEqualTo(createdAt.toEpochMilli());
        assertThat(reloaded.getUpdatedAt().toEpochMilli())
            .as("updatedAt must have advanced after the @PreUpdate bump")
            .isGreaterThan(initialUpdatedAt.toEpochMilli());
    }

    @Test
    @DisplayName("confidence = null round-trips correctly (boxed Double, not primitive)")
    void confidenceNullRoundTrips() {
        UUID projectId = UUID.randomUUID();
        UUID sourceArch = UUID.randomUUID();
        UUID targetArch = UUID.randomUUID();

        ArchitectureElementMappingEntity mapping = buildMapping(
            projectId, sourceArch, targetArch,
            "src-null-conf", "tgt-null-conf",
            "manual_review_required", null);

        ArchitectureElementMappingEntity saved = repository.saveAndFlush(mapping);
        entityManager.clear();

        ArchitectureElementMappingEntity reloaded = repository.findById(saved.getId()).orElseThrow();
        assertThat(reloaded.getConfidence())
            .as("Confidence must round-trip as null, not be silently coerced to 0.0")
            .isNull();
    }

    @Test
    @DisplayName("findByProjectIdAndSourceArchitectureIdAndTargetArchitectureId returns mappings for the arch pair")
    void findByArchPairReturnsMatchingMappings() {
        UUID projectId = UUID.randomUUID();
        UUID sourceArch = UUID.randomUUID();
        UUID targetArch = UUID.randomUUID();
        UUID otherTargetArch = UUID.randomUUID();

        repository.saveAndFlush(buildMapping(projectId, sourceArch, targetArch, "src-a", "tgt-a", "equivalent", 1.0));
        repository.saveAndFlush(buildMapping(projectId, sourceArch, targetArch, "src-b", "tgt-b", "renamed", null));
        // Same source arch but different target -- must be excluded.
        repository.saveAndFlush(buildMapping(projectId, sourceArch, otherTargetArch, "src-c", "tgt-c", "equivalent", 1.0));
        entityManager.clear();

        var result = repository
            .findByProjectIdAndSourceArchitectureIdAndTargetArchitectureId(projectId, sourceArch, targetArch);
        assertThat(result)
            .extracting(ArchitectureElementMappingEntity::getSourceElementId)
            .containsExactlyInAnyOrder("src-a", "src-b");
    }

    @Test
    @DisplayName("existsBy... returns true for an inserted (project, arch pair, elements, mapping_type) tuple")
    void existsByCompoundKeyDetectsDuplicates() {
        UUID projectId = UUID.randomUUID();
        UUID sourceArch = UUID.randomUUID();
        UUID targetArch = UUID.randomUUID();

        repository.saveAndFlush(buildMapping(projectId, sourceArch, targetArch,
            "src-x", "tgt-x", "equivalent", 1.0));
        entityManager.clear();

        boolean exists = repository
            .existsByProjectIdAndSourceArchitectureIdAndTargetArchitectureIdAndSourceElementTypeAndSourceElementIdAndTargetElementTypeAndTargetElementIdAndMappingType(
                projectId, sourceArch, targetArch,
                "applications", "src-x",
                "applications", "tgt-x",
                "equivalent");
        assertThat(exists).isTrue();

        boolean missing = repository
            .existsByProjectIdAndSourceArchitectureIdAndTargetArchitectureIdAndSourceElementTypeAndSourceElementIdAndTargetElementTypeAndTargetElementIdAndMappingType(
                projectId, sourceArch, targetArch,
                "applications", "src-x",
                "applications", "tgt-x",
                "renamed");
        assertThat(missing).isFalse();
    }
}
