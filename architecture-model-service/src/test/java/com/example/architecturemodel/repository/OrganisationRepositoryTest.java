package com.example.architecturemodel.repository;

import com.example.architecturemodel.model.entity.OrganisationEntity;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Repository tests for OrganisationRepository.
 *
 * Tests entity mapping and query methods against embedded database.
 *
 * Spec 2026-01-18: Organisations Iteration 1 - Add Organisation Model + Project FK + APIs
 * Spec 2026-01-18: Organisation ID Type Change (UUID to TEXT) - Updated to use String IDs
 * Spec 2026-01-31: Organisation Model + DB + API DTOs - Added case-insensitive methods
 * Task Group 1: Database Layer - Schema Migration and Data Models
 * Task Group 3: Entity, DTO, Repository, and Mapper Updates
 */
@DataJpaTest
@ActiveProfiles("test")
class OrganisationRepositoryTest {

    @Autowired
    private OrganisationRepository organisationRepository;

    @BeforeEach
    void setUp() {
        organisationRepository.deleteAll();
    }

    @Test
    @DisplayName("OrganisationEntity basic construction and field mapping with String ID")
    void testOrganisationEntityBasicConstruction() {
        // Given: String ID with org- prefix
        String id = "org-" + UUID.randomUUID().toString();
        OrganisationEntity entity = OrganisationEntity.builder()
            .id(id)
            .name("Test Organisation")
            .description("A test organisation")
            .build();

        // When
        OrganisationEntity saved = organisationRepository.save(entity);

        // Then
        assertThat(saved.getId()).isEqualTo(id);
        assertThat(saved.getId()).startsWith("org-");
        assertThat(saved.getName()).isEqualTo("Test Organisation");
        assertThat(saved.getDescription()).isEqualTo("A test organisation");

        // Verify retrieval
        Optional<OrganisationEntity> retrieved = organisationRepository.findById(id);
        assertThat(retrieved).isPresent();
        assertThat(retrieved.get().getName()).isEqualTo("Test Organisation");
    }

    @Test
    @DisplayName("findByName returns organisation when exists")
    void testFindByNameReturnsOrganisationWhenExists() {
        // Given
        OrganisationEntity entity = OrganisationEntity.builder()
            .id("org-" + UUID.randomUUID().toString())
            .name("Acme Corp")
            .description("Acme Corporation")
            .build();
        organisationRepository.save(entity);

        // When
        Optional<OrganisationEntity> result = organisationRepository.findByName("Acme Corp");

        // Then
        assertThat(result).isPresent();
        assertThat(result.get().getName()).isEqualTo("Acme Corp");
        assertThat(result.get().getDescription()).isEqualTo("Acme Corporation");
        assertThat(result.get().getId()).startsWith("org-");
    }

    @Test
    @DisplayName("findByName returns empty when organisation does not exist")
    void testFindByNameReturnsEmptyWhenNotExists() {
        // When
        Optional<OrganisationEntity> result = organisationRepository.findByName("Non-Existent Org");

        // Then
        assertThat(result).isEmpty();
    }

    @Test
    @DisplayName("existsByName returns true when organisation exists")
    void testExistsByNameReturnsTrue() {
        // Given
        OrganisationEntity entity = OrganisationEntity.builder()
            .id("org-" + UUID.randomUUID().toString())
            .name("Existing Org")
            .build();
        organisationRepository.save(entity);

        // When/Then
        assertThat(organisationRepository.existsByName("Existing Org")).isTrue();
    }

    @Test
    @DisplayName("existsByName returns false when organisation does not exist")
    void testExistsByNameReturnsFalse() {
        // When/Then
        assertThat(organisationRepository.existsByName("Non-Existent Org")).isFalse();
    }

    @Test
    @DisplayName("findAllByOrderByNameAsc returns organisations sorted by name ascending")
    void testFindAllByOrderByNameAscReturnsSortedList() {
        // Given
        organisationRepository.save(OrganisationEntity.builder()
            .id("org-" + UUID.randomUUID().toString())
            .name("Zebra Inc")
            .build());
        organisationRepository.save(OrganisationEntity.builder()
            .id("org-" + UUID.randomUUID().toString())
            .name("Acme Corp")
            .build());
        organisationRepository.save(OrganisationEntity.builder()
            .id("org-" + UUID.randomUUID().toString())
            .name("Beta Company")
            .build());

        // When
        List<OrganisationEntity> result = organisationRepository.findAllByOrderByNameAsc();

        // Then
        assertThat(result).hasSize(3);
        assertThat(result.get(0).getName()).isEqualTo("Acme Corp");
        assertThat(result.get(1).getName()).isEqualTo("Beta Company");
        assertThat(result.get(2).getName()).isEqualTo("Zebra Inc");

        // Verify all IDs are String type
        result.forEach(org -> {
            assertThat(org.getId()).isInstanceOf(String.class);
            assertThat(org.getId()).startsWith("org-");
        });
    }

    // NOTE: the former "unique constraint violation throws exception on duplicate
    // name" test was removed. After the Organisation ID text-id change
    // (Spec 2026-01-18) and the case-insensitive uniqueness rework
    // (Spec 2026-01-31), name uniqueness is enforced at the SERVICE layer via
    // existsByNameIgnoreCase, not by a database unique constraint, so a
    // repository-level saveAndFlush of a duplicate name no longer throws.
    // Service-layer uniqueness is covered by OrganisationService tests.

