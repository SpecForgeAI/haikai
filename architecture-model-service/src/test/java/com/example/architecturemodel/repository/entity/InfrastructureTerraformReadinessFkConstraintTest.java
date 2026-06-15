package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.IaCResourceBindingEntity;
import com.example.architecturemodel.model.entity.IaCSourceEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.relationship.IaCResourceBindingRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.context.ActiveProfiles;

import java.time.OffsetDateTime;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Constraint validation for the 2 new tables {@code iac_sources} and
 * {@code iac_resource_bindings} (Spec:
 * 2026-05-05-infrastructure-terraform-discovery-readiness, Task 1.1).
 *
 * <p>The codebase's H2 test profile uses Hibernate ddl-auto=create-drop with
 * Liquibase disabled, which generates the schema from JPA entity annotations.
 * Cross-table FKs are mapped as plain {@code @Column} String fields (matching
 * spec 1/2/6 relationship-entity pattern) so cross-table FK constraints are
 * not emitted by Hibernate at the H2 layer. The schema-level constraints that
 * ARE generated and enforced are the {@code @Column(nullable = false)}
 * markers on the required envelope and required-FK columns
 * ({@code description}, {@code tags}, {@code model_file_id},
 * {@code iac_source_id}, {@code infrastructure_point_id}).</p>
 *
 * <p>Each test inserts a row that omits one of the spec'd NOT NULL columns
 * and asserts the persistence layer rejects it with
 * {@link DataIntegrityViolationException}.</p>
 */
@DataJpaTest
@ActiveProfiles("test")
class InfrastructureTerraformReadinessFkConstraintTest {

    @Autowired
    private IaCSourceRepository iacSourceRepository;

    @Autowired
    private IaCResourceBindingRepository iacResourceBindingRepository;

    @Autowired
    private ModelFileRepository modelFileRepository;

    private String modelFileId;

    @BeforeEach
    void setUp() {
        ModelFileEntity modelFile = ModelFileEntity.builder()
            .id("iac-fk-mf")
            .filename("iac-fk-test.json")
            .isDefault(false)
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .build();
        modelFileRepository.save(modelFile);
        modelFileRepository.flush();
        modelFileId = modelFile.getId();
    }

    /**
     * Test 1: IaCSourceEntity rejects rows missing the required
     * {@code description} envelope column.
     */
    @Test
    void iacSourceRejectsRowWithNullDescription() {
        IaCSourceEntity invalid = IaCSourceEntity.builder()
            .id("iac-src-bad-desc")
            .modelFileId(modelFileId)
            .name("Terraform Repo X")
            // description intentionally null -- spec contract: TEXT NOT NULL
            .tags("[]")
            .build();
        assertThatThrownBy(() -> {
            iacSourceRepository.save(invalid);
            iacSourceRepository.flush();
        }).isInstanceOf(DataIntegrityViolationException.class);
    }

    /**
     * Test 2: IaCSourceEntity rejects rows missing the required {@code tags}
     * envelope column.
     */
    @Test
    void iacSourceRejectsRowWithNullTags() {
        IaCSourceEntity invalid = IaCSourceEntity.builder()
            .id("iac-src-bad-tags")
            .modelFileId(modelFileId)
            .name("Terraform Repo Y")
            .description("infra-as-code")
            // tags intentionally null -- spec contract: TEXT NOT NULL
            .build();
        assertThatThrownBy(() -> {
            iacSourceRepository.save(invalid);
            iacSourceRepository.flush();
        }).isInstanceOf(DataIntegrityViolationException.class);
    }

    /**
     * Test 3: IaCResourceBindingEntity rejects rows missing the required
     * {@code iac_source_id} FK column.
     */
    @Test
    void iacResourceBindingRejectsRowWithNullIacSourceId() {
        IaCResourceBindingEntity invalid = IaCResourceBindingEntity.builder()
            .id("iac-bind-bad-src")
            .modelFileId(modelFileId)
            // iacSourceId intentionally null -- spec contract: NOT NULL FK
            .infrastructurePointId("ip-x")
            .description("Cloud Run service binding")
            .tags("[]")
            .build();
        assertThatThrownBy(() -> {
            iacResourceBindingRepository.save(invalid);
            iacResourceBindingRepository.flush();
        }).isInstanceOf(DataIntegrityViolationException.class);
    }

    /**
     * Test 4: IaCResourceBindingEntity rejects rows missing the required
     * {@code infrastructure_point_id} FK column AND missing required
     * envelope columns ({@code description} / {@code tags}).
     */
    @Test
    void iacResourceBindingRejectsRowWithNullInfrastructurePointId() {
        IaCResourceBindingEntity invalid = IaCResourceBindingEntity.builder()
            .id("iac-bind-bad-ip")
            .modelFileId(modelFileId)
            .iacSourceId("src-x")
            // infrastructurePointId intentionally null -- spec contract: NOT NULL FK
            .description("Cloud Run service binding")
            .tags("[]")
            .build();
        assertThatThrownBy(() -> {
            iacResourceBindingRepository.save(invalid);
            iacResourceBindingRepository.flush();
        }).isInstanceOf(DataIntegrityViolationException.class);
    }
}
