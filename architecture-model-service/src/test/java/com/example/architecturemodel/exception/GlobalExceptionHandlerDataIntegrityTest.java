package com.example.architecturemodel.exception;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.Path;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Tests for the {@link GlobalExceptionHandler} handlers added in
 * Step 5 of the save-validation series — DB-layer
 * {@link DataIntegrityViolationException} and JSR-380 bean-validation
 * {@link jakarta.validation.ConstraintViolationException}.
 *
 * Follows the same plain-Mockito + direct-handler-invocation style as
 * {@code GlobalExceptionHandlerTest} — no Spring context.
 */
class GlobalExceptionHandlerDataIntegrityTest {

    private final GlobalExceptionHandler handler = new GlobalExceptionHandler();

    @Test
    @DisplayName("DataIntegrityViolationException — Postgres NOT NULL pattern returns 400 + null_violation + field")
    void testNotNullViolationReturns400WithNullViolationCode() {
        // Given — wrap a synthetic root cause that mimics the Postgres driver text.
        Exception rootCause = new RuntimeException(
                "ERROR: null value in column \"name\" of relation \"architectures\" "
                        + "violates not-null constraint");
        DataIntegrityViolationException exception =
                new DataIntegrityViolationException("Wrapped", rootCause);

        // When
        ResponseEntity<Map<String, Object>> response =
                handler.handleDataIntegrityViolationException(exception);

        // Then
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        Map<String, Object> body = response.getBody();
        assertThat(body).isNotNull();
        assertThat(body.get("status")).isEqualTo(400);
        assertThat(body.get("error")).isEqualTo("Bad Request");
        assertThat(body.get("code")).isEqualTo("null_violation");
        assertThat(body.get("field")).isEqualTo("name");
        assertThat(body.get("message")).isEqualTo("Required field 'name' is missing.");
        assertThat(body.get("timestamp")).isNotNull();
    }

    @Test
    @DisplayName("DataIntegrityViolationException — FK violation pattern returns 400 + foreign_key_violation")
    void testForeignKeyViolationReturns400WithForeignKeyViolationCode() {
        // Given — Postgres FK violation message includes the "Key (col)=" snippet.
        Exception rootCause = new RuntimeException(
                "ERROR: insert or update on table \"infrastructure_components\" "
                        + "violates foreign key constraint \"fk_env\" "
                        + "Detail: Key (environment_id)=(123) is not present in table \"environments\".");
        DataIntegrityViolationException exception =
                new DataIntegrityViolationException("Wrapped", rootCause);

        // When
        ResponseEntity<Map<String, Object>> response =
                handler.handleDataIntegrityViolationException(exception);

        // Then
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        Map<String, Object> body = response.getBody();
        assertThat(body).isNotNull();
        assertThat(body.get("status")).isEqualTo(400);
        assertThat(body.get("error")).isEqualTo("Bad Request");
        assertThat(body.get("code")).isEqualTo("foreign_key_violation");
        assertThat(body.get("field")).isEqualTo("environment_id");
        assertThat(body.get("message"))
                .isEqualTo("Referenced entity does not exist for field 'environment_id'.");
    }

    @Test
    @DisplayName("DataIntegrityViolationException — UNIQUE violation pattern returns 400 + unique_violation")
    void testUniqueViolationReturns400WithUniqueViolationCode() {
        // Given — Postgres unique violation includes "duplicate key value violates unique constraint"
        // with a "Key (col)=(...) already exists." detail line.
        Exception rootCause = new RuntimeException(
                "ERROR: duplicate key value violates unique constraint \"architectures_name_key\" "
                        + "Detail: Key (name)=(My Architecture) already exists.");
        DataIntegrityViolationException exception =
                new DataIntegrityViolationException("Wrapped", rootCause);

        // When
        ResponseEntity<Map<String, Object>> response =
                handler.handleDataIntegrityViolationException(exception);

        // Then
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        Map<String, Object> body = response.getBody();
        assertThat(body).isNotNull();
        assertThat(body.get("status")).isEqualTo(400);
        assertThat(body.get("error")).isEqualTo("Bad Request");
        assertThat(body.get("code")).isEqualTo("unique_violation");
        assertThat(body.get("field")).isEqualTo("name");
        assertThat(body.get("message")).isEqualTo("Duplicate value for unique field 'name'.");
    }

    @Test
    @DisplayName("DataIntegrityViolationException — unrecognised pattern returns 400 + constraint_violation + root cause")
    void testGenericDataIntegrityViolationReturns400WithRootCauseMessage() {
        // Given — a message that matches none of the documented patterns.
        Exception rootCause = new RuntimeException("Some database constraint thing went wrong");
        DataIntegrityViolationException exception =
                new DataIntegrityViolationException("Wrapped", rootCause);

        // When
        ResponseEntity<Map<String, Object>> response =
                handler.handleDataIntegrityViolationException(exception);

        // Then
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        Map<String, Object> body = response.getBody();
        assertThat(body).isNotNull();
        assertThat(body.get("status")).isEqualTo(400);
        assertThat(body.get("error")).isEqualTo("Bad Request");
        assertThat(body.get("code")).isEqualTo("constraint_violation");
        assertThat(body).doesNotContainKey("field");
        assertThat(body.get("message")).isEqualTo("Some database constraint thing went wrong");
    }

    @Test
    @DisplayName("jakarta ConstraintViolationException — two violations returns 400 + comma-joined message")
    void testBeanValidationReturns400WithCommaJoinedMessage() {
        // Given — two synthetic Bean Validation constraint violations.
        // NB: ConstraintViolationException internally re-wraps the set, so we
        // don't assume a deterministic iteration order and assert on contents
        // (both violations present, code/field/200 envelope correct) instead.
        Set<ConstraintViolation<?>> violations = new LinkedHashSet<>();
        violations.add(buildViolation("name", "must not be null"));
        violations.add(buildViolation("description", "size must be between 0 and 500"));
        jakarta.validation.ConstraintViolationException exception =
                new jakarta.validation.ConstraintViolationException("validation failed", violations);

        // When
        ResponseEntity<Map<String, Object>> response =
                handler.handleBeanValidationException(exception);

        // Then
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        Map<String, Object> body = response.getBody();
        assertThat(body).isNotNull();
        assertThat(body.get("status")).isEqualTo(400);
        assertThat(body.get("error")).isEqualTo("Bad Request");
        assertThat(body.get("code")).isEqualTo("bean_validation");
        // First violated field — must be one of the two we supplied.
        assertThat(body.get("field")).isIn("name", "description");
        // Comma-joined "field: message" — both pairs must appear, and there
        // must be exactly one separator between them.
        String message = (String) body.get("message");
        assertThat(message).contains("name: must not be null");
        assertThat(message).contains("description: size must be between 0 and 500");
        assertThat(message).contains(", ");
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private ConstraintViolation<?> buildViolation(String propertyPath, String message) {
        ConstraintViolation violation = mock(ConstraintViolation.class);
        Path path = mock(Path.class);
        when(path.toString()).thenReturn(propertyPath);
        when(violation.getPropertyPath()).thenReturn(path);
        when(violation.getMessage()).thenReturn(message);
        return violation;
    }
}
