package com.example.architecturemodel.model.dto.targetstate;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Wire-shape tests for the "proceed with remaining criticals" override trio DTOs
 * (Spec: Vulnerability Reduction + Steering, 2026-06-24, Spec 4 -- Task Group 4,
 * task 4.1c).
 *
 * <p>Asserts the override-trio request + read DTOs speak SNAKE_CASE on the wire
 * (the AMS global default -- NO {@code @CamelCaseWire}), mirroring the
 * capture-session coverage-override trio. The {@link ObjectMapper} here is
 * configured exactly like the AMS global
 * ({@code spring.jackson.property-naming-strategy: SNAKE_CASE} +
 * {@code JavaTimeModule} for {@link Instant}) so the assertion reflects the real
 * production wire.</p>
 *
 * <p>Plain JUnit (no Spring context) -- the DTO is a pure record.</p>
 */
class ProceedCriticalOverrideWireTest {

    private static ObjectMapper snakeCaseMapper() {
        return new ObjectMapper()
            .registerModule(new JavaTimeModule())
            .setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
    }

    @Test
    @DisplayName("UpsertProceedCriticalOverrideRequest reads snake_case wire fields")
    void requestDeserialisesSnakeCase() throws Exception {
        ObjectMapper mapper = snakeCaseMapper();
        String json = "{"
            + "\"proceed_critical_override_justification\":\"approved by SRE on-call\","
            + "\"remaining_critical_count\":3,"
            + "\"proceed_critical_override_at\":\"2026-06-24T10:15:30Z\""
            + "}";

        UpsertProceedCriticalOverrideRequest req =
            mapper.readValue(json, UpsertProceedCriticalOverrideRequest.class);

        assertThat(req.proceedCriticalOverrideJustification()).isEqualTo("approved by SRE on-call");
        assertThat(req.remainingCriticalCount()).isEqualTo(3);
        assertThat(req.proceedCriticalOverrideAt()).isEqualTo(Instant.parse("2026-06-24T10:15:30Z"));
    }

    @Test
    @DisplayName("ProceedCriticalOverrideDto serialises the trio + derived overridden flag in snake_case")
    void readDtoSerialisesSnakeCase() throws Exception {
        ObjectMapper mapper = snakeCaseMapper();
        ProceedCriticalOverrideDto dto = ProceedCriticalOverrideDto.of(
            "approved by SRE on-call", 3, Instant.parse("2026-06-24T10:15:30Z"));

        String json = mapper.writeValueAsString(dto);

        // snake_case keys (AMS default), NOT camelCase.
        assertThat(json).contains("\"proceed_critical_override_justification\":\"approved by SRE on-call\"");
        assertThat(json).contains("\"remaining_critical_count\":3");
        assertThat(json).contains("\"proceed_critical_override_at\":");
        assertThat(json).contains("\"overridden\":true");
        assertThat(json).doesNotContain("proceedCriticalOverrideJustification");
        assertThat(json).doesNotContain("remainingCriticalCount");
    }

    @Test
    @DisplayName("of(): overridden derives from justification/timestamp; not-overridden default is all-null + false")
    void overriddenDerivationAndNotOverriddenDefault() {
        // A justification (even with a null count) counts as overridden.
        ProceedCriticalOverrideDto withJustification =
            ProceedCriticalOverrideDto.of("reason", null, null);
        assertThat(withJustification.overridden()).isTrue();
        // Boxed Integer null is preserved (NOT coerced to 0).
        assertThat(withJustification.remainingCriticalCount()).isNull();

        // A blank justification + no timestamp is NOT an override.
        ProceedCriticalOverrideDto blank = ProceedCriticalOverrideDto.of("   ", null, null);
        assertThat(blank.overridden()).isFalse();

        // The not-overridden default: all audit fields null, overridden=false.
        ProceedCriticalOverrideDto none = ProceedCriticalOverrideDto.notOverridden();
        assertThat(none.overridden()).isFalse();
        assertThat(none.proceedCriticalOverrideJustification()).isNull();
        assertThat(none.remainingCriticalCount()).isNull();
        assertThat(none.proceedCriticalOverrideAt()).isNull();
    }
}
