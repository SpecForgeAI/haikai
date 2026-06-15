package com.example.jiraservice.service;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.example.jiraservice.config.JiraProperties;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.junit.jupiter.MockitoExtension;
import org.slf4j.LoggerFactory;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for {@link TypeMappingService}.
 *
 * <p>Verifies that Jira issue types are correctly resolved to WorkItemDto type strings
 * using the per-project type mapping configuration, and that unmapped types default
 * to STORY with a WARN-level log.</p>
 */
@ExtendWith(MockitoExtension.class)
class TypeMappingServiceTest {

    @Test
    @DisplayName("Mapped Jira issue type resolves to configured WorkItemDto type")
    void mappedJiraIssueTypeResolvesToConfiguredType() {
        // Arrange
        Map<String, Map<String, String>> typeMapping = Map.of(
            "PROJ", Map.of(
                "Epic", "INITIATIVE",
                "Story", "FEATURE"
            )
        );
        JiraProperties properties = new JiraProperties(
            "https://example.atlassian.net",
            JiraProperties.AuthMode.BEARER,
            "token",
            null,
            null,
            5000,
            30000,
            typeMapping,
            Map.of(),
            Map.of()
        );
        TypeMappingService service = new TypeMappingService(properties);

        // Act
        String resolvedType = service.resolveType("PROJ", "Epic", "PROJ-1");

        // Assert
        assertEquals("INITIATIVE", resolvedType,
            "Epic should resolve to INITIATIVE based on type mapping configuration");
    }

    @Test
    @DisplayName("Unmapped Jira issue type defaults to STORY")
    void unmappedJiraIssueTypeDefaultsToStory() {
        // Arrange
        Map<String, Map<String, String>> typeMapping = Map.of(
            "PROJ", Map.of("Epic", "INITIATIVE")
        );
        JiraProperties properties = new JiraProperties(
            "https://example.atlassian.net",
            JiraProperties.AuthMode.BEARER,
            "token",
            null,
            null,
            5000,
            30000,
            typeMapping,
            Map.of(),
            Map.of()
        );
        TypeMappingService service = new TypeMappingService(properties);

        // Act
        String resolvedType = service.resolveType("PROJ", "Bug", "PROJ-5");

        // Assert
        assertEquals("STORY", resolvedType,
            "Unmapped issue type 'Bug' should default to STORY");
    }

    @Test
    @DisplayName("Unmapped type emits WARN-level log with type name, project key, and issue key")
    void unmappedTypeEmitsWarnLog() {
        // Arrange
        Map<String, Map<String, String>> typeMapping = Map.of(
            "PROJ", Map.of("Epic", "INITIATIVE")
        );
        JiraProperties properties = new JiraProperties(
            "https://example.atlassian.net",
            JiraProperties.AuthMode.BEARER,
            "token",
            null,
            null,
            5000,
            30000,
            typeMapping,
            Map.of(),
            Map.of()
        );
        TypeMappingService service = new TypeMappingService(properties);

        // Set up Logback appender to capture log events
        Logger logger = (Logger) LoggerFactory.getLogger(TypeMappingService.class);
        ListAppender<ILoggingEvent> listAppender = new ListAppender<>();
        listAppender.start();
        logger.addAppender(listAppender);

        try {
            // Act
            service.resolveType("PROJ", "Sub-task", "PROJ-42");

            // Assert
            boolean hasWarnLog = listAppender.list.stream()
                .anyMatch(event ->
                    event.getLevel() == Level.WARN
                    && event.getFormattedMessage().contains("Sub-task")
                    && event.getFormattedMessage().contains("PROJ")
                    && event.getFormattedMessage().contains("PROJ-42")
                );
            assertTrue(hasWarnLog,
                "Should emit WARN log containing the unmapped type name 'Sub-task', "
                + "project key 'PROJ', and issue key 'PROJ-42'");
        } finally {
            logger.detachAppender(listAppender);
        }
    }
}
