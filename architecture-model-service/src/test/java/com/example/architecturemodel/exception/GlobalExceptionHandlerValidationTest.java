package com.example.architecturemodel.exception;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Tests for the {@link GlobalExceptionHandler#handleValidationException}
 * handler added in Step 4 of the save-validation improvement series
 * (2026-05-08).
 *
 * Confirms that a {@link ValidationException} produces a structured 400
 * envelope with the snake_case keys {@code entity_type}, {@code code},
 * {@code field}, {@code entity_id}, {@code entity_name}, plus the
 * usual {@code timestamp}, {@code status}, {@code error}, {@code message}.
 *
 * Style mirrors {@link GlobalExceptionHandlerTest} -- direct handler
 * invocation, no Spring context.
 */
class GlobalExceptionHandlerValidationTest {

    private final GlobalExceptionHandler handler = new GlobalExceptionHandler();

    @Test
    @DisplayName("ValidationException with all fields populated returns 400 with full snake_case envelope")
    void testValidationExceptionFullFieldsProducesStructuredEnvelope() {
        ValidationException exception = new ValidationException(
                "application_points",
                "application_id_required",
                "application_id",
                "ap-123",
                "User Login Point",
                "ApplicationPoint validation failed for id 'ap-123' (name: 'User Login Point'): "
                        + "application_id is required. Every ApplicationPoint must be associated with an Application."
        );

        ResponseEntity<Map<String, Object>> response = handler.handleValidationException(exception);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        Map<String, Object> body = response.getBody();
        assertThat(body).isNotNull();
        assertThat(body.get("status")).isEqualTo(400);
        assertThat(body.get("error")).isEqualTo("Bad Request");
        assertThat(body.get("entity_type")).isEqualTo("application_points");
        assertThat(body.get("code")).isEqualTo("application_id_required");
        assertThat(body.get("field")).isEqualTo("application_id");
        assertThat(body.get("entity_id")).isEqualTo("ap-123");
        assertThat(body.get("entity_name")).isEqualTo("User Login Point");
        assertThat(body.get("message")).isEqualTo(exception.getMessage());
        assertThat(body.get("timestamp")).isNotNull();
    }

    @Test
    @DisplayName("ValidationException with null entity_name omits the entity_name key")
    void testValidationExceptionNullEntityNameOmitsKey() {
        // Mirror the LDE-relationship case where entityName is null because the
        // entity has no `name` field.
        ValidationException exception = new ValidationException(
                "logical_data_entity_relationships",
                "endpoint_required",
                "from_data_entity_point_id",
                "rel-7",
                null,
                "LogicalDataEntityRelationship validation failed for id 'rel-7': fromDataEntityPointId is required"
        );

        ResponseEntity<Map<String, Object>> response = handler.handleValidationException(exception);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        Map<String, Object> body = response.getBody();
        assertThat(body).isNotNull();
        assertThat(body.get("status")).isEqualTo(400);
        assertThat(body.get("error")).isEqualTo("Bad Request");
        assertThat(body.get("entity_type")).isEqualTo("logical_data_entity_relationships");
        assertThat(body.get("code")).isEqualTo("endpoint_required");
        assertThat(body.get("field")).isEqualTo("from_data_entity_point_id");
        assertThat(body.get("entity_id")).isEqualTo("rel-7");
        assertThat(body).doesNotContainKey("entity_name");
        assertThat(body.get("message")).isEqualTo(exception.getMessage());
    }
}
