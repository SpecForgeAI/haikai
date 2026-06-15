package com.example.architecturemodel;

import com.example.architecturemodel.config.AppFeaturesProperties;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

/**
 * Main application class for the Architecture Model Service.
 *
 * Spec 2026-01-19: Startup Configuration for Feature Toggles
 * - Enables AppFeaturesProperties for feature toggle configuration
 */
@SpringBootApplication
@EnableConfigurationProperties(AppFeaturesProperties.class)
public class ArchitectureModelApplication {

    public static void main(String[] args) {
        SpringApplication.run(ArchitectureModelApplication.class, args);
    }
}
