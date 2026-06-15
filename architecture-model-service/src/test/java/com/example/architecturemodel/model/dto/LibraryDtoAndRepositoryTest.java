package com.example.architecturemodel.model.dto;

import com.example.architecturemodel.model.dto.entity.LibraryDto;
import com.example.architecturemodel.model.dto.relationship.CodeUnitDependencyDto;
import com.example.architecturemodel.model.entity.CodeUnitDependencyEntity;
import com.example.architecturemodel.model.entity.LibraryEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.entity.LibraryRepository;
import com.example.architecturemodel.repository.relationship.CodeUnitDependencyRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
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
 * JSON serialisation tests for LibraryDto / CodeUnitDependencyDto plus
 * repository scoping tests for the corresponding repositories.
 *
 * Spec: 2026-05-05-library-backend-foundation, Task 3.1.
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:libdtodb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
})
class LibraryDtoAndRepositoryTest {

    @Autowired
    private LibraryRepository libraryRepository;

    @Autowired
    private CodeUnitDependencyRepository codeUnitDependencyRepository;

    @Autowired
    private ModelFileRepository modelFileRepository;

    private final ObjectMapper objectMapper = new ObjectMapper().registerModule(new JavaTimeModule());

    private String modelFileIdA;
    private String modelFileIdB;

    @BeforeEach
    void setUp() {
        ModelFileEntity mfA = ModelFileEntity.builder()
            .id("lib-dto-mfA")
            .filename("dto-test-A.json")
            .isDefault(false)
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .build();
        ModelFileEntity mfB = ModelFileEntity.builder()
            .id("lib-dto-mfB")
            .filename("dto-test-B.json")
            .isDefault(false)
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .build();
        modelFileRepository.save(mfA);
        modelFileRepository.save(mfB);
        modelFileRepository.flush();
        modelFileIdA = mfA.getId();
        modelFileIdB = mfB.getId();
    }

    /**
     * Test 3.1.a: LibraryDto round-trips through Jackson with snake_case JSON
     * property names. Verifies model_file_id is NOT present in the JSON.
     */
    @Test
    @DisplayName("LibraryDto round-trips with snake_case names and excludes model_file_id")
    void libraryDtoRoundTripsWithSnakeCase() throws Exception {
        LibraryDto dto = new LibraryDto(
            "lib-1",
            "com.example:foo",
            "Foo library",
            "internal",
            "2026-01-01",
            "2027-01-01",
            "MAVEN",
            "https://repo.example.com/foo",
            "modules/foo",
            "Java 21",
            Map.of("language", "java-21"),
            "java-21",
            List.of("spring-boot-3"),
            "high",
            Instant.parse("2026-04-20T10:00:00Z"),
            "DISCOVERY",
            "manifest-scanner",
            "pom.xml",
            "SCANNED",
            "scan ok",
            "2026-05-04T12:00:00Z",
            "ps-1"
        );

        String json = objectMapper.writeValueAsString(dto);

        assertThat(json).contains("\"id\":\"lib-1\"");
        assertThat(json).contains("\"repo_location\":\"https://repo.example.com/foo\"");
        assertThat(json).contains("\"repo_subfolder\":\"modules/foo\"");
        assertThat(json).contains("\"core_tech_resolution_confidence\":\"high\"");
        assertThat(json).contains("\"core_tech_language_pack\":\"java-21\"");
        assertThat(json).contains("\"core_tech_framework_packs\":[\"spring-boot-3\"]");
        assertThat(json).contains("\"last_verified_at\":\"2026-05-04T12:00:00Z\"");
        assertThat(json).contains("\"package_set_id\":\"ps-1\"");
        assertThat(json).contains("\"source_origin\":\"DISCOVERY\"");

        // model_file_id MUST NOT be present (server-side only).
        assertThat(json).doesNotContain("model_file_id");
        // camelCase MUST NOT leak.
        assertThat(json).doesNotContain("repoLocation");
        assertThat(json).doesNotContain("coreTech");
        assertThat(json).doesNotContain("lastVerifiedAt");
        assertThat(json).doesNotContain("packageSetId");

        LibraryDto parsed = objectMapper.readValue(json, LibraryDto.class);
        assertThat(parsed).isEqualTo(dto);
    }