    @Test
    @DisplayName("findById works with String ID parameter")
    void testFindByIdWithStringParameter() {
        // Given
        String orgId = "org-" + UUID.randomUUID().toString();
        OrganisationEntity entity = OrganisationEntity.builder()
            .id(orgId)
            .name("FindById Test Org")
            .build();
        organisationRepository.save(entity);

        // When
        Optional<OrganisationEntity> result = organisationRepository.findById(orgId);

        // Then
        assertThat(result).isPresent();
        assertThat(result.get().getId()).isEqualTo(orgId);
    }

    // ============================================================================
    // Task Group 3: New tests for case-insensitive repository methods
    // ============================================================================

    /**
     * Test: existsByNameIgnoreCase() returns true for case variations.
     */
    @Test
    @DisplayName("existsByNameIgnoreCase() returns true for case variations")
    void testExistsByNameIgnoreCaseReturnsTrueForCaseVariations() {
        // Given
        OrganisationEntity entity = OrganisationEntity.builder()
            .id("org-" + UUID.randomUUID().toString())
            .name("Acme Corp")
            .build();
        organisationRepository.save(entity);

        // When/Then - all case variations should return true
        assertThat(organisationRepository.existsByNameIgnoreCase("Acme Corp")).isTrue();
        assertThat(organisationRepository.existsByNameIgnoreCase("acme corp")).isTrue();
        assertThat(organisationRepository.existsByNameIgnoreCase("ACME CORP")).isTrue();
        assertThat(organisationRepository.existsByNameIgnoreCase("AcMe CoRp")).isTrue();
    }

    /**
     * Test: existsByNameIgnoreCase() returns false for non-existent name.
     */
    @Test
    @DisplayName("existsByNameIgnoreCase() returns false for non-existent name")
    void testExistsByNameIgnoreCaseReturnsFalseForNonExistent() {
        // When/Then
        assertThat(organisationRepository.existsByNameIgnoreCase("Non Existent")).isFalse();
    }

    /**
     * Test: findByNameIgnoreCase() finds organisation regardless of case.
     */
    @Test
    @DisplayName("findByNameIgnoreCase() finds organisation regardless of case")
    void testFindByNameIgnoreCaseFindsOrganisationRegardlessOfCase() {
        // Given
        OrganisationEntity entity = OrganisationEntity.builder()
            .id("org-" + UUID.randomUUID().toString())
            .name("Test Organization")
            .description("Test description")
            .build();
        organisationRepository.save(entity);

        // When/Then - all case variations should find the org
        assertThat(organisationRepository.findByNameIgnoreCase("Test Organization")).isPresent();
        assertThat(organisationRepository.findByNameIgnoreCase("test organization")).isPresent();
        assertThat(organisationRepository.findByNameIgnoreCase("TEST ORGANIZATION")).isPresent();
        assertThat(organisationRepository.findByNameIgnoreCase("TeSt OrGaNiZaTiOn")).isPresent();

        // Verify the found entity is the same
        Optional<OrganisationEntity> found = organisationRepository.findByNameIgnoreCase("test organization");
        assertThat(found.get().getName()).isEqualTo("Test Organization");
        assertThat(found.get().getDescription()).isEqualTo("Test description");
    }

    /**
     * Test: findByNameIgnoreCase() returns empty for non-existent name.
     */
    @Test
    @DisplayName("findByNameIgnoreCase() returns empty for non-existent name")
    void testFindByNameIgnoreCaseReturnsEmptyForNonExistent() {
        // When
        Optional<OrganisationEntity> result = organisationRepository.findByNameIgnoreCase("Non Existent Org");

        // Then
        assertThat(result).isEmpty();
    }

    /**
     * Test: New fields are persisted and retrieved correctly.
     */
    @Test
    @DisplayName("New standards fields are persisted and retrieved correctly")
    void testNewStandardsFieldsPersistence() {
        // Given
        OrganisationEntity entity = OrganisationEntity.builder()
            .id("org-" + UUID.randomUUID().toString())
            .name("Standards Test Org")
            .docsAppliedToAllSources(List.of("doc1.md", "doc2.md"))
            .docsAppliedToTechStack(List.of("tech.md"))
            .docsAppliedToCodingStyles(List.of("style.md"))
            .docsAppliedToConventions(List.of("conv.md"))
            .docsAppliedToErrorHandling(List.of("err.md"))
            .docsAppliedToValidation(List.of("valid.md"))
            .techStandardsGenerated(true)
            .build();

        // When
        organisationRepository.save(entity);
        Optional<OrganisationEntity> result = organisationRepository.findById(entity.getId());

        // Then
        assertThat(result).isPresent();
        OrganisationEntity saved = result.get();
        assertThat(saved.getDocsAppliedToAllSources()).containsExactly("doc1.md", "doc2.md");
        assertThat(saved.getDocsAppliedToTechStack()).containsExactly("tech.md");
        assertThat(saved.getDocsAppliedToCodingStyles()).containsExactly("style.md");
        assertThat(saved.getDocsAppliedToConventions()).containsExactly("conv.md");
        assertThat(saved.getDocsAppliedToErrorHandling()).containsExactly("err.md");
        assertThat(saved.getDocsAppliedToValidation()).containsExactly("valid.md");
        assertThat(saved.getTechStandardsGenerated()).isTrue();
    }
}
