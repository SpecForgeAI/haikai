package com.example.architecturemodel.config;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.junit.jupiter.SpringExtension;

import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Tests for application configuration properties.
 *
 * Validates that app.projectRootDir property is correctly injected,
 * including default value fallback and path resolution.
 */
class AppConfigurationTest {

    /**
     * Test that app.projectRootDir property is injected correctly when explicitly set.
     */
    @ExtendWith(SpringExtension.class)
    @SpringBootTest
    @TestPropertySource(properties = {"app.projectRootDir=/custom/path"})
    @ActiveProfiles("test")
    static class ExplicitConfigTest {

        @Value("${app.projectRootDir}")
        private String projectRootDir;

        @Test
        void projectRootDir_isInjectedCorrectly() {
            assertThat(projectRootDir).isEqualTo("/custom/path");
        }

        @Test
        void projectRootDir_resolvesPath() {
            Path resolved = Path.of(projectRootDir).resolve("agent-os/product/roadmap.md");
            assertThat(resolved.toString()).contains("agent-os");
            assertThat(resolved.toString()).contains("product");
            assertThat(resolved.toString()).contains("roadmap.md");
        }
    }

    /**
     * Test default value fallback when property is not set.
     */
    @ExtendWith(SpringExtension.class)
    @SpringBootTest
    @ActiveProfiles("test")
    static class DefaultConfigTest {

        @Value("${app.projectRootDir:.}")
        private String projectRootDir;

        @Test
        void projectRootDir_defaultsToCurrentDirectory() {
            // Default value should be "." (current directory)
            assertThat(projectRootDir).isEqualTo(".");
        }
    }
}
