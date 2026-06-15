package com.example.architecturemodel.migration;

import com.example.architecturemodel.model.dto.entity.ClassDto;
import com.example.architecturemodel.model.entity.ClassEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.entity.ClassRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.test.context.ActiveProfiles;

import java.lang.reflect.Field;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Migration verification tests for migration 077: classes table FK migration
 * from application_point_id to service_id.
 *
 * Since tests use H2 with hibernate ddl-auto=create-drop, we verify the JPA
 * entity and DTO field mappings which mirror the migration's column changes.
 *
 * Spec: Extension Pack Framework & LLM File-Level Analysis
 * Task Group 2: Classes Table Schema Migration (application_point_id -> service_id)
 */
@DataJpaTest
@ActiveProfiles("test")
class ClassServiceIdMigrationTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private ModelFileRepository modelFileRepository;

    @Autowired
    private ClassRepository classRepository;

    private ModelFileEntity modelFile;

    @BeforeEach
    void setUp() {
        modelFile = ModelFileEntity.builder()
            .id("test-model-file-077")
            .filename("test-class-migration-077")
            .isDefault(false)
            .build();
        modelFile = modelFileRepository.save(modelFile);
        entityManager.flush();
    }

    /**
     * Test 1: ClassEntity has serviceId field and not applicationPointId.
     * Verifies the JPA entity field was renamed from applicationPointId to serviceId.
     */
    @Test
    @DisplayName("ClassEntity has serviceId field and not applicationPointId")
    void classEntity_hasServiceIdField_notApplicationPointId() {
        // Verify serviceId field exists
        boolean hasServiceId = false;
        boolean hasApplicationPointId = false;
        for (Field field : ClassEntity.class.getDeclaredFields()) {
            if ("serviceId".equals(field.getName())) {
                hasServiceId = true;
            }
            if ("applicationPointId".equals(field.getName())) {
                hasApplicationPointId = true;
            }
        }
        assertThat(hasServiceId)
            .as("ClassEntity should have serviceId field")
            .isTrue();
        assertThat(hasApplicationPointId)
            .as("ClassEntity should NOT have applicationPointId field")
            .isFalse();
    }

    /**
     * Test 2: ClassDto has serviceId field and not applicationPointId.
     * Verifies the DTO record component was renamed.
     */
    @Test
    @DisplayName("ClassDto has serviceId field and not applicationPointId")
    void classDto_hasServiceIdField_notApplicationPointId() {
        // Verify serviceId record component exists
        boolean hasServiceId = false;
        boolean hasApplicationPointId = false;
        for (var component : ClassDto.class.getRecordComponents()) {
            if ("serviceId".equals(component.getName())) {
                hasServiceId = true;
            }
            if ("applicationPointId".equals(component.getName())) {
                hasApplicationPointId = true;
            }
        }
        assertThat(hasServiceId)
            .as("ClassDto should have serviceId record component")
            .isTrue();
        assertThat(hasApplicationPointId)
            .as("ClassDto should NOT have applicationPointId record component")
            .isFalse();
    }

    /**
     * Test 3: Liquibase migration SQL file contains correct DDL statements.
     * Verifies the migration drops application_point_id and adds service_id.
     */
    @Test
    @DisplayName("Migration SQL drops application_point_id and adds service_id with FK to services")
    void migrationSql_containsCorrectDdl() throws Exception {
        Path migrationFile = Path.of("src/main/resources/db/changelog/sql/077-class-service-id-migration.sql");
        assertThat(migrationFile).exists();

        String sql = Files.readString(migrationFile);

        // Verify DROP COLUMN statement
        assertThat(sql).containsIgnoringCase("DROP COLUMN");
        assertThat(sql).containsIgnoringCase("application_point_id");

        // Verify ADD COLUMN statement with FK reference
        assertThat(sql).containsIgnoringCase("ADD COLUMN service_id");
        assertThat(sql).containsIgnoringCase("REFERENCES services(id)");

        // Verify index creation for FK performance
        assertThat(sql).containsIgnoringCase("CREATE INDEX");
        assertThat(sql).containsIgnoringCase("idx_classes_service_id");
    }

    /**
     * Test 4: ClassEntity.serviceId column maps correctly and can be persisted/retrieved.
     * Verifies the JPA mapping to the service_id column works with the H2 database.
     */
    @Test
    @DisplayName("ClassEntity.serviceId can be persisted and retrieved (maps to service_id column)")
    void classEntity_serviceId_canBePersisted() {
        ClassEntity classEntity = ClassEntity.builder()
            .id("cls-test-077")
            .modelFileId(modelFile.getId())
            .name("UserService")
            .description("A test class entity")
            .namespace("com.example.service")
            .serviceId("svc-001")
            .build();

        classRepository.save(classEntity);
        entityManager.flush();
        entityManager.clear();

        ClassEntity loaded = classRepository.findById("cls-test-077").orElseThrow();
        assertThat(loaded.getServiceId()).isEqualTo("svc-001");
        assertThat(loaded.getName()).isEqualTo("UserService");
        assertThat(loaded.getNamespace()).isEqualTo("com.example.service");

        // Also verify serviceId can be null (nullable FK)
        ClassEntity classWithoutService = ClassEntity.builder()
            .id("cls-test-077-null")
            .modelFileId(modelFile.getId())
            .name("OrphanClass")
            .serviceId(null)
            .build();

        classRepository.save(classWithoutService);
        entityManager.flush();
        entityManager.clear();

        ClassEntity loadedNull = classRepository.findById("cls-test-077-null").orElseThrow();
        assertThat(loadedNull.getServiceId()).isNull();
    }
}
