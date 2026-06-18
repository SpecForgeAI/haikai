package com.example.architecturemodel.repository.apibehaviour;

import com.example.architecturemodel.mapper.apibehaviour.ApiBehaviourMapper;
import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourDiffItemDto;
import com.example.architecturemodel.model.dto.apibehaviour.CreateApiBehaviourDiffItemRequest;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourDiffEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourDiffItemEntity;
import com.example.architecturemodel.service.apibehaviour.ApiBehaviourDiffItemService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Objects;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Task Group 1.1 tests for the new {@code header_classification} column on
 * {@code api_behaviour_diff_items} and the new {@code body_ordering_drift}
 * value of the existing {@code body_classification} column (Reconcile
 * Full-Response Fidelity &amp; Distinct Break Types, 2026-06-17 -- Task
 * Group 1).
 *
 * <p>Mirrors {@code BaselineItemVolatilePathsTest}: the {@code @DataJpaTest} +
 * H2 PostgreSQL-mode JPA-mapping round-trip, and the static-text idiom for the
 * changeset 190 + master-registration check. The {@code @DataJpaTest} slice
 * runs Hibernate {@code create-drop} DDL off the entity (Liquibase is disabled
 * in the test profile), so the round-trip proves the entity column maps; the
 * changeset text test proves the production DDL is present and registered.</p>
 *
 * <p>Six focused tests (within the 2-8 budget per task 1.1):</p>
 * <ol>
 *   <li>{@code header_classification} round-trips through the JPA mapping AND
 *       {@code toDto} for each of the three valid values;</li>
 *   <li>a {@code null} {@code header_classification} round-trips as
 *       {@code null} (the skipped-header-dimension / backward-compatible
 *       default);</li>
 *   <li>the {@code create} service accepts the three valid header values;</li>
 *   <li>the {@code create} service rejects an invalid header value;</li>
 *   <li>the {@code create} service accepts {@code body_ordering_drift} as a
 *       {@code body_classification} value (no schema change);</li>
 *   <li>the DTO + create request serialise {@code header_classification} as
 *       snake_case on the wire (AMS default) and deserialise round-trip;</li>
 *   <li>changeset 190 adds {@code header_classification text NULL} with a
 *       {@code not.columnExists} precondition and is registered AFTER 189
 *       (189 untouched).</li>
 * </ol>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:diffitemheaderdb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON",
    "app.features.include-database=true"
})
@Import(ApiBehaviourDiffItemService.class)
class DiffItemHeaderClassificationTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private ApiBehaviourDiffItemRepository diffItemRepository;

    @Autowired
    private ApiBehaviourDiffRepository diffRepository;

    @Autowired
    private ApiBehaviourDiffItemService diffItemService;

    private UUID projectId;
    private UUID diffId;

    @BeforeEach
    void seedParentDiff() {
        projectId = UUID.randomUUID();
        ApiBehaviourDiffEntity diff = ApiBehaviourDiffEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .architectureId(UUID.randomUUID())
            .sourceBaselineId(UUID.randomUUID())
            .targetBaselineId(UUID.randomUUID())
            .status("computing")
            .build();
        diffRepository.saveAndFlush(diff);
        this.diffId = diff.getId();
    }

    private static ApiBehaviourDiffItemEntity.ApiBehaviourDiffItemEntityBuilder baseItem(UUID diffId) {
        return ApiBehaviourDiffItemEntity.builder()
            .id(UUID.randomUUID())
            .diffId(diffId)
            .method("GET")
            .path("/widgets")
            .scenarioName("happy")
            .statusClassification("status_match");
    }

    private CreateApiBehaviourDiffItemRequest createReq(
            String bodyClassification, String headerClassification) {
        return new CreateApiBehaviourDiffItemRequest(
            diffId, "GET", "/widgets", "happy",
            UUID.randomUUID(), UUID.randomUUID(),
            "status_match", bodyClassification, headerClassification,
            200, 200, null, null
        );
    }

    private String readClasspathResource(String path) throws Exception {
        try (var stream = Objects.requireNonNull(
            getClass().getClassLoader().getResourceAsStream(path),
            "missing classpath resource: " + path);
             var reader = new BufferedReader(
                 new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line).append('\n');
            }
            return sb.toString();
        }
    }

    @Test
    @DisplayName("header_classification round-trips through JPA + toDto for each of the three valid values")
    void headerClassificationRoundTrips() {
        for (String value : new String[] {
            "header_match", "header_value_drift", "header_presence_drift"
        }) {
            ApiBehaviourDiffItemEntity item = baseItem(diffId)
                .headerClassification(value)
                .build();
            diffItemRepository.saveAndFlush(item);
            entityManager.clear();

            ApiBehaviourDiffItemEntity reloaded = diffItemRepository
                .findById(item.getId()).orElseThrow();
            assertThat(reloaded.getHeaderClassification())
                .as("header_classification survives the JPA round-trip")
                .isEqualTo(value);

            ApiBehaviourDiffItemDto dto = ApiBehaviourMapper.toDto(reloaded);
            assertThat(dto.headerClassification())
                .as("toDto surfaces header_classification on the DTO")
                .isEqualTo(value);
        }
    }

    @Test
    @DisplayName("a null header_classification round-trips as null (skipped header dimension / backward-compatible default)")
    void nullHeaderClassificationRoundTripsAsNull() {
        ApiBehaviourDiffItemEntity item = baseItem(diffId).build();
        diffItemRepository.saveAndFlush(item);
        entityManager.clear();

        ApiBehaviourDiffItemEntity reloaded = diffItemRepository
            .findById(item.getId()).orElseThrow();
        assertThat(reloaded.getHeaderClassification())
            .as("null = header dimension not classified -> backward-compatible default")
            .isNull();
        assertThat(ApiBehaviourMapper.toDto(reloaded).headerClassification())
            .as("null round-trips as null on the DTO too")
            .isNull();
    }

    @Test
    @DisplayName("create service accepts each of the three valid header_classification values and persists them")
    void createAcceptsValidHeaderClassifications() {
        for (String value : new String[] {
            "header_match", "header_value_drift", "header_presence_drift"
        }) {
            ApiBehaviourDiffItemDto created =
                diffItemService.create(projectId, diffId, createReq("body_match", value));
            assertThat(created.headerClassification())
                .as("the service persists the accepted header_classification")
                .isEqualTo(value);
        }
    }

    @Test
    @DisplayName("create service rejects an invalid header_classification value at the service layer (no DB enum)")
    void createRejectsInvalidHeaderClassification() {
        assertThatThrownBy(() ->
            diffItemService.create(projectId, diffId,
                createReq("body_match", "header_bogus_drift")))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("headerClassification 'header_bogus_drift'")
            .hasMessageContaining("not in the allowed set");
    }

    @Test
    @DisplayName("create service accepts body_ordering_drift as a body_classification value (existing column, no schema change)")
    void createAcceptsBodyOrderingDrift() {
        ApiBehaviourDiffItemDto created =
            diffItemService.create(projectId, diffId,
                createReq("body_ordering_drift", null));
        assertThat(created.bodyClassification())
            .as("body_ordering_drift is accepted on the existing body_classification column")
            .isEqualTo("body_ordering_drift");
        assertThat(ApiBehaviourDiffItemService.ALLOWED_BODY_CLASSIFICATIONS)
            .contains("body_ordering_drift");
    }

    @Test
    @DisplayName("DTO + create request serialise header_classification as snake_case on the wire (AMS default) and round-trip")
    void headerClassificationSerialisesSnakeCase() throws Exception {
        // Mirror the application's spring.jackson.property-naming-strategy: SNAKE_CASE.
        ObjectMapper snake = new ObjectMapper()
            .setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);

        CreateApiBehaviourDiffItemRequest req =
            createReq("body_ordering_drift", "header_value_drift");
        String reqJson = snake.writeValueAsString(req);
        assertThat(reqJson)
            .as("create request emits snake_case header_classification (no @CamelCaseWire)")
            .contains("\"header_classification\":\"header_value_drift\"")
            .doesNotContain("headerClassification");

        // Snake_case wire deserialises back into the boxed field intact.
        CreateApiBehaviourDiffItemRequest back =
            snake.readValue(reqJson, CreateApiBehaviourDiffItemRequest.class);
        assertThat(back.headerClassification()).isEqualTo("header_value_drift");
        assertThat(back.bodyClassification()).isEqualTo("body_ordering_drift");

        ApiBehaviourDiffItemDto dto = new ApiBehaviourDiffItemDto(
            UUID.randomUUID(), diffId, "GET", "/widgets", "happy",
            UUID.randomUUID(), UUID.randomUUID(),
            "status_match", "body_ordering_drift", "header_value_drift",
            200, 200, null, null, null
        );
        String dtoJson = snake.writeValueAsString(dto);
        assertThat(dtoJson)
            .as("DTO emits snake_case header_classification")
            .contains("\"header_classification\":\"header_value_drift\"");
        assertThat(snake.readValue(dtoJson, ApiBehaviourDiffItemDto.class).headerClassification())
            .isEqualTo("header_value_drift");
    }

    @Test
    @DisplayName("changeset 190 adds header_classification text NULL with a not.columnExists precondition, registered AFTER 189 (189 untouched)")
    void changeset190DeclaresHeaderClassificationColumn() throws Exception {
        String sql = readClasspathResource(
            "db/changelog/sql/190-diff-item-header-classification.sql");
        assertThat(sql)
            .as("190 adds the nullable TEXT column to the diff_items table")
            .contains("ALTER TABLE api_behaviour_diff_items ADD COLUMN header_classification text NULL");

        String master = readClasspathResource("db/changelog/db.changelog-master.yaml");
        assertThat(master)
            .as("changeset 190 must be registered with its sqlFile path")
            .contains("id: 190-diff-item-header-classification")
            .contains("db/changelog/sql/190-diff-item-header-classification.sql");
        assertThat(master)
            .as("the not.columnExists precondition makes the re-run idempotent")
            .contains("columnName: header_classification")
            .contains("tableName: api_behaviour_diff_items");

        // 189 (the previous highest) must still be present and registered BEFORE 190.
        assertThat(master)
            .as("changeset 189 anchor must still be present -- verifies we did not edit it")
            .contains("id: 189-capture-coverage-summary")
            .contains("db/changelog/sql/189-capture-coverage-summary.sql");
        int idx189 = master.indexOf("id: 189-capture-coverage-summary");
        int idx190 = master.indexOf("id: 190-diff-item-header-classification");
        assertThat(idx189).isGreaterThan(-1);
        assertThat(idx190)
            .as("changeset 190 must be registered AFTER 189")
            .isGreaterThan(idx189);
    }
}
