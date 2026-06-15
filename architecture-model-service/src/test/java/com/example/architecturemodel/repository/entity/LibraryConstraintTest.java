package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.ApplicationPointEntity;
import com.example.architecturemodel.model.entity.CodeUnitDependencyEntity;
import com.example.architecturemodel.model.entity.LibraryEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.relationship.CodeUnitDependencyRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.time.OffsetDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Constraint validation for the new libraries + code_unit_dependencies tables
 * and the relaxed application_points.target_type CHECK from changeset 124.
 *
 * <p>The codebase's H2 test profile uses Hibernate ddl-auto=create-drop, which
 * generates the schema from JPA entity annotations rather than from the SQL
 * changesets. Cross-table FKs mapped as plain {@code @Column} String fields are
 * not emitted as DB-level FK constraints by Hibernate at the H2 layer (matching
 * the existing DataMovementEntity and Infrastructure cross-domain pattern).
 * The constraints that ARE generated and enforced in this slice are the ones
 * mirrored explicitly on the entity classes:
 * <ul>
 *   <li>{@code LibraryEntity} {@code @Check} on {@code core_tech_resolution_confidence}
 *       (lowercase 5-value list).</li>
 *   <li>{@code ApplicationPointEntity} {@code @Check} on {@code target_type}
 *       (relaxed to admit LIBRARY).</li>
 *   <li>{@code @Column(nullable = false)} markers on required envelope columns.</li>
 * </ul>
 *
 * <p>Spec: 2026-05-05-library-backend-foundation, Task 1.1.</p>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    // Register JSONB as a JSON domain alias so the libraries table (whose
    // tech-hints columns use columnDefinition = "jsonb") is created cleanly
    // by Hibernate ddl-auto on H2 in PostgreSQL mode.
    "spring.datasource.url=jdbc:h2:mem:libconstraintdb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
})
class LibraryConstraintTest {

    @Autowired
    private LibraryRepository libraryRepository;

    @Autowired
    private CodeUnitDependencyRepository codeUnitDependencyRepository;

    @Autowired
    private ApplicationPointRepository applicationPointRepository;

    @Autowired
    private ApplicationRepository applicationRepository;

    @Autowired
    private ModelFileRepository modelFileRepository;

    private String modelFileId;
    private String applicationId;

    @BeforeEach
    void setUp() {
        ModelFileEntity modelFile = ModelFileEntity.builder()
            .id("lib-constr-mf")
            .filename("lib-constraint-test.json")
            .isDefault(false)
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .build();
        modelFileRepository.save(modelFile);
        modelFileRepository.flush();
        modelFileId = modelFile.getId();

        var application = com.example.architecturemodel.model.entity.ApplicationEntity.builder()
            .id("lib-constr-app")
            .modelFileId(modelFileId)
            .name("Constraint App")
            .abbreviation("CA")
            .build();
        applicationRepository.save(application);
        applicationRepository.flush();
        applicationId = application.getId();
    }

    /**
     * Test 1.1.a: A libraries row with the lowercase value 'high' for
     * core_tech_resolution_confidence is accepted (positive case).
     */
    @Test
    void acceptsLowercaseConfidenceValue() {
        LibraryEntity library = LibraryEntity.builder()
            .id("lib-conf-low")
            .modelFileId(modelFileId)
            .name("Lowercase OK")
            .coreTechResolutionConfidence("high")
            .build();
        libraryRepository.save(library);
        libraryRepository.flush();

        assertThat(libraryRepository.findById("lib-conf-low")).isPresent();
    }

    /**
     * Test 1.1.b: A libraries row with the uppercase value 'HIGH' is rejected
     * by the {@code @Check} mirror of the libraries_core_tech_resolution_confidence_check
     * constraint.
     */
    @Test
    void rejectsUppercaseConfidenceValue() {
        LibraryEntity library = LibraryEntity.builder()
            .id("lib-conf-upper")
            .modelFileId(modelFileId)
            .name("Uppercase Bad")
            .coreTechResolutionConfidence("HIGH")
            .build();

        assertThatThrownBy(() -> {
            libraryRepository.save(library);
            libraryRepository.flush();
        }).isInstanceOf(DataIntegrityViolationException.class);
    }

    /**
     * Test 1.1.c: An application_points row with target_type = 'LIBRARY' is
     * accepted by the relaxed CHECK (positive case for the changeset 124 swap).
     * Mirrors the SQL CHECK via the ApplicationPointEntity {@code @Check}.
     */
    @Test
    void applicationPointsAcceptsLibraryTargetType() {
        ApplicationPointEntity point = ApplicationPointEntity.builder()
            .id("ap-lib-positive")
            .modelFileId(modelFileId)
            .name("Library Target")
            .kind("FUNCTION")
            .applicationId(applicationId)
            .targetType("LIBRARY")
            .targetRefId("lib-target-ref-id")
            .build();
        applicationPointRepository.save(point);
        applicationPointRepository.flush();

        assertThat(applicationPointRepository.findById("ap-lib-positive")).isPresent();
    }

    /**
     * Test 1.1.d: An application_points row with target_type = 'FOO' is rejected
     * by the relaxed CHECK (negative case).
     */
    @Test
    void applicationPointsRejectsInvalidTargetType() {
        ApplicationPointEntity point = ApplicationPointEntity.builder()
            .id("ap-foo-negative")
            .modelFileId(modelFileId)
            .name("Bad Target")
            .kind("FUNCTION")
            .applicationId(applicationId)
            .targetType("FOO")
            .targetRefId("bogus-ref-id")
            .build();

        assertThatThrownBy(() -> {
            applicationPointRepository.save(point);
            applicationPointRepository.flush();
        }).isInstanceOf(DataIntegrityViolationException.class);
    }

    /**
     * Test 1.1.e: code_unit_dependencies enforces NOT NULL on
     * source_application_point_id and target_application_point_id (the polymorphic
     * endpoints). This is the closest practical FK-shape constraint check
     * available within the {@code @DataJpaTest} slice -- pure cross-table FKs
     * are not emitted by Hibernate for plain @Column String fields. The full
     * referential-integrity round-trip is covered by the integration test in
     * Task Group 4.
     */
    @Test
    void codeUnitDependencyRejectsNullPolymorphicEndpoints() {
        CodeUnitDependencyEntity edge = CodeUnitDependencyEntity.builder()
            .id("cud-null-source")
            .modelFileId(modelFileId)
            // source_application_point_id intentionally null
            .targetApplicationPointId("ap-some-target")
            .build();

        assertThatThrownBy(() -> {
            codeUnitDependencyRepository.save(edge);
            codeUnitDependencyRepository.flush();
        }).isInstanceOf(DataIntegrityViolationException.class);
    }
}
