package com.example.jiraservice.model.dto.jira;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for {@link JiraSearchRequest} serialization.
 *
 * <p>Verifies that the {@code @JsonNaming(LowerCamelCaseStrategy.class)} annotation
 * correctly overrides the global SNAKE_CASE Jackson strategy, ensuring the Jira API
 * receives camelCase keys.</p>
 */
class JiraSearchRequestTest {

    /**
     * An ObjectMapper configured with SNAKE_CASE to mimic the global
     * {@code application.yml} setting: {@code property-naming-strategy: SNAKE_CASE}.
     */
    private final ObjectMapper objectMapper = new ObjectMapper()
        .setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);

    @Test
    @DisplayName("Serializes with camelCase keys despite global SNAKE_CASE strategy")
    void serializesWithCamelCaseKeysDespiteGlobalSnakeCaseStrategy() throws JsonProcessingException {
        // Arrange
        JiraSearchRequest request = new JiraSearchRequest(
            "project = PROJ", 50, List.of("summary", "status"));

        // Act
        String json = objectMapper.writeValueAsString(request);

        // Assert -- camelCase keys must be present
        assertTrue(json.contains("\"maxResults\""), "JSON should contain camelCase key 'maxResults'. Actual: " + json);

        // Assert -- snake_case keys must NOT be present
        assertFalse(json.contains("\"max_results\""), "JSON should NOT contain snake_case key 'max_results'. Actual: " + json);
    }

    @Test
    @DisplayName("Fields list serializes as a JSON array, not a comma-separated string")
    void fieldsListSerializesAsJsonArray() throws JsonProcessingException {
        // Arrange
        JiraSearchRequest request = new JiraSearchRequest(
            "project = PROJ", 50, List.of("summary", "issuetype", "status"));

        // Act
        String json = objectMapper.writeValueAsString(request);

        // Assert -- fields must be a JSON array
        assertTrue(json.contains("\"fields\":[\"summary\",\"issuetype\",\"status\"]"),
            "JSON should contain fields as a JSON array. Actual: " + json);
    }
}
