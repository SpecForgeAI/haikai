package com.example.architecturemodel.integration;

import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.model.entity.ServiceEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.entity.ServiceRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.core.io.ClassPathResource;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.util.StreamUtils;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Integration tests for the five Tech-Hints-LLM-Resolution columns on the
 * {@code services} table.
 *
 * Spec: Tech Hints LLM Resolution (2026-04-20)
 * Task Group 1: Schema + Entity + DTO + Save Flow
 *
 * Task 1.1 coverage:
 * <ul>
 *   <li>Integration: save -> reload of a service with all 5 fields populated
 *       (high confidence + resolved map).</li>
 *   <li>Integration: save -> reload of a service with all 5 fields NULL.</li>
 *   <li>Implicit CHECK-constraint assertion against the Liquibase SQL text (the
 *       H2 PostgreSQL-compat test DB does not run Liquibase, so the 5-value
 *       enum is verified by inspecting the changeset rather than enforced at
 *       the test DB level).</li>
 * </ul>
 *
 * The @DataJpaTest harness uses H2 in PostgreSQL mode with Hibernate
 * {@code ddl-auto: create-drop}; JSONB round-trips through Hypersistence's
 * {@code JsonType} the same way other jsonb entities in this codebase are
 * exercised (see {@code WorkItemMigrationTest}).
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    // H2 does not natively understand JSONB; register it as a domain alias for
    // JSON via the H2 URL INIT hook so Hibernate's generated DDL
    // ("... jsonb ...") is accepted. This is test-only; production uses
    // PostgreSQL where JSONB is native.
    "spring.datasource.url=jdbc:h2:mem:techhintsresolvedb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
})
class ServiceTechHintsResolvedPersistenceTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private ServiceRepository serviceRepository;

    @Autowired
    private ModelFileRepository modelFileRepository;

    private ModelFileEntity modelFile;

    @BeforeEach
    void setUp() {
        modelFile = ModelFileEntity.builder()
            .id("model-tech-hints-integration")
            .filename("tech-hints-integration-test")
            .isDefault(false)
            .build();
        modelFile = modelFileRepository.save(modelFile);
        entityManager.flush();
    }

    /**
     * Task 1.1: Service with all 5 resolved fields populated round-trips through
     * the DB unchanged.
     */
    @Test
    @DisplayName("Task 1.1: save + reload of service with all 5 resolved fields populated")
    void saveAndReload_populatedResolvedFields_roundTripsUnchanged() {
        // Given: a service with a rich resolved payload
        Map<String, Object> resolvedPayload = new HashMap<>();
        resolvedPayload.put("languagePack", "java-21");
        resolvedPayload.put("frameworkPacks", List.of("spring-boot-3"));
        resolvedPayload.put("confirmationSentence",
            "Detected Java 21 service using Spring Boot 3.");
        resolvedPayload.put("confidence", "high");

        Map<String, Object> repoCheck = new HashMap<>();
        repoCheck.put("status", "confirmed");
        repoCheck.put("note", "pom.xml confirms Spring Boot 3.");
        resolvedPayload.put("repoCrossCheck", repoCheck);

        // Truncate to milliseconds to dodge H2 / JDBC sub-millisecond rounding.
        Instant resolvedAt = Instant.now().truncatedTo(ChronoUnit.MILLIS);

        ServiceEntity saved = ServiceEntity.builder()
            .id("svc-tech-hints-populated")
            .modelFileId(modelFile.getId())
            .applicationId("app-orders")
            .name("Orders Service")
            .serviceType("Microservice")
            .coreTech("Java 21 (Spring Boot 3)")
            .repoLocation("https://github.com/acme/orders.git")
            .repoSubfolder("services/orders")
            .isInternal(true)
            .coreTechResolved(resolvedPayload)
            .coreTechLanguagePack("java-21")
            .coreTechFrameworkPacks(List.of("spring-boot-3"))
            .coreTechResolutionConfidence("high")
            .coreTechResolvedAt(resolvedAt)
            .build();

        serviceRepository.save(saved);
        entityManager.flush();
        entityManager.clear();

        // When: reload by id from an empty persistence context
        ServiceEntity loaded = serviceRepository.findById("svc-tech-hints-populated")
            .orElseThrow(() -> new AssertionError("service not found after save"));

        // Then: all 5 resolved columns round-trip unchanged
        assertThat(loaded.getCoreTechLanguagePack()).isEqualTo("java-21");
        assertThat(loaded.getCoreTechFrameworkPacks()).containsExactly("spring-boot-3");
        assertThat(loaded.getCoreTechResolutionConfidence()).isEqualTo("high");
        assertThat(loaded.getCoreTechResolvedAt()).isEqualTo(resolvedAt);

        Map<String, Object> loadedPayload = loaded.getCoreTechResolved();
        assertThat(loadedPayload).isNotNull();
        assertThat(loadedPayload.get("languagePack")).isEqualTo("java-21");
        assertThat(loadedPayload.get("confidence")).isEqualTo("high");
        assertThat(loadedPayload.get("frameworkPacks"))
            .asInstanceOf(org.assertj.core.api.InstanceOfAssertFactories.LIST)
            .containsExactly("spring-boot-3");
        assertThat(loadedPayload.get("repoCrossCheck"))
            .asInstanceOf(org.assertj.core.api.InstanceOfAssertFactories.MAP)
            .containsEntry("status", "confirmed")
            .containsEntry("note", "pom.xml confirms Spring Boot 3.");

        // And: pre-existing scalar fields are intact
        assertThat(loaded.getCoreTech()).isEqualTo("Java 21 (Spring Boot 3)");
        assertThat(loaded.getRepoLocation()).isEqualTo("https://github.com/acme/orders.git");
        assertThat(loaded.getRepoSubfolder()).isEqualTo("services/orders");
    }

    /**
     * Task 1.1: Service with all 5 resolved fields left NULL (legacy row shape)
     * round-trips through the DB unchanged. This is the state the discovery
     * tier gate reads as the rejection signal.
     */
    @Test
    @DisplayName("Task 1.1: save + reload of service with all 5 resolved fields NULL")
    void saveAndReload_nullResolvedFields_roundTripsAsNull() {
        ServiceEntity saved = ServiceEntity.builder()
            .id("svc-tech-hints-unresolved")
            .modelFileId(modelFile.getId())
            .applicationId("app-legacy")
            .name("Legacy Service")
            .serviceType("REST")
            .coreTech("Java")
            .isInternal(true)
            // All 5 new fields intentionally unset -> NULL
            .build();

        serviceRepository.save(saved);
        entityManager.flush();
        entityManager.clear();

        ServiceEntity loaded = serviceRepository.findById("svc-tech-hints-unresolved")
            .orElseThrow(() -> new AssertionError("service not found after save"));

        assertThat(loaded.getCoreTechResolved()).isNull();
        assertThat(loaded.getCoreTechLanguagePack()).isNull();
        assertThat(loaded.getCoreTechFrameworkPacks()).isNull();
        assertThat(loaded.getCoreTechResolutionConfidence()).isNull();
        assertThat(loaded.getCoreTechResolvedAt()).isNull();

        // And: pre-existing fields are still intact
        assertThat(loaded.getCoreTech()).isEqualTo("Java");
        assertThat(loaded.getName()).isEqualTo("Legacy Service");
    }

    /**
     * Task 1.1 negative-test coverage: verifies the 5-value CHECK constraint
     * is defined in the Liquibase changeset. The H2 test harness does not run
     * Liquibase, so the constraint is verified by inspection of the SQL
     * changeset text rather than by attempting an invalid insert.
     *
     * The test is deliberately narrow: it confirms each of the 5 permitted
     * confidence values appears in the changeset's CHECK clause and that the
     * column itself is declared in the same file. Broader CHECK permutations
     * are out of scope per task 1.1 ("Skip exhaustive CHECK-constraint
     * permutations").
     */
    @Test
    @DisplayName("Task 1.1: Liquibase changeset defines the 5-value confidence CHECK")
    void liquibaseChangeset_definesFiveValueConfidenceCheck() throws Exception {
        String changesetSql;
        try (var in = new ClassPathResource(
                "db/changelog/sql/2026-04-20-tech-hints-resolved.sql").getInputStream()) {
            changesetSql = StreamUtils.copyToString(in, StandardCharsets.UTF_8);
        }

        assertThat(changesetSql)
            .as("column declaration must be present")
            .contains("core_tech_resolution_confidence");

        // The CHECK clause lists exactly the five permitted values
        assertThat(changesetSql).contains("'high'");
        assertThat(changesetSql).contains("'low'");
        assertThat(changesetSql).contains("'none'");
        assertThat(changesetSql).contains("'tech-only'");
        assertThat(changesetSql).contains("'manual-override'");
        assertThat(changesetSql)
            .as("the constraint must be a CHECK constraint")
            .containsIgnoringCase("CHECK");
    }
}