    /**
     * Test 3.1.b: CodeUnitDependencyDto round-trips with snake_case names,
     * BigDecimal confidence preserved, and no model_file_id.
     */
    @Test
    @DisplayName("CodeUnitDependencyDto round-trips with snake_case names")
    void codeUnitDependencyDtoRoundTripsWithSnakeCase() throws Exception {
        CodeUnitDependencyDto dto = new CodeUnitDependencyDto(
            "cud-1",
            "ap-source",
            "ap-target",
            "com.example:foo",
            "1.4.2",
            "[1.0,2.0)",
            "COMPILE",
            "pom.xml",
            42,
            "MANIFEST_SCAN",
            new BigDecimal("0.875"),
            "foo dep",
            "scanned"
        );

        String json = objectMapper.writeValueAsString(dto);

        assertThat(json).contains("\"source_application_point_id\":\"ap-source\"");
        assertThat(json).contains("\"target_application_point_id\":\"ap-target\"");
        assertThat(json).contains("\"declared_name\":\"com.example:foo\"");
        assertThat(json).contains("\"declared_version\":\"1.4.2\"");
        assertThat(json).contains("\"declared_version_range\":\"[1.0,2.0)\"");
        assertThat(json).contains("\"manifest_path\":\"pom.xml\"");
        assertThat(json).contains("\"manifest_line\":42");
        assertThat(json).contains("\"evidence_source\":\"MANIFEST_SCAN\"");
        assertThat(json).contains("\"confidence\":0.875");

        assertThat(json).doesNotContain("model_file_id");
        assertThat(json).doesNotContain("sourceApplicationPointId");

        CodeUnitDependencyDto parsed = objectMapper.readValue(json, CodeUnitDependencyDto.class);
        assertThat(parsed).isEqualTo(dto);
    }

    /**
     * Test 3.1.c: LibraryRepository.findByModelFileId returns only rows for
     * the requested modelFileId (no cross-modelFileId leakage).
     */
    @Test
    @DisplayName("LibraryRepository.findByModelFileId scopes results")
    void libraryRepositoryFindByModelFileIdScopes() {
        libraryRepository.save(LibraryEntity.builder()
            .id("lib-A1").modelFileId(modelFileIdA).name("A1").build());
        libraryRepository.save(LibraryEntity.builder()
            .id("lib-A2").modelFileId(modelFileIdA).name("A2").build());
        libraryRepository.save(LibraryEntity.builder()
            .id("lib-B1").modelFileId(modelFileIdB).name("B1").build());
        libraryRepository.flush();

        List<LibraryEntity> rowsA = libraryRepository.findByModelFileId(modelFileIdA);
        List<LibraryEntity> rowsB = libraryRepository.findByModelFileId(modelFileIdB);

        assertThat(rowsA).extracting(LibraryEntity::getId).containsExactlyInAnyOrder("lib-A1", "lib-A2");
        assertThat(rowsB).extracting(LibraryEntity::getId).containsExactly("lib-B1");
    }

    /**
     * Test 3.1.d: CodeUnitDependencyRepository.deleteByModelFileId removes
     * only the matching rows; BigDecimal confidence round-trips intact via
     * the repository.
     */
    @Test
    @DisplayName("CodeUnitDependencyRepository.deleteByModelFileId scopes deletes; confidence round-trips")
    void codeUnitDependencyRepositoryDeleteByModelFileId() {
        codeUnitDependencyRepository.save(CodeUnitDependencyEntity.builder()
            .id("cud-A1")
            .modelFileId(modelFileIdA)
            .sourceApplicationPointId("ap-src-A")
            .targetApplicationPointId("ap-tgt-A")
            .confidence(new BigDecimal("0.500"))
            .build());
        codeUnitDependencyRepository.save(CodeUnitDependencyEntity.builder()
            .id("cud-B1")
            .modelFileId(modelFileIdB)
            .sourceApplicationPointId("ap-src-B")
            .targetApplicationPointId("ap-tgt-B")
            .confidence(new BigDecimal("0.999"))
            .build());
        codeUnitDependencyRepository.flush();

        // Confidence round-trips via the repository
        CodeUnitDependencyEntity reloaded = codeUnitDependencyRepository.findById("cud-B1").orElseThrow();
        assertThat(reloaded.getConfidence()).isEqualByComparingTo(new BigDecimal("0.999"));
        assertThat(reloaded.getConfidence().scale()).isEqualTo(3);

        codeUnitDependencyRepository.deleteByModelFileId(modelFileIdA);
        codeUnitDependencyRepository.flush();

        assertThat(codeUnitDependencyRepository.findByModelFileId(modelFileIdA)).isEmpty();
        assertThat(codeUnitDependencyRepository.findByModelFileId(modelFileIdB))
            .extracting(CodeUnitDependencyEntity::getId).containsExactly("cud-B1");
    }
}
