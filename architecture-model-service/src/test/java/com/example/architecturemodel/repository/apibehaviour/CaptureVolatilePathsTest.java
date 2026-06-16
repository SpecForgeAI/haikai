package com.example.architecturemodel.repository.apibehaviour;

import com.example.architecturemodel.mapper.apibehaviour.ApiBehaviourMapper;
import com.example.architecturemodel.model.dto.apibehaviour.ApiBehaviourCaptureDto;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourCaptureEntity;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * FU-2 tests for the {@code volatile_paths_json} carrier column on
 * {@code api_behaviour_captures} (Reconcile-Time Determinism &amp; Volatile-Value
 * Handling, 2026-06-16 -- FU-2: probe-at-capture wiring).
 *
 * <p>The capture-time volatility probe (in {@code execute_http_request})
 * MEASURES the envelope at capture time -- the only moment the current system is
 * authoritative and callable -- and records it on the capture row. On
 * Save-as-baseline the frontend copies it onto the source baseline item's own
 * {@code volatile_paths_json} (changeset 187). This carrier column is the bridge
 * between the two.</p>
 *
 * <p>Mirrors {@link BaselineItemVolatilePathsTest} exactly (the
 * {@code @DataJpaTest} + H2 PostgreSQL-mode + {@code CREATE DOMAIN JSONB AS
 * JSON} idiom + the static-text changeset check). Focused (3 tests):</p>
 * <ol>
 *   <li>the envelope round-trips through the JPA mapping AND {@code toDto};</li>
 *   <li>a {@code null} envelope round-trips as {@code null} (strict default);</li>
 *   <li>changeset 188 adds the column with a {@code not.columnExists}
 *       precondition, registered AFTER 187 (187 untouched).</li>
 * </ol>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:capturevolatiledb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
})
class CaptureVolatilePathsTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private ApiBehaviourCaptureRepository captureRepository;

    private static ApiBehaviourCaptureEntity.ApiBehaviourCaptureEntityBuilder baseCapture() {
        return ApiBehaviourCaptureEntity.builder()
            .id(UUID.randomUUID())
            .sessionId(UUID.randomUUID())
            .scenarioId(UUID.randomUUID())
            .operationId(UUID.randomUUID())
            .attemptNumber(1)
            .requestMethod("GET")
            .requestUrlRedacted("https://api.example.test/widgets")
            .requestPath("/widgets")
            .responseStatus(200)
            .responseBodyJson(Map.of("items", List.of(Map.of("id", "w1"))))
            .capturedAt(Instant.parse("2026-06-16T00:00:00Z"))
            .accepted(Boolean.TRUE);
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
    @DisplayName("capture volatile_paths_json envelope { paths, volatility_source, k } round-trips through JSONB + toDto")
    void captureVolatilePathsEnvelopeRoundTrips() {
        Map<String, Object> envelope = new LinkedHashMap<>();
        envelope.put("paths", List.of("/createdAt"));
        envelope.put("volatility_source", "probed");
        envelope.put("k", 3);

        ApiBehaviourCaptureEntity capture = baseCapture()
            .volatilePathsJson(envelope)
            .build();
        captureRepository.saveAndFlush(capture);
        entityManager.clear();

        ApiBehaviourCaptureEntity reloaded = captureRepository
            .findById(capture.getId()).orElseThrow();
        assertThat(reloaded.getVolatilePathsJson())
            .as("the volatility envelope survives the JSONB round-trip on the capture row")
            .containsEntry("volatility_source", "probed")
            .containsEntry("k", 3);

        // toDto surfaces the same envelope so the frontend can carry it forward.
        ApiBehaviourCaptureDto dto = ApiBehaviourMapper.toDto(reloaded);
        assertThat(dto.volatilePathsJson())
            .as("toDto surfaces the envelope on the capture DTO for Save-as-baseline")
            .containsEntry("volatility_source", "probed")
            .containsEntry("k", 3);
    }

    @Test
    @DisplayName("a null capture volatile_paths_json round-trips as null (strict-comparison default)")
    void nullCaptureVolatilePathsRoundTripsAsNull() {
        ApiBehaviourCaptureEntity capture = baseCapture().build();
        captureRepository.saveAndFlush(capture);
        entityManager.clear();

        ApiBehaviourCaptureEntity reloaded = captureRepository
            .findById(capture.getId()).orElseThrow();
        assertThat(reloaded.getVolatilePathsJson())
            .as("null means no volatility recorded -> strict comparison")
            .isNull();

        ApiBehaviourCaptureDto dto = ApiBehaviourMapper.toDto(reloaded);
        assertThat(dto.volatilePathsJson())
            .as("null round-trips as null on the DTO too")
            .isNull();
    }

    @Test
    @DisplayName("changeset 188 adds api_behaviour_captures.volatile_paths_json jsonb NULL with a not.columnExists precondition, registered AFTER 187 (187 untouched)")
    void changeset188DeclaresCaptureVolatilePathsColumn() throws Exception {
        String sql = readClasspathResource(
            "db/changelog/sql/188-capture-volatile-paths.sql");

        assertThat(sql)
            .as("188 adds the nullable JSONB column to the captures table")
            .contains("ALTER TABLE api_behaviour_captures ADD COLUMN volatile_paths_json jsonb NULL");

        String master = readClasspathResource("db/changelog/db.changelog-master.yaml");

        assertThat(master)
            .as("changeset 188 must be registered with its sqlFile path")
            .contains("id: 188-capture-volatile-paths")
            .contains("db/changelog/sql/188-capture-volatile-paths.sql");
        assertThat(master)
            .as("the not.columnExists precondition makes the re-run idempotent")
            .contains("columnName: volatile_paths_json")
            .contains("tableName: api_behaviour_captures");

        // 187 (the previous highest, same spec) must still be present BEFORE 188.
        assertThat(master)
            .as("changeset 187 anchor must still be present -- verifies we did not edit it")
            .contains("id: 187-baseline-item-volatile-paths");
        int idx187 = master.indexOf("id: 187-baseline-item-volatile-paths");
        int idx188 = master.indexOf("id: 188-capture-volatile-paths");
        assertThat(idx187).isGreaterThan(-1);
        assertThat(idx188)
            .as("changeset 188 must be registered AFTER 187")
            .isGreaterThan(idx187);
    }
}
