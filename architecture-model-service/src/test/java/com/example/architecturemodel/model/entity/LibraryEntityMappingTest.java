package com.example.architecturemodel.model.entity;

import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.entity.LibraryRepository;
import com.example.architecturemodel.repository.relationship.CodeUnitDependencyRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * JPA mapping round-trip tests for LibraryEntity and CodeUnitDependencyEntity.
 *
 * Spec: 2026-05-05-library-backend-foundation, Task 2.1.
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:libmappingdb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
})
class LibraryEntityMappingTest {

    @Autowired
    private LibraryRepository libraryRepository;

    @Autowired
    private CodeUnitDependencyRepository codeUnitDependencyRepository;

    @Autowired
    private ModelFileRepository modelFileRepository;

    private String modelFileId;

    @BeforeEach
    void setUp() {
        ModelFileEntity modelFile = ModelFileEntity.builder()
            .id("lib-map-mf")
            .filename("lib-mapping-test.json")
            .isDefault(false)
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .build();
        modelFileRepository.save(modelFile);
        modelFileRepository.flush();
        modelFileId = modelFile.getId();
    }

    /**
     * Test 2.1.a: LibraryEntity round-trip with the standard envelope, internal
     * library fields (repo_location + repo_subfolder), all 5 tech-hints columns,
     * all 6 provenance columns, and package_set_id set.
     */
    @Test
    void libraryEntityRoundTripsInternalVariant() {
        LibraryEntity library = LibraryEntity.builder()
            .id("lib-internal-1")
            .modelFileId(modelFileId)
            .name("com.example:foo-lib")
            .description("Internal library")
            .tags("internal,maven")
            .validFrom("2026-01-01")
            .validTo("2027-01-01")
            .ecosystem("MAVEN")
            .repoLocation("https://repo.example.com/foo")
            .repoSubfolder("modules/foo-lib")
            .coreTech("Java + Spring Boot")
            // Tech-hints (5)
            .coreTechResolved(Map.of("language", "java-21", "frameworks", List.of("spring-boot-3")))
            .coreTechLanguagePack("java-21")
            .coreTechFrameworkPacks(List.of("spring-boot-3"))
            .coreTechResolutionConfidence("high")
            .coreTechResolvedAt(Instant.parse("2026-04-20T10:00:00Z"))
            // Provenance (6)
            .sourceOrigin("DISCOVERY")
            .sourceSystem("manifest-scanner")
            .sourceReference("pom.xml")
            .generationStatus("SCANNED")
            .generationNotes("scan ok")
            .lastVerifiedAt("2026-05-04T12:00:00Z")
            .packageSetId(null) // package_set_id keeps FK ON DELETE SET NULL but not required
            .build();
        libraryRepository.save(library);
        libraryRepository.flush();

        LibraryEntity loaded = libraryRepository.findById("lib-internal-1").orElseThrow();
        assertThat(loaded.getName()).isEqualTo("com.example:foo-lib");
        assertThat(loaded.getEcosystem()).isEqualTo("MAVEN");
        assertThat(loaded.getRepoLocation()).isEqualTo("https://repo.example.com/foo");
        assertThat(loaded.getRepoSubfolder()).isEqualTo("modules/foo-lib");
        assertThat(loaded.getCoreTech()).isEqualTo("Java + Spring Boot");
        assertThat(loaded.getCoreTechLanguagePack()).isEqualTo("java-21");
        assertThat(loaded.getCoreTechFrameworkPacks()).containsExactly("spring-boot-3");
        assertThat(loaded.getCoreTechResolutionConfidence()).isEqualTo("high");
        assertThat(loaded.getCoreTechResolvedAt()).isEqualTo(Instant.parse("2026-04-20T10:00:00Z"));
        assertThat(loaded.getCoreTechResolved()).containsEntry("language", "java-21");
        // Provenance
        assertThat(loaded.getSourceOrigin()).isEqualTo("DISCOVERY");
        assertThat(loaded.getSourceSystem()).isEqualTo("manifest-scanner");
        assertThat(loaded.getSourceReference()).isEqualTo("pom.xml");
        assertThat(loaded.getGenerationStatus()).isEqualTo("SCANNED");
        assertThat(loaded.getGenerationNotes()).isEqualTo("scan ok");
        assertThat(loaded.getLastVerifiedAt()).isEqualTo("2026-05-04T12:00:00Z");
    }

    /**
     * Test 2.1.b: LibraryEntity round-trip for an external library variant
     * (repo_location and repo_subfolder both NULL) and JSONB string-blob
     * round-trip intact for core_tech_resolved.
     */
    @Test
    void libraryEntityRoundTripsExternalVariant() {
        LibraryEntity library = LibraryEntity.builder()
            .id("lib-external-1")
            .modelFileId(modelFileId)
            .name("lodash")
            .ecosystem("NPM")
            .coreTech("JavaScript")
            .coreTechResolved(Map.of("raw", "lodash@4.17.x"))
            .build();
        libraryRepository.save(library);
        libraryRepository.flush();

        LibraryEntity loaded = libraryRepository.findById("lib-external-1").orElseThrow();
        assertThat(loaded.getRepoLocation()).isNull();
        assertThat(loaded.getRepoSubfolder()).isNull();
        assertThat(loaded.getEcosystem()).isEqualTo("NPM");
        assertThat(loaded.getCoreTechResolved()).containsEntry("raw", "lodash@4.17.x");
    }

    /**
     * Test 2.1.c: CodeUnitDependencyEntity round-trip with all declared
     * coordinate fields, BigDecimal confidence at scale 3, and both polymorphic
     * endpoint ids set.
     */
    @Test
    void codeUnitDependencyEntityRoundTripsAllFields() {
        CodeUnitDependencyEntity edge = CodeUnitDependencyEntity.builder()
            .id("cud-1")
            .modelFileId(modelFileId)
            .sourceApplicationPointId("ap-source-1")
            .targetApplicationPointId("ap-target-1")
            .declaredName("com.example:foo")
            .declaredVersion("1.4.2")
            .declaredVersionRange("[1.0,2.0)")
            .scope("COMPILE")
            .manifestPath("pom.xml")
            .manifestLine(42)
            .evidenceSource("MANIFEST_SCAN")
            .confidence(new BigDecimal("0.875"))
            .description("foo dep")
            .tags("scanned")
            .build();
        codeUnitDependencyRepository.save(edge);
        codeUnitDependencyRepository.flush();

        CodeUnitDependencyEntity loaded = codeUnitDependencyRepository.findById("cud-1").orElseThrow();
        assertThat(loaded.getSourceApplicationPointId()).isEqualTo("ap-source-1");
        assertThat(loaded.getTargetApplicationPointId()).isEqualTo("ap-target-1");
        assertThat(loaded.getDeclaredName()).isEqualTo("com.example:foo");
        assertThat(loaded.getDeclaredVersion()).isEqualTo("1.4.2");
        assertThat(loaded.getDeclaredVersionRange()).isEqualTo("[1.0,2.0)");
        assertThat(loaded.getScope()).isEqualTo("COMPILE");
        assertThat(loaded.getManifestPath()).isEqualTo("pom.xml");
        assertThat(loaded.getManifestLine()).isEqualTo(42);
        assertThat(loaded.getEvidenceSource()).isEqualTo("MANIFEST_SCAN");
        assertThat(loaded.getConfidence()).isEqualByComparingTo(new BigDecimal("0.875"));
        // Confirm scale 3 round-trips intact (no truncation).
        assertThat(loaded.getConfidence().scale()).isEqualTo(3);
    }
}
