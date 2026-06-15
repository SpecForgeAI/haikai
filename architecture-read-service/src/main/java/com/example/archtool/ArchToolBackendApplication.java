package com.example.archtool;

import com.example.archtool.config.ConfluenceProperties;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

/**
 * Main application class for the Architecture Tool Backend.
 *
 * <p>This Spring Boot application provides a REST API for fetching draw.io diagrams
 * from Confluence pages, parsing them into a neutral graph representation,
 * and returning structured JSON responses.</p>
 */
@SpringBootApplication
@EnableConfigurationProperties(ConfluenceProperties.class)
public class ArchToolBackendApplication {

    public static void main(String[] args) {
        SpringApplication.run(ArchToolBackendApplication.class, args);
    }
}
