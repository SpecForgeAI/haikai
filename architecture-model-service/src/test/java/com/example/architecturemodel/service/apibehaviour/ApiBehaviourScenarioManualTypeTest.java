package com.example.architecturemodel.service.apibehaviour;

import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourScenarioDto;
import com.example.architecturemodel.model.dto.apibehaviour.CreateApiBehaviourScenarioRequest;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourScenarioRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Service-layer test for the "Add New Behaviour — Manual Capture" feature
 * (Spec: 2026-06-20-add-new-behaviour-manual-capture, Task Group 1).
 *
 * <p>The ONLY AMS change for this feature is admitting {@code "manual"} into
 * both {@link ApiBehaviourScenarioService#ALLOWED_SCENARIO_TYPES} and
 * {@link ApiBehaviourScenarioService#ALLOWED_GENERATION_SOURCES}. These tests
 * pin that allow-set change and prove a {@code scenario_type='manual'} /
 * {@code generation_source='manual'} create (with non-blank method + path)
 * validates successfully rather than being rejected.</p>
 *
 * <p>Mirrors {@code ApiBehaviourCaptureAcceptedNullableTest}'s H2
 * PostgreSQL-mode + {@code JSONB AS JSON} alias harness so the entity's
 * {@code JsonType}-bound columns persist without a real PostgreSQL.</p>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:apibehaviourscenariomanualdb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON",
    "app.features.include-database=true"
})
@Import(ApiBehaviourScenarioService.class)
class ApiBehaviourScenarioManualTypeTest {

    @Autowired
    private ApiBehaviourScenarioRepository repository;

    @Autowired
    private ApiBehaviourScenarioService service;

    @Test
    @DisplayName("ALLOWED_SCENARIO_TYPES contains \"manual\"")
    void allowedScenarioTypesContainsManual() {
        assertThat(ApiBehaviourScenarioService.ALLOWED_SCENARIO_TYPES)
            .as("manual scenario_type must be admitted by the allow-set")
            .contains("manual");
    }

    @Test
    @DisplayName("ALLOWED_GENERATION_SOURCES contains \"manual\"")
    void allowedGenerationSourcesContainsManual() {
        assertThat(ApiBehaviourScenarioService.ALLOWED_GENERATION_SOURCES)
            .as("manual generation_source must be admitted by the allow-set")
            .contains("manual");
    }

    @Test
    @DisplayName("create() with scenario_type='manual' + generation_source='manual' is accepted")
    void createManualScenarioIsAccepted() {
        UUID sessionId = UUID.randomUUID();
        UUID operationId = UUID.randomUUID();

        CreateApiBehaviourScenarioRequest request = new CreateApiBehaviourScenarioRequest(
            sessionId,
            operationId,
            "Manual: GET /widgets 2026-06-20T00:00:00Z",
            "manual",   // scenarioType (under test)
            null,       // status -> defaults to draft
            "manual",   // generationSource (under test)
            "GET",      // requestMethod (non-blank, required)
            "/widgets", // requestPath (non-blank, required)
            null, null, null, // request query/headers/body json
            null        // notes
        );

        ApiBehaviourScenarioDto created = service.create(request);

        assertThat(created.scenarioType())
            .as("manual scenario_type must round-trip through create()")
            .isEqualTo("manual");
        assertThat(created.generationSource())
            .as("manual generation_source must round-trip through create()")
            .isEqualTo("manual");

        assertThat(repository.findById(created.id())).isPresent();
    }
}
